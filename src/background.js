// Container Traffic Control Background Script
// Handles URL redirection based on user-defined rules

// CRITICAL: Main navigation interceptor - all page loads go through this
// Using "blocking" mode means we can cancel/redirect requests before they complete
// FAILURE MODE: If this crashes, all navigation breaks
browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
);

// HTTP redirects are now handled entirely by onBeforeRequest
// when the redirected URL loads - no separate handler needed

browser.storage.onChanged.addListener((changes, areaName) => {
    if (changes.ctcRules && areaName === 'sync') {
        CtcRepo.loadRules();
    }
});

browser.contextualIdentities.onCreated.addListener(() => {
    CtcRepo.loadContainers();
});

browser.contextualIdentities.onRemoved.addListener(() => {
    CtcRepo.loadContainers();
});

// Initialize on startup
CtcRepo.initialize();

// Constants
const EXPIRY_REDIRECT_MS = 2000; // 2 seconds
const EXPIRY_TAB_REQUEST_MS = 1000; // 1 second
const CLEANUP_SIZE_THRESHOLD = 100; // Clean up when Maps exceed this size

// Track recent redirections to prevent loops
const recentRedirections = new Map();

// Prevents duplicate processing of the same navigation request
const recentTabRequests = new Map();

// Main request handler
async function handleRequest(details) {
    try {
        // SAFETY: Never redirect browser internal URLs
        // FAILURE MODE: Redirecting about:config could break Firefox
        if (isPrivilegedURL(details.url)) {
            return {};
        }

        // EDGE CASE: tabId -1 means "no tab" - usually HTTP redirect artifacts
        // Processing these creates phantom tabs that confuse users
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
        if (recentTabRequests.size > CLEANUP_SIZE_THRESHOLD ||
            recentRedirections.size > CLEANUP_SIZE_THRESHOLD) {
            pruneTrackingMaps();
        }

        // MAINTENANCE: Clean up when Maps get large to prevent memory bloat
        if (recentTabRequests.size > CLEANUP_SIZE_THRESHOLD ||
            recentRedirections.size > CLEANUP_SIZE_THRESHOLD) {
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

        // Get current container
        const currentCookieStoreId = await getCurrentContainer(details.tabId);
        const { cookieStoreToNameMap } = CtcRepo.getContainerData();
        const currentContainerName = cookieStoreToNameMap.get(currentCookieStoreId) || 'No Container';

        // Evaluate target container
        const targetCookieStoreId = evaluateContainer(details.url, currentCookieStoreId);
        const targetContainerName = cookieStoreToNameMap.get(targetCookieStoreId) || 'No Container';

        // Log evaluation result for debugging
        ctcConsole.log(`Evaluating ${details.url} [${currentContainerName} -> ${targetContainerName}]`);

        // DECISION POINT: Container switch required?
        if (currentCookieStoreId !== targetCookieStoreId) {
            ctcConsole.info(`Container switch: ${currentContainerName} → ${targetContainerName} for ${details.url}`);

            // CRITICAL: Record redirect BEFORE creating tab to prevent loops
            // Must happen before tab creation to catch race conditions
            recentRedirections.set(redirectKey, Date.now());

            // ATOMIC OPERATION: Create new tab in correct container
            // FAILURE MODE: If this fails, user loses navigation entirely
            const newTab = await browser.tabs.create({
                url: details.url,
                cookieStoreId: targetCookieStoreId,
                index: details.tabId >= 0 ? undefined : 0
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
        ctcConsole.error('Error handling request:', error);
        return {}; // Allow navigation to proceed normally
    }
}

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
}

// Check if URL is privileged (should not be redirected)
function isPrivilegedURL(url) {
    return url.startsWith('about:') ||
           url.startsWith('moz-extension:') ||
           url.startsWith('chrome:') ||
           url.startsWith('resource:');
}

// LOOKUP: Determine which container a tab is currently in
// EDGE CASE: tabId < 0 means "new tab" or system-generated navigation
async function getCurrentContainer(tabId) {
    if (tabId < 0) return 'firefox-default'; // New tab has no container

    try {
        const tab = await browser.tabs.get(tabId);
        // FALLBACK: Some tabs have no cookieStoreId (private browsing, etc)
        return tab.cookieStoreId || 'firefox-default';
    } catch (error) {
        // RECOVERY: Tab might have been closed while we were processing
        ctcConsole.error('Failed to get tab info:', error);
        return 'firefox-default'; // Safe default
    }
}

// Rule evaluation function (wrapper around pure rule engine)
function evaluateContainer(url, currentCookieStoreId) {
    const { containerMap, cookieStoreToNameMap } = CtcRepo.getContainerData();
    const rules = CtcRepo.getRules();

    // FAIL FAST: If CtcRepo isn't initialized, something is seriously wrong
    if (containerMap.size <= 1) {
        throw new Error('CtcRepo not initialized - no containers loaded');
    }

    if (!Array.isArray(rules)) {
        throw new Error('CtcRepo rules corrupted');
    }

    // Get current container name
    const currentContainerName = cookieStoreToNameMap.get(currentCookieStoreId) || 'No Container';

    // Use the pure rule engine
    const targetContainerName = evaluateContainerForUrl(url, currentContainerName, rules, containerMap);

    // Convert container name back to cookieStoreId
    if (targetContainerName === 'No Container') {
        return 'firefox-default';
    }

    return containerMap.get(targetContainerName) || 'firefox-default';
}

