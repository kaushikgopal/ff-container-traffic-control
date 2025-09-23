// Shared utilities for Container Traffic Control
// This file provides common functions used across background and options scripts

const DEBUG = true; // Could be made configurable via storage in the future

/**
 * Creates bound console methods with CTC formatting and debug control
 * @returns {Object} Console object with CTC-prefixed methods
 */
function createCtcConsole() {
    return {
        // Always-on methods (errors, warnings, important info)
        error: console.error.bind(console, '[CTC]'),
        warn: console.warn.bind(console, '[CTC]'),
        info: console.info.bind(console, '[CTC]'),

        // Debug-controlled methods (only active when DEBUG is true)
        log: DEBUG ? console.log.bind(console, '[CTC]') : () => {},
        table: DEBUG ? console.table.bind(console) : undefined,
    };
}

// Create and export the console instance
const ctcConsole = createCtcConsole();

// Make available globally for both background and options scripts
if (typeof window !== 'undefined') {
    window.ctcConsole = ctcConsole;
} else {
    // For background scripts that might not have window object
    globalThis.ctcConsole = ctcConsole;
}

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
        ctcConsole.error('Invalid pattern:', pattern, error);
        return false;
    }
}

// Make utilities available globally
if (typeof window !== 'undefined') {
    window.matchesPattern = matchesPattern;
} else {
    globalThis.matchesPattern = matchesPattern;
}

// Export for Node.js environments (tests)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { matchesPattern };
}
