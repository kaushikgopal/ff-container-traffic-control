// Container Traffic Control Background Script
// Handles URL redirection based on user-defined rules

// ============================================================================
// FIREFOX EXTENSION ARCHITECTURE: Execution Context Isolation
// ============================================================================
// Firefox extensions run in SEPARATE, ISOLATED JavaScript contexts:
//
// 1. BACKGROUND CONTEXT (this file):
//    - Event-driven background script (Manifest V3 - terminates when idle)
//    - Wakes up on events (webRequest, storage changes, etc.)
//    - Handles webRequest interception (navigation routing)
//    - Has own instance of CtcRepo, ctcConsole, and all utils
//    - Cannot directly access options page variables
//
// 2. OPTIONS CONTEXT (options.js):
//    - Separate page that opens in browser tab
//    - Manages UI for rule configuration
//    - Has own independent instance of CtcRepo, ctcConsole, and all utils
//    - Cannot directly access background script variables
//
// 3. COMMUNICATION:
//    - Contexts share data through browser.storage.sync (persistent storage)
//    - Changes in options page trigger storage.onChanged events in background
//    - Each context must initialize its own CtcRepo instance
//
// This is why you see CtcRepo.initialize() called "twice" in logs:
//    [Background] Initializing CtcRepo...  <- This context
//    [Options] Loading CtcRepo data...     <- Different context
//
// This isolation is BY DESIGN and ensures:
//    - Background script never blocks on UI operations
//    - Options page can reload without affecting navigation
//    - Extension remains responsive under all conditions
// ============================================================================

// CRITICAL: Main navigation interceptor - all page loads go through this
// Using "blocking" mode means we can cancel/redirect requests before they complete
// FAILURE MODE: If this crashes, all navigation breaks
browser.webRequest.onBeforeRequest.addListener(
  handleRequest,
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["blocking"],
);

// HTTP redirects are now handled entirely by onBeforeRequest
// when the redirected URL loads - no separate handler needed

browser.storage.onChanged.addListener((changes, areaName) => {
  if (changes.ctcRules && areaName === "sync") {
    CtcRepo.loadRules();
  }
});

browser.contextualIdentities.onCreated.addListener(() => {
  CtcRepo.loadContainers();
});

browser.contextualIdentities.onRemoved.addListener(() => {
  CtcRepo.loadContainers();
});

// BOOTSTRAP: Initialize CtcRepo for BACKGROUND context
// CRITICAL: This is one of TWO initialization calls (one per context)
// WHY: Background and options run in separate JavaScript contexts
// WHEN: Called once at extension startup (browser launch or reload)
// WHAT: Loads containers + rules into this context's CtcRepo instance
//
// MV3 RACE CONDITION FIX: Eager initialization at startup
// PROBLEM: When script wakes from termination, webRequest fires before init completes
// SOLUTION: Start initialization immediately, handleRequest() checks if ready
ctcConsole.info("[Background] Initializing CtcRepo...");
let initializationPromise = null;
let isInitialized = false;

// Start initialization immediately at startup
initializationPromise = CtcRepo.initialize()
  .then(() => {
    isInitialized = true;
    ctcConsole.info("[Background] CtcRepo initialization complete");
  })
  .catch((error) => {
    ctcConsole.error("[Background] CtcRepo initialization failed:", error);
    // Clear promise so next navigation attempt can retry
    initializationPromise = null;
  });

// ============================================================================
// DEDUPLICATION TRACKING: Prevent navigation loops and duplicate tabs
// ============================================================================
// PROBLEM: Firefox fires multiple webRequest events for same navigation:
//    - HTTPS upgrades (http → https)
//    - Internal security redirects
//    - Service worker intercepts
//    - Race conditions in tab creation
//
// FAILURE MODES without tracking:
//    - Redirect loops (A→B→A→B→...)
//    - Duplicate tabs for single click
//    - Infinite container switching
//
// SOLUTION: Time-based deduplication with three tracking Maps:
//    1. recentRedirections: Prevent same URL from being redirected repeatedly
//    2. recentTabRequests: Prevent same tab+URL from being processed multiple times
//    3. recentContainerSwitches: Prevent same container switch in quick succession
//
// EXPIRY TIMES: Tuned through testing to balance safety vs responsiveness
//    - Too short: Loops and duplicates slip through
//    - Too long: User can't quickly re-navigate to same URL
//
// MEMORY MANAGEMENT: Maps cleaned when size exceeds threshold (line ~114)
// ============================================================================

// TUNING CONSTANTS: Expiry durations for deduplication tracking
const EXPIRY_REDIRECT_MS = 2000; // 2s: URL-based redirect cooldown
const EXPIRY_TAB_REQUEST_MS = 1000; // 1s: Tab+URL processing cooldown
const EXPIRY_CONTAINER_SWITCH_MS = 1500; // 1.5s: Container switch cooldown
const CLEANUP_SIZE_THRESHOLD = 100; // Trigger cleanup when Maps exceed this size

// TRACKING MAP 1: Prevent same URL from being redirected too frequently
// KEY FORMAT: url (string)
// VALUE: timestamp (number, Date.now())
// PURPOSE: Prevents redirect loops (URL bouncing between containers)
const recentRedirections = new Map();

// TRACKING MAP 2: Prevent duplicate processing of same tab navigation
// KEY FORMAT: "tabId-url" (string, e.g., "42-https://example.com")
// VALUE: timestamp (number, Date.now())
// PURPOSE: Prevents Firefox's multiple webRequest events from creating duplicate tabs
const recentTabRequests = new Map();

// TRACKING MAP 3: Prevent duplicate container switches in redirect chains
// KEY FORMAT: "fromContainer->toContainer" (string, e.g., "Personal->Work")
// VALUE: timestamp (number, Date.now())
// PURPOSE: Prevents redirect chains (Google, Microsoft) from switching multiple times
const recentContainerSwitches = new Map();

// PUBLIC: Main request handler (used by webRequest listener)
async function handleRequest(details) {
  try {
    // ====================================================================
    // MV3 WAKE-UP PROTECTION: Wait for initialization with timeout
    // ====================================================================
    // PROBLEM: When background script wakes from termination, webRequest
    //          events can fire BEFORE CtcRepo.initialize() completes
    // FAILURE MODE: evaluateContainer() throws "not initialized" error,
    //               request proceeds in wrong container
    // SOLUTION: Wait for initialization with 500ms timeout, then proceed
    // TIMING: Most initializations complete in 50-100ms
    // SAFETY: If initialization hangs, we fail-fast rather than blocking
    // ====================================================================
    if (!isInitialized && initializationPromise) {
      try {
        await Promise.race([
          initializationPromise,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Initialization timeout")), 500),
          ),
        ]);
      } catch (error) {
        ctcConsole.warn(
          "Initialization not ready, proceeding without rules:",
          error.message,
        );
        // Proceed anyway - better to route incorrectly than block navigation
      }
    }

    ctcConsole.log(`Received request for ${details.url}`);

    // ====================================================================
    // SAFETY CHECK 1: Never redirect privileged URLs
    // ====================================================================
    // PRIVILEGED URLS: about:*, moz-extension:*, chrome:*, resource:*
    // WHY: These are internal Firefox/extension pages
    // FAILURE MODE: Redirecting these breaks Firefox UI or causes crashes
    // EXAMPLES: about:config, about:debugging, moz-extension://...
    // ====================================================================
    if (isPrivilegedURL(details.url)) {
      return {};
    }

    // ====================================================================
    // EDGE CASE: tabId -1 means "no associated tab"
    // ====================================================================
    // WHEN THIS HAPPENS:
    //    - HTTP redirects (server-side 301/302)
    //    - Background fetches (preload, prefetch)
    //    - Service worker requests
    //    - Browser internal requests
    //
    // WHY SKIP: Processing creates phantom tabs that confuse users
    // ALTERNATIVE: Let these load in default container (no user impact)
    // ====================================================================
    if (details.tabId === -1) {
      return {};
    }

    // CRITICAL: Firefox fires multiple webRequest events for same navigation
    // Causes: HTTPS upgrades, service workers, security redirects, race conditions
    // FAILURE MODE: Without deduplication, creates multiple tabs for one click
    const tabRequestKey = `${details.tabId}-${details.url}`;
    const lastTabRequest = recentTabRequests.get(tabRequestKey);
    if (lastTabRequest && Date.now() - lastTabRequest < EXPIRY_TAB_REQUEST_MS) {
      return {}; // Skip duplicate
    }
    recentTabRequests.set(tabRequestKey, Date.now());

    // MAINTENANCE: Clean up when Maps get large to prevent memory bloat
    if (
      recentTabRequests.size > CLEANUP_SIZE_THRESHOLD ||
      recentRedirections.size > CLEANUP_SIZE_THRESHOLD ||
      recentContainerSwitches.size > CLEANUP_SIZE_THRESHOLD
    ) {
      pruneTrackingMaps();
    }

    // URL RACE CONDITIONS: Multiple tabs can compete to process same URL simultaneously
    // Prevents different tabs from creating duplicate tabs for same URL
    // Global URL-based deduplication with 2s cooldown
    const redirectKey = details.url;
    const lastRedirect = recentRedirections.get(redirectKey);
    if (lastRedirect && Date.now() - lastRedirect < EXPIRY_REDIRECT_MS) {
      return {}; // Skip - we just redirected this URL recently
    }

    // Get current container and tab state (active = foreground, !active = background)
    const { cookieStoreId: currentCookieStoreId, active: tabWasActive } =
      await getTabInfo(details.tabId);
    const { cookieStoreToNameMap } = CtcRepo.getContainerData();
    const currentContainerName =
      cookieStoreToNameMap.get(currentCookieStoreId) || "No Container";

    // Evaluate target container
    const targetCookieStoreId = evaluateContainer(
      details.url,
      currentCookieStoreId,
    );
    const targetContainerName =
      cookieStoreToNameMap.get(targetCookieStoreId) || "No Container";

    // Log evaluation result for debugging
    ctcConsole.log(
      `Evaluating ${details.url} [${currentContainerName} -> ${targetContainerName}]`,
    );

    // DECISION POINT: Container switch required?
    if (currentCookieStoreId !== targetCookieStoreId) {
      // GENERIC REDIRECT CHAIN DETECTION: Check if we recently switched to this target container
      // This catches any redirect chain (Firefox, Google, Microsoft, etc.) that tries to
      // switch to the same container multiple times in quick succession
      const containerSwitchKey = `${currentContainerName}->${targetContainerName}`;
      const lastContainerSwitch =
        recentContainerSwitches.get(containerSwitchKey);
      if (
        lastContainerSwitch &&
        Date.now() - lastContainerSwitch < EXPIRY_CONTAINER_SWITCH_MS
      ) {
        ctcConsole.log(
          `Skipping duplicate container switch: ${containerSwitchKey} (within ${EXPIRY_CONTAINER_SWITCH_MS}ms)`,
        );
        return {}; // Let this URL load in existing tab from previous switch
      }

      ctcConsole.info(
        `Container switch: ${currentContainerName} → ${targetContainerName} for ${details.url}`,
      );

      // CRITICAL: Record redirect AND container switch BEFORE creating tab to prevent loops
      // Must happen before tab creation to catch race conditions
      recentRedirections.set(redirectKey, Date.now());
      recentContainerSwitches.set(containerSwitchKey, Date.now());

      // ATOMIC OPERATION: Create new tab in correct container
      // FAILURE MODE: If this fails, user loses navigation entirely
      // ACTIVE STATE: Preserve user's foreground/background intent (Cmd+Shift+click = background)
      const newTab = await browser.tabs.create({
        url: details.url,
        cookieStoreId: targetCookieStoreId,
        active: tabWasActive, // false = background tab, true = foreground
        index: details.tabId >= 0 ? undefined : 0,
      });

      // CLEANUP: Remove original tab that's in wrong container
      // EDGE CASE: tabId < 0 means new tab, nothing to close
      if (details.tabId >= 0) {
        browser.tabs.remove(details.tabId);
      }

      // CRITICAL: Cancel original request to prevent double-load
      return { cancel: true };
    }

    return {};
  } catch (error) {
    // RECOVERY: Never crash the entire navigation system
    // FAILURE MODE: Throwing here breaks all page loads for user
    ctcConsole.error("Error handling request:", error);
    return {}; // Allow navigation to proceed normally
  }
}

// PRIVATE HELPERS: Module-scoped functions, effectively private
// MEMORY MANAGEMENT: Prevent unbounded Map growth
// PROBLEM: Heavy users can accumulate thousands of entries over time
// TRIGGER: Only called during container switches (not regular browsing)
function pruneTrackingMaps() {
  const now = Date.now();

  // Clean expired redirect tracking
  // PURPOSE: Remove old URLs that are no longer at risk of loops
  for (const [key, timestamp] of recentRedirections.entries()) {
    if (now - timestamp > EXPIRY_REDIRECT_MS) {
      recentRedirections.delete(key);
    }
  }

  // Clean expired request deduplication tracking
  // PURPOSE: Remove old tab-URL combinations that won't see duplicates
  for (const [key, timestamp] of recentTabRequests.entries()) {
    if (now - timestamp > EXPIRY_TAB_REQUEST_MS) {
      recentTabRequests.delete(key);
    }
  }

  // Clean expired container switch tracking
  // PURPOSE: Remove old container switches that are no longer at risk of duplicates
  for (const [key, timestamp] of recentContainerSwitches.entries()) {
    if (now - timestamp > EXPIRY_CONTAINER_SWITCH_MS) {
      recentContainerSwitches.delete(key);
    }
  }
}

// Check if URL is privileged (should not be redirected)
function isPrivilegedURL(url) {
  return (
    url.startsWith("about:") ||
    url.startsWith("moz-extension:") ||
    url.startsWith("chrome:") ||
    url.startsWith("resource:")
  );
}

// LOOKUP: Determine which container a tab is currently in and its active state
// EDGE CASE: tabId < 0 means "new tab" or system-generated navigation
// RETURNS: { cookieStoreId: string, active: boolean }
async function getTabInfo(tabId) {
  if (tabId < 0) {
    // New tab has no container, default to foreground
    return { cookieStoreId: "firefox-default", active: true };
  }

  try {
    const tab = await browser.tabs.get(tabId);
    // FALLBACK: Some tabs have no cookieStoreId (private browsing, etc)
    return {
      cookieStoreId: tab.cookieStoreId || "firefox-default",
      active: tab.active, // Preserve background/foreground intent
    };
  } catch (error) {
    // RECOVERY: Tab might have been closed while we were processing
    ctcConsole.error("Failed to get tab info:", error);
    return { cookieStoreId: "firefox-default", active: true }; // Safe defaults
  }
}

// Rule evaluation function (wrapper around pure rule engine)
function evaluateContainer(url, currentCookieStoreId) {
  const { containerMap, cookieStoreToNameMap } = CtcRepo.getContainerData();
  const rules = CtcRepo.getRules();

  // GRACEFUL DEGRADATION: If CtcRepo isn't initialized, stay in current container
  // RATIONALE: Better to leave user in wrong container than block navigation
  // RECOVERY: Next navigation will retry initialization
  if (containerMap.size <= 1) {
    ctcConsole.warn("CtcRepo not initialized - staying in current container");
    return currentCookieStoreId; // Stay put
  }

  if (!Array.isArray(rules)) {
    ctcConsole.warn("CtcRepo rules corrupted - staying in current container");
    return currentCookieStoreId; // Stay put
  }

  // Get current container name
  const currentContainerName =
    cookieStoreToNameMap.get(currentCookieStoreId) || "No Container";

  // Use the pure rule engine
  const targetContainerName = evaluateContainerForUrl(
    url,
    currentContainerName,
    rules,
    containerMap,
  );

  // Convert container name back to cookieStoreId
  if (targetContainerName === "No Container") {
    return "firefox-default";
  }

  return containerMap.get(targetContainerName) || "firefox-default";
}
