// Container Traffic Control Rule Engine
// Pure JavaScript rule evaluation logic (testable, no browser dependencies)

/**
 * URL pattern matching with dual-mode support
 * @param {string} url - URL to test
 * @param {string} pattern - Pattern (regex if enclosed in /.../, literal otherwise)
 * @returns {boolean} Whether URL matches pattern
 */
function matchesPattern(url, pattern) {
    if (!pattern) return false;

    try {
        // Check if pattern is regex mode (enclosed in /.../)
        if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
            // Regex mode: strip slashes and use as regex
            const regexPattern = pattern.slice(1, -1);
            const regex = new RegExp(regexPattern);
            return regex.test(url);
        } else {
            // Literal mode: simple contains match
            return url.includes(pattern);
        }
    } catch (error) {
        console.error('Invalid pattern:', pattern, error);
        return false;
    }
}

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

    console.log(`Evaluating URL: ${url}`);
    console.log('Current container:', targetContainer);

    // 2. Check if we need to boot from restricted container
    if (targetContainer !== 'No Container') {
        const containerRules = rules.filter(rule => rule.containerName === targetContainer);
        const hasAllowOnlyRules = containerRules.some(rule => rule.action === 'allow_only');

        if (hasAllowOnlyRules) {
            const matchesAnyRule = containerRules.some(rule => matchesPattern(url, rule.urlPattern));
            if (!matchesAnyRule) {
                console.log(`Booting from restricted container: ${targetContainer}`);
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

    console.log('Allowed containers:', allowedContainers);

    // 4. Select final container
    if (targetContainer && allowedContainers.some(c => c.name === targetContainer)) {
        console.log(`Staying in current container: ${targetContainer}`);
        return targetContainer;
    }

    // Find high priority containers first
    const highPriorityContainers = allowedContainers.filter(c => c.highPriority);
    if (highPriorityContainers.length > 0) {
        // Sort by rule index (first rule wins)
        highPriorityContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        const selected = highPriorityContainers[0].name;
        console.log(`Selected high priority container: ${selected}`);
        return selected;
    }

    // Use first allowed container (by rule order)
    if (allowedContainers.length > 0) {
        allowedContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        const selected = allowedContainers[0].name;
        console.log(`Selected first allowed container: ${selected}`);
        return selected;
    }

    // Default to no container
    console.log('No matching rules, using No Container');
    return 'No Container';
}

// Export for both browser and test environments
if (typeof window !== 'undefined') {
    // Browser environment
    window.evaluateContainerForUrl = evaluateContainerForUrl;
} else if (typeof module !== 'undefined' && module.exports) {
    // Node.js environment
    module.exports = { evaluateContainerForUrl, matchesPattern };
}