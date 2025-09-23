// Container Traffic Control Background Script
// Handles URL redirection based on user-defined rules

// Event listeners
browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
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

// Main request handler
async function handleRequest(details) {
    try {
        // Skip privileged URLs
        if (isPrivilegedURL(details.url)) {
            ctcConsole.log('Skipping privileged URL:', details.url);
            return {};
        }

        // Get current container
        const currentCookieStoreId = await getCurrentContainer(details.tabId);

        // Evaluate target container
        const targetCookieStoreId = evaluateContainer(details.url, currentCookieStoreId);

        // Switch if needed
        if (currentCookieStoreId !== targetCookieStoreId) {
            const { cookieStoreToNameMap } = CtcRepo.getContainerData();
            ctcConsole.log(`Redirecting from ${cookieStoreToNameMap.get(currentCookieStoreId)} to ${cookieStoreToNameMap.get(targetCookieStoreId)}`);

            // Create new tab in target container
            browser.tabs.create({
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

