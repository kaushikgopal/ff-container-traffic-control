// Container Traffic Control Background Script
// Handles URL redirection based on user-defined rules

// Event listeners
browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
);

// Track HTTP redirects and re-evaluate container rules
browser.webRequest.onBeforeRedirect.addListener(
    async (details) => {
        ctcConsole.log(`HTTP redirect: ${details.url} -> ${details.redirectUrl}`);

        // Re-evaluate container rules for the redirect destination
        try {
            const currentCookieStoreId = await getCurrentContainer(details.tabId);
            const { cookieStoreToNameMap } = CtcRepo.getContainerData();
            const currentContainerName = cookieStoreToNameMap.get(currentCookieStoreId) || 'No Container';

            // Evaluate target container for redirect destination
            const targetCookieStoreId = evaluateContainer(details.redirectUrl, currentCookieStoreId);
            const targetContainerName = cookieStoreToNameMap.get(targetCookieStoreId) || 'No Container';

            ctcConsole.log(`Re-evaluating redirect ${details.redirectUrl} [${currentContainerName} -> ${targetContainerName}]`);

            // Switch containers if needed
            if (currentCookieStoreId !== targetCookieStoreId) {
                ctcConsole.info(`Container switch on redirect: ${currentContainerName} → ${targetContainerName} for ${details.redirectUrl}`);

                // Create new tab in target container
                const newTab = await browser.tabs.create({
                    url: details.redirectUrl,
                    cookieStoreId: targetCookieStoreId,
                    index: details.tabId >= 0 ? undefined : 0
                });

                // Close original tab if it exists
                if (details.tabId >= 0) {
                    browser.tabs.remove(details.tabId);
                }
            }
        } catch (error) {
            ctcConsole.error('Error re-evaluating redirect:', error);
        }
    },
    { urls: ["<all_urls>"], types: ["main_frame"] }
);

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
const REDIRECT_COOLDOWN_MS = 2000; // 2 seconds
const REQUEST_COOLDOWN_MS = 1000; // 1 second

// Track recent redirections to prevent loops
const recentRedirections = new Map();

// Track active tab requests to prevent duplicates
const activeTabRequests = new Map();

// Main request handler
async function handleRequest(details) {
    try {
        // Skip privileged URLs
        if (isPrivilegedURL(details.url)) {
            return {};
        }

        // Skip requests with tabId -1 that are likely HTTP redirect artifacts
        if (details.tabId === -1) {
            return {};
        }

        // Check for duplicate tab requests to prevent multiple processing
        const tabRequestKey = `${details.tabId}-${details.url}`;
        const lastTabRequest = activeTabRequests.get(tabRequestKey);
        if (lastTabRequest && Date.now() - lastTabRequest < REQUEST_COOLDOWN_MS) {
            return {};
        }
        activeTabRequests.set(tabRequestKey, Date.now());

        // Check for recent redirection to prevent loops (URL-based)
        const redirectKey = details.url;
        const lastRedirect = recentRedirections.get(redirectKey);
        if (lastRedirect && Date.now() - lastRedirect < REDIRECT_COOLDOWN_MS) {
            return {};
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

        // Switch if needed
        if (currentCookieStoreId !== targetCookieStoreId) {
            ctcConsole.info(`Container switch: ${currentContainerName} → ${targetContainerName} for ${details.url}`);

            // Record this redirection
            recentRedirections.set(redirectKey, Date.now());

            // Clean up old entries
            pruneTrackingMaps();

            // Create new tab in target container
            const newTab = await browser.tabs.create({
                url: details.url,
                cookieStoreId: targetCookieStoreId,
                index: details.tabId >= 0 ? undefined : 0
            });

            // Close original tab if it exists
            if (details.tabId >= 0) {
                browser.tabs.remove(details.tabId);
            }

            // Cancel original request
            return { cancel: true };
        }

        return {};
    } catch (error) {
        ctcConsole.error('Error handling request:', error);
        return {};
    }
}

// Clean up old tracking entries
function pruneTrackingMaps() {
    const now = Date.now();

    // Clean up redirection tracking
    for (const [key, timestamp] of recentRedirections.entries()) {
        if (now - timestamp > REDIRECT_COOLDOWN_MS) {
            recentRedirections.delete(key);
        }
    }

    // Clean up tab request tracking
    for (const [key, timestamp] of activeTabRequests.entries()) {
        if (now - timestamp > REQUEST_COOLDOWN_MS) {
            activeTabRequests.delete(key);
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

// Get current container for a tab
async function getCurrentContainer(tabId) {
    if (tabId < 0) return 'firefox-default'; // New tab

    try {
        const tab = await browser.tabs.get(tabId);
        return tab.cookieStoreId || 'firefox-default';
    } catch (error) {
        ctcConsole.error('Failed to get tab info:', error);
        return 'firefox-default';
    }
}

// Rule evaluation function (wrapper around pure rule engine)
function evaluateContainer(url, currentCookieStoreId) {
    const { containerMap, cookieStoreToNameMap } = CtcRepo.getContainerData();
    const rules = CtcRepo.getRules();

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

