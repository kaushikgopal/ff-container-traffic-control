// Container Traffic Control Background Script
// Handles URL redirection based on user-defined rules

// Event listeners
browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
);

// Track HTTP redirects for debugging
browser.webRequest.onBeforeRedirect.addListener(
    (details) => {
        ctcConsole.log(`🔗 HTTP REDIRECT: ${details.url} → ${details.redirectUrl} (tabId: ${details.tabId})`);
    },
    { urls: ["<all_urls>"], types: ["main_frame"] }
);

browser.storage.onChanged.addListener((changes, areaName) => {
    if (changes.ctcRules && areaName === 'sync') {
        ctcConsole.log('rules were updated, reloading rules...');
        CtcRepo.loadRules();
    }
});

browser.contextualIdentities.onCreated.addListener(() => {
    ctcConsole.log('container was created, reloading containers...');
    CtcRepo.loadContainers();
});

browser.contextualIdentities.onRemoved.addListener(() => {
    ctcConsole.log('container was removed, reloading containers...');
    CtcRepo.loadContainers();
});

// Initialize on startup
CtcRepo.initialize();

// Track recent redirections to prevent loops
const recentRedirections = new Map();
const REDIRECT_COOLDOWN = 2000; // 2 seconds

// Track active tab requests to prevent duplicates
const activeTabRequests = new Map();
const REQUEST_COOLDOWN = 1000; // 1 second

// Main request handler
async function handleRequest(details) {
    try {
        // Log every URL request for debugging
        ctcConsole.log(`🌐 REQUEST: ${details.url} (tabId: ${details.tabId}, requestId: ${details.requestId})`);

        // Skip privileged URLs
        if (isPrivilegedURL(details.url)) {
            ctcConsole.log('⚠️  Skipping privileged URL:', details.url);
            return {};
        }

        // FIREFOX INTERNAL REDIRECTS: tabId -1 are Firefox's internal redirect processing
        // These shouldn't create new tabs - let Firefox handle redirects in the original tab
        if (details.tabId === -1) {
            ctcConsole.log('🚫 Skipping tabId -1 request (likely HTTP redirect artifact):', details.url);
            return {};
        }

        // DUPLICATE TAB-URL REQUESTS: Firefox fires multiple onBeforeRequest for same tab+URL
        // Causes: HTTPS upgrades, service workers, connection retries
        // Prevents same tab from processing same URL multiple times rapidly
        const tabRequestKey = `${details.tabId}-${details.url}`;
        const lastTabRequest = activeTabRequests.get(tabRequestKey);
        if (lastTabRequest && Date.now() - lastTabRequest < REQUEST_COOLDOWN) {
            ctcConsole.log('⏸️  Skipping duplicate tab request:', details.url, `(tabId: ${details.tabId})`);
            return {};
        }
        activeTabRequests.set(tabRequestKey, Date.now());

        // URL RACE CONDITIONS: Multiple tabs can compete to process same URL simultaneously
        // Prevents different tabs from creating duplicate tabs for same URL
        // Global URL-based deduplication with 2s cooldown
        const redirectKey = details.url;
        const lastRedirect = recentRedirections.get(redirectKey);
        if (lastRedirect && Date.now() - lastRedirect < REDIRECT_COOLDOWN) {
            ctcConsole.log('🔄 Skipping recent redirection to prevent loop:', details.url);
            return {};
        }

        // Get current container
        const currentCookieStoreId = await getCurrentContainer(details.tabId);
        const { cookieStoreToNameMap } = CtcRepo.getContainerData();
        const currentContainerName = cookieStoreToNameMap.get(currentCookieStoreId) || 'No Container';

        ctcConsole.log(`📍 Current: ${currentContainerName} (cookieStoreId: ${currentCookieStoreId})`);

        // Evaluate target container
        const targetCookieStoreId = evaluateContainer(details.url, currentCookieStoreId);
        const targetContainerName = cookieStoreToNameMap.get(targetCookieStoreId) || 'No Container';

        ctcConsole.log(`🎯 Target: ${targetContainerName} (cookieStoreId: ${targetCookieStoreId})`);

        // Switch if needed
        if (currentCookieStoreId !== targetCookieStoreId) {
            ctcConsole.log(`🔀 REDIRECT: ${currentContainerName} → ${targetContainerName} for ${details.url}`);

            // Record this redirection
            recentRedirections.set(redirectKey, Date.now());

            // Clean up old entries
            cleanupOldEntries();

            // Create new tab in target container
            ctcConsole.log(`🆕 Creating new tab in ${targetContainerName} (${targetCookieStoreId})`);
            const newTab = await browser.tabs.create({
                url: details.url,
                cookieStoreId: targetCookieStoreId,
                index: details.tabId >= 0 ? undefined : 0
            });
            ctcConsole.log(`✅ New tab created: ${newTab.id} in ${targetContainerName}`);

            // Close original tab if it exists
            if (details.tabId >= 0) {
                ctcConsole.log(`🗑️  Closing original tab: ${details.tabId}`);
                browser.tabs.remove(details.tabId);
            }

            // Cancel original request
            ctcConsole.log(`❌ Cancelling original request for ${details.url}`);
            return { cancel: true };
        } else {
            ctcConsole.log(`✅ STAY: Remaining in ${currentContainerName} for ${details.url}`);
        }

        return {};
    } catch (error) {
        ctcConsole.error('💥 Error handling request:', error);
        return {};
    }
}

// Clean up old tracking entries
function cleanupOldEntries() {
    const now = Date.now();

    // Clean up redirection tracking
    for (const [key, timestamp] of recentRedirections.entries()) {
        if (now - timestamp > REDIRECT_COOLDOWN) {
            recentRedirections.delete(key);
        }
    }

    // Clean up tab request tracking
    for (const [key, timestamp] of activeTabRequests.entries()) {
        if (now - timestamp > REQUEST_COOLDOWN) {
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

    ctcConsole.groupCollapsed(`Evaluating URL: ${url}`);

    // Use the pure rule engine
    const targetContainerName = evaluateContainerForUrl(url, currentContainerName, rules, containerMap);

    ctcConsole.groupEnd();

    // Convert container name back to cookieStoreId
    if (targetContainerName === 'No Container') {
        return 'firefox-default';
    }

    return containerMap.get(targetContainerName) || 'firefox-default';
}

