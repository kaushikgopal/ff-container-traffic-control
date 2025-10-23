// Container Traffic Control Pattern Matching
// URL pattern matching with dual-mode support (literal and regex)

/**
 * Match URL against pattern with dual-mode support
 *
 * PATTERN MODES:
 *   1. LITERAL MODE: Simple string matching
 *      Example: "github.com" matches any URL containing "github.com"
 *
 *   2. REGEX MODE: Advanced pattern matching
 *      Example: "/.*\.github\.com/" matches subdomains
 *      Note: Pattern must be enclosed in forward slashes: /pattern/
 *
 * @param {string} url - URL to test
 * @param {string} pattern - Pattern (regex if enclosed in /.../, literal otherwise)
 * @returns {boolean} Whether URL matches pattern
 */
function matchesPattern(url, pattern) {
  if (!pattern) return false;

  try {
    // Check if pattern is regex mode (enclosed in /.../)
    if (
      pattern.startsWith("/") &&
      pattern.endsWith("/") &&
      pattern.length > 2
    ) {
      // Regex mode: strip slashes and use as regex
      const regexPattern = pattern.slice(1, -1);
      const regex = new RegExp(regexPattern);
      return regex.test(url);
    } else {
      // Literal mode: simple contains match
      return url.includes(pattern);
    }
  } catch (error) {
    // Defensive logging: ctcConsole may not be available in test environments
    if (typeof ctcConsole !== "undefined") {
      ctcConsole.error("Invalid pattern:", pattern, error);
    }
    return false;
  }
}

// ============================================================================
// EXPORTS: Make pattern matching available
// ============================================================================

// Export for Node.js environments (tests)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    matchesPattern,
  };
}

// Export for browser environments
if (typeof window !== "undefined") {
  window.matchesPattern = matchesPattern;
} else {
  globalThis.matchesPattern = matchesPattern;
}

