// Container Traffic Control Rule Engine
// Pure JavaScript rule evaluation logic (testable, no browser dependencies)

// ============================================================================
// RULE EVALUATION ALGORITHM: Four-Phase Container Selection
// ============================================================================
// This is the CORE LOGIC that decides which container a URL should load in.
// Algorithm balances three competing goals:
//    1. STICKY: Prefer staying in current container (minimize tab switching)
//    2. RESTRICTIVE: Enforce container isolation when configured
//    3. DETERMINISTIC: Same URL always goes to same container (no randomness)
//
// PHASE 1: Start with current container (stay put by default)
// PHASE 2: Check restricted container rules (must leave if URL doesn't match)
// PHASE 3: Find all containers with matching rules
// PHASE 4: Select best container using precedence rules
//
// RULE PRECEDENCE (highest to lowest):
//    1. Current container (if allowed by its rules)
//    2. High-priority rules (first match wins)
//    3. Normal rules (first match wins)
//    4. No Container (default fallback)
//
// PURE FUNCTION: No side effects, no browser APIs, fully testable
// ============================================================================

/**
 * Core rule evaluation logic (pure function, no browser dependencies)
 * @param {string} url - URL being navigated to
 * @param {string} currentContainerName - Name of current container
 * @param {Array} rules - Array of rule objects
 * @param {Map} containerMap - Map of container names to IDs
 * @returns {string} Target container name
 */
function evaluateContainerForUrl(url, currentContainerName, rules, containerMap) {
    // ========================================================================
    // PHASE 1: Start with current container (sticky behavior)
    // ========================================================================
    // WHY: Minimize tab switching - prefer staying put unless rules say otherwise
    // BENEFIT: Less jarring UX, fewer container switches during browsing
    // ========================================================================
    let targetContainer = currentContainerName || 'No Container';

    // ========================================================================
    // PHASE 2: Check if we must LEAVE current restricted container
    // ========================================================================
    // RESTRICTED CONTAINERS: Only allow explicitly whitelisted URLs
    // RULE TYPE: { action: "restricted", urlPattern: "..." }
    //
    // BEHAVIOR:
    //    - If current container has restricted rules
    //    - AND URL doesn't match ANY of those rules
    //    - THEN we must leave (set targetContainer = null)
    //
    // EXAMPLE:
    //    Work container: restricted to "work.com"
    //    User navigates to "personal.com" from Work
    //    Result: Must leave Work container
    //
    // WHY null: Forces re-evaluation below, don't stay in wrong container
    // ========================================================================
    if (targetContainer !== 'No Container') {
        const containerRules = rules.filter(rule => rule.containerName === targetContainer);
        const hasRestrictedRules = containerRules.some(rule => rule.action === 'restricted');

        if (hasRestrictedRules) {
            const matchesAnyRule = containerRules.some(rule => matchesPattern(url, rule.urlPattern));
            if (!matchesAnyRule) {
                targetContainer = null; // Must leave this container
            }
        }
    }

    // ========================================================================
    // PHASE 3: Find ALL containers with rules matching this URL
    // ========================================================================
    // BUILD CANDIDATE LIST: All containers whose rules match the URL
    // RULE TYPES:
    //    - "open": Container accepts this URL (and any others)
    //    - "restricted": Container ONLY accepts this URL
    //
    // PRECEDENCE TRACKING:
    //    - Store rule index to preserve rule order
    //    - Store highPriority flag for precedence sorting
    //
    // RESULT: Array of candidates with metadata for sorting
    // ========================================================================
    const allowedContainers = [];
    rules.forEach((rule, index) => {
        if (matchesPattern(url, rule.urlPattern)) {
            allowedContainers.push({
                name: rule.containerName,
                highPriority: rule.highPriority,
                ruleIndex: index  // Preserves rule order for tie-breaking
            });
        }
    });

    // ========================================================================
    // PHASE 4: Select final container using precedence rules
    // ========================================================================
    // PRECEDENCE ORDER (highest to lowest):
    //    1. Current container (if it's in allowedContainers) → stay put
    //    2. High-priority rules (first match by rule order)
    //    3. Normal-priority rules (first match by rule order)
    //    4. Current container (even if no match) → stay put fallback
    //    5. No Container (absolute fallback)
    //
    // WHY THIS ORDER:
    //    - Sticky behavior reduces unnecessary tab switching
    //    - High-priority rules override sticky behavior for important URLs
    //    - Rule order matters for deterministic behavior
    //    - Always return something (never undefined)
    // ========================================================================

    // PRECEDENCE 1: Stay in current container if it matches
    if (targetContainer && allowedContainers.some(c => c.name === targetContainer)) {
        return targetContainer;
    }

    // PRECEDENCE 2: High-priority rules take precedence over everything
    const highPriorityContainers = allowedContainers.filter(c => c.highPriority);
    if (highPriorityContainers.length > 0) {
        // Sort by rule index (first rule wins for ties)
        highPriorityContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        return highPriorityContainers[0].name;
    }

    // PRECEDENCE 3: Use first allowed container (by rule order)
    if (allowedContainers.length > 0) {
        allowedContainers.sort((a, b) => a.ruleIndex - b.ruleIndex);
        return allowedContainers[0].name;
    }

    // PRECEDENCE 4: No matches → stay in current container (if valid)
    // PRECEDENCE 5: Absolute fallback → No Container
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