// Container Traffic Control Background Script
// Handles URL redirection based on user-defined rules

// Global state
let rules = [];
let containerMap = new Map(); // containerName -> cookieStoreId
let cookieStoreToNameMap = new Map(); // cookieStoreId -> containerName

// Event listeners
browser.webRequest.onBeforeRequest.addListener(
    handleRequest,
    { urls: ["<all_urls>"], types: ["main_frame"] },
    ["blocking"]
);

browser.storage.onChanged.addListener((changes) => {
    if (changes.ctcRules) {
        ctcConsole.log('rules were updated, reloading rules...');
        loadRules();
    }
});

browser.contextualIdentities.onCreated.addListener(() => {
    ctcConsole.log('container was created, reloading containers...');
    loadContainers();
});

browser.contextualIdentities.onRemoved.addListener(() => {
    ctcConsole.log('container was removed, reloading containers...');
    loadContainers();
});

// Initialize on startup
initialize();


async function initialize() {
    await loadContainers();
    await loadRules();
    ctcConsole.info('initialized with', rules.length, 'rules &', containerMap.size, 'containers');
}

async function loadContainers() {
    try {
        const contextualIdentities = await browser.contextualIdentities.query({});
        containerMap.clear();
        cookieStoreToNameMap.clear();

        // Add default container
        containerMap.set('No Container', 'firefox-default');
        cookieStoreToNameMap.set('firefox-default', 'No Container');

        contextualIdentities.forEach(identity => {
            containerMap.set(identity.name, identity.cookieStoreId);
            cookieStoreToNameMap.set(identity.cookieStoreId, identity.name);
        });

        ctcConsole.debug('loaded containers:', Array.from(containerMap.entries()));
    } catch (error) {
        ctcConsole.error('Failed to load containers:', error);
    }
}

// Load rules from storage
async function loadRules() {
    try {
        const storage = await browser.storage.local.get('ctcRules');
        rules = storage.ctcRules || [];
        ctcConsole.debug('loaded rules:', rules);
    } catch (error) {
        ctcConsole.error('Failed to load rules:', error);
    }
}

// Main request handler
async function handleRequest(details) {
    try {
        // Skip privileged URLs
        if (isPrivilegedURL(details.url)) {
            ctcConsole.debug('Skipping privileged URL:', details.url);
            return {};
        }

        // Get current container
        const currentCookieStoreId = await getCurrentContainer(details.tabId);

        // Evaluate target container
        const targetCookieStoreId = evaluateContainer(details.url, currentCookieStoreId);

        // Switch if needed
        if (currentCookieStoreId !== targetCookieStoreId) {
            ctcConsole.info(`Redirecting from ${cookieStoreToNameMap.get(currentCookieStoreId)} to ${cookieStoreToNameMap.get(targetCookieStoreId)}`);

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

// Rule evaluation function
function evaluateContainer(url, currentCookieStoreId) {
    // 1. Get current container name
    let targetContainer = cookieStoreToNameMap.get(currentCookieStoreId) || 'No Container';

    ctcConsole.groupCollapsed(`Evaluating URL: ${url}`);
    ctcConsole.debug('Current container:', targetContainer);

    // 2. Check if we need to boot from restricted container
    if (targetContainer !== 'No Container') {
        const containerRules = rules.filter(rule => rule.containerName === targetContainer);
        const hasAllowOnlyRules = containerRules.some(rule => rule.action === 'allow_only');

        if (hasAllowOnlyRules) {
            const matchesAnyRule = containerRules.some(rule => matchesPattern(url, rule.urlPattern));
            if (!matchesAnyRule) {
                ctcConsole.debug(`Booting from restricted container: ${targetContainer}`);
                targetContainer = null; // Must leave this container
            }
        }
    }

    // 3. Find allowed containers for URL
    const allowedContainers = [];
    rules.forEach(rule => {
        if (matchesPattern(url, rule.urlPattern)) {
            allowedContainers.push({
                name: rule.containerName,
                highPriority: rule.highPriority,
                ruleIndex: rules.indexOf(rule)
            });
        }
    });

    ctcConsole.debug('Allowed containers:', allowedContainers);

    // 4. Select final container
    if (targetContainer && allowedContainers.some(c => c.name === targetContainer)) {
        ctcConsole.debug(`Staying in current container: ${targetContainer}`);
        ctcConsole.groupEnd();
        return containerMap.get(targetContainer);
    }

    // Find high priority containers first
    const highPriorityContainers = allowedContainers.filter(c => c.highPriority);
    if (highPriorityContainers.length > 0) {
        // Sort by rule index (first rule wins)
        highPriorityContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        const selected = highPriorityContainers[0].name;
        ctcConsole.debug(`Selected high priority container: ${selected}`);
        ctcConsole.groupEnd();
        return containerMap.get(selected);
    }

    // Use first allowed container (by rule order)
    if (allowedContainers.length > 0) {
        allowedContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        const selected = allowedContainers[0].name;
        ctcConsole.debug(`Selected first allowed container: ${selected}`);
        ctcConsole.groupEnd();
        return containerMap.get(selected);
    }

    // Default to no container
    ctcConsole.debug('No matching rules, using No Container');
    ctcConsole.groupEnd();
    return 'firefox-default';
}

// URL pattern matching
function matchesPattern(url, pattern) {
    try {
        const regex = new RegExp(pattern);
        return regex.test(url);
    } catch (error) {
        ctcConsole.error('Invalid regex pattern:', pattern, error);
        return false;
    }
}
