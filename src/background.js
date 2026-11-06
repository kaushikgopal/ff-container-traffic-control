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
    CtcRepo.loadRules().catch((error) => {
      ctcConsole.error("[Background] Failed to reload rules:", error);
    });
  }
});

browser.contextualIdentities.onCreated.addListener(() => {
  CtcRepo.loadContainers();
});

browser.contextualIdentities.onRemoved.addListener(() => {
  CtcRepo.loadContainers();
});
browser.contextualIdentities.onUpdated.addListener(() => {
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

// Track only redirect work that still depends on its source tab.
// Completed requests leave no cooldown that can suppress a later navigation.
const pendingRedirects = new Map();

browser.tabs.onRemoved.addListener((tabId) => {
  const workItems = pendingRedirects.get(tabId);
  if (!workItems) return;

  for (const work of workItems) {
    if (work.removingSource) continue;

    work.sourceClosed = true;
    removeReplacementTab(work);
  }
});

function registerSourceWork(tabId) {
  const work = {
    sourceClosed: false,
    removingSource: false,
    replacementTabId: null,
    replacementRemovalPromise: null,
  };
  const workItems = pendingRedirects.get(tabId) || new Set();
  workItems.add(work);
  pendingRedirects.set(tabId, workItems);
  return work;
}

function releaseSourceWork(tabId, work) {
  if (!work) return;
  const workItems = pendingRedirects.get(tabId);
  workItems.delete(work);
  if (workItems.size === 0) pendingRedirects.delete(tabId);
}

function removeReplacementTab(work) {
  if (work.replacementRemovalPromise) return work.replacementRemovalPromise;
  if (work.replacementTabId === null) return Promise.resolve();

  const replacementTabId = work.replacementTabId;
  work.replacementTabId = null;
  work.replacementRemovalPromise = browser.tabs.remove(replacementTabId).catch(
    (error) => {
      ctcConsole.error(
        `Failed to remove replacement tab ${replacementTabId}:`,
        error,
      );
    },
  );
  return work.replacementRemovalPromise;
}

// PUBLIC: Main request handler (used by webRequest listener)
async function handleRequest(details) {
  let sourceWork = null;
  try {
    // Wait for startup initialization, but allow navigation after a timeout.
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
      }
    }

    ctcConsole.log(`Received request for ${details.url}`);

    if (isPrivilegedURL(details.url) || details.tabId === -1) {
      return {};
    }

    if (details.tabId >= 0) {
      sourceWork = registerSourceWork(details.tabId);
    }

    const tabInfo = await getTabInfo(details.tabId);
    if (!tabInfo || (sourceWork && sourceWork.sourceClosed)) {
      return {};
    }

    const { cookieStoreId: currentCookieStoreId, active: tabWasActive } =
      tabInfo;
    const { cookieStoreToNameMap } = CtcRepo.getContainerData();
    const currentContainerName =
      cookieStoreToNameMap.get(currentCookieStoreId) || "No Container";
    const targetCookieStoreId = evaluateContainer(
      details.url,
      currentCookieStoreId,
    );
    const targetContainerName =
      cookieStoreToNameMap.get(targetCookieStoreId) || "No Container";

    ctcConsole.log(
      `Evaluating ${details.url} [${currentContainerName} -> ${targetContainerName}]`,
    );

    if (currentCookieStoreId === targetCookieStoreId) {
      return {};
    }

    if (sourceWork && sourceWork.sourceClosed) {
      return {};
    }

    ctcConsole.info(
      `Container switch: ${currentContainerName} → ${targetContainerName} for ${details.url}`,
    );

    const newTab = await browser.tabs.create({
      url: details.url,
      cookieStoreId: targetCookieStoreId,
      active: tabWasActive,
      index: details.tabId >= 0 ? undefined : 0,
    });
    if (sourceWork) {
      sourceWork.replacementTabId = newTab.id;
      if (sourceWork.sourceClosed) {
        await removeReplacementTab(sourceWork);
        return {};
      }

      sourceWork.removingSource = true;
      try {
        await browser.tabs.remove(details.tabId);
      } catch (error) {
        sourceWork.removingSource = false;
        ctcConsole.error("Failed to remove source tab:", error);
        await removeReplacementTab(sourceWork);
        return {};
      }
      sourceWork.replacementTabId = null;
    }

    return { cancel: true };
  } catch (error) {
    ctcConsole.error("Error handling request:", error);
    return {};
  } finally {
    releaseSourceWork(details.tabId, sourceWork);
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
// RETURNS: { cookieStoreId: string, active: boolean }
async function getTabInfo(tabId) {
  if (tabId < 0) {
    return { cookieStoreId: "firefox-default", active: true };
  }

  try {
    const tab = await browser.tabs.get(tabId);
    return {
      cookieStoreId: tab.cookieStoreId || "firefox-default",
      active: tab.active,
    };
  } catch (error) {
    ctcConsole.error("Failed to get tab info:", error);
    return null;
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
  if (targetContainerName === currentContainerName) {
    return currentCookieStoreId;
  }
  if (targetContainerName === "No Container") {
    return "firefox-default";
  }

  return containerMap.get(targetContainerName) || "firefox-default";
}
