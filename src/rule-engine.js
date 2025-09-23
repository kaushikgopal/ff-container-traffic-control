// Container Traffic Control Rule Engine
// Pure JavaScript rule evaluation logic (testable, no browser dependencies)


/**
 * Core rule evaluation logic (pure function, no browser dependencies)
 * @param {string} url - URL being navigated to
 * @param {string} currentContainerName - Name of current container
 * @param {Array} rules - Array of rule objects
 * @param {Map} containerMap - Map of container names to IDs
 * @returns {string} Target container name
 */
function evaluateContainerForUrl(url, currentContainerName, rules, containerMap) {
    // 1. Get current container name (default to 'No Container' if not found)
    let targetContainer = currentContainerName || 'No Container';


    // 2. Check if we need to boot from restricted container
    if (targetContainer !== 'No Container') {
        const containerRules = rules.filter(rule => rule.containerName === targetContainer);
        const hasAllowOnlyRules = containerRules.some(rule => rule.action === 'allow_only');

        if (hasAllowOnlyRules) {
            const matchesAnyRule = containerRules.some(rule => matchesPattern(url, rule.urlPattern));
            if (!matchesAnyRule) {
                targetContainer = null; // Must leave this container
            }
        }
    }

    // 3. Find allowed containers for URL
    const allowedContainers = [];
    rules.forEach((rule, index) => {
        if (matchesPattern(url, rule.urlPattern)) {
            allowedContainers.push({
                name: rule.containerName,
                highPriority: rule.highPriority,
                ruleIndex: index
            });
        }
    });


    // 4. Select final container
    if (targetContainer && allowedContainers.some(c => c.name === targetContainer)) {
        return targetContainer;
    }

    // Find high priority containers first
    const highPriorityContainers = allowedContainers.filter(c => c.highPriority);
    if (highPriorityContainers.length > 0) {
        // Sort by rule index (first rule wins)
        highPriorityContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        return highPriorityContainers[0].name;
    }

    // Use first allowed container (by rule order)
    if (allowedContainers.length > 0) {
        allowedContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        return allowedContainers[0].name;
    }

    // Default to current container (stay put when no rules match)
    return targetContainer || 'No Container';
}

// Export for both browser and test environments
if (typeof window !== 'undefined') {
    // Browser environment
    window.evaluateContainerForUrl = evaluateContainerForUrl;
} else if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = { evaluateContainerForUrl };
}