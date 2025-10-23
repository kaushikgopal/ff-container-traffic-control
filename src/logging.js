// Container Traffic Control Logging Infrastructure
// Provides debug-aware console logging with preference management

// ============================================================================
// EXECUTION CONTEXT PATTERN: Auto-Initializing Logging
// ============================================================================
// This file is loaded in BOTH contexts (background and options), creating
// independent instances of all logging utilities in each context:
//
// BACKGROUND CONTEXT:
//    - Has its own ctcConsole, debugLoggingEnabled flag, storage watchers
//    - Initialized when background.js loads (extension startup)
//    - Watches for storage changes to sync debug preference
//
// OPTIONS CONTEXT:
//    - Has its own ctcConsole, debugLoggingEnabled flag, storage watchers
//    - Initialized when options page opens
//    - Watches for storage changes to sync debug preference
//
// AUTO-INITIALIZATION (see bottom of file):
//    - Loads debug preference from storage on import
//    - Sets up storage change watcher automatically
//    - Both contexts run this initialization independently
//
// GLOBAL EXPORTS:
//    - Functions exported to window/globalThis for cross-script access
//    - Each context gets its own copy of these functions
//    - Enables all scripts to access logging utilities
// ============================================================================

const CTC_DEBUG_STORAGE_KEY = "ctcDebugLoggingEnabled";
let debugLoggingEnabled = false;

/**
 * Creates bound console methods with CTC formatting and debug control
 * @returns {Function} Wrapped emitter that respects debug flag
 */
function createDebugEmitter(emitter) {
  return (...args) => {
    if (!debugLoggingEnabled) {
      // We avoid emitting verbose logs while the user keeps debug disabled to prevent console noise.
      return;
    } else {
      emitter(...args);
    }
  };
}

/**
 * Create CTC-branded console with debug-aware logging
 * @returns {Object} Console object with CTC-prefixed methods
 */
function createCtcConsole() {
  const prefixedLogEmitter = (...args) => {
    console.log("[CTC]", ...args);
  };

  const tableEmitter = (...args) => {
    if (typeof console.table === "function") {
      console.table(...args);
    } else {
      console.log("[CTC]", ...args);
    }
  };

  return {
    // Always-on methods (errors, warnings, important info)
    error: console.error.bind(console, "[CTC]"),
    warn: console.warn.bind(console, "[CTC]"),
    info: console.info.bind(console, "[CTC]"),

    // Debug-controlled methods (only active when debug flag is true)
    log: createDebugEmitter(prefixedLogEmitter),
    debug: createDebugEmitter(prefixedLogEmitter),
    table: createDebugEmitter(tableEmitter),
  };
}

// Create and export the console instance
const ctcConsole = createCtcConsole();

/**
 * Check if browser storage API is available for debug preferences
 * @returns {boolean} True if storage API is available
 */
function isDebugPreferenceSupported() {
  if (typeof browser === "undefined") {
    // We run in tests without the browser API; treating storage as unavailable keeps Node execution happy.
    return false;
  } else {
    return Boolean(
      browser.storage &&
        browser.storage.sync &&
        browser.storage.onChanged &&
        typeof browser.storage.onChanged.addListener === "function"
    );
  }
}

/**
 * Get current debug logging state
 * @returns {boolean} True if debug logging is enabled
 */
function isDebugLoggingEnabled() {
  return debugLoggingEnabled;
}

/**
 * Set debug logging state
 * @param {boolean} enabled - Whether to enable debug logging
 */
function setDebugLoggingEnabled(enabled) {
  const normalizedEnabled = Boolean(enabled);
  if (debugLoggingEnabled === normalizedEnabled) {
    // We intentionally avoid touching listeners when the desired state already matches cached state.
    return;
  } else {
    debugLoggingEnabled = normalizedEnabled;
  }
}

/**
 * Load debug preference from storage on initialization
 * SIDE EFFECT: Sets global debugLoggingEnabled flag
 */
async function initializeDebugLoggingPreference() {
  if (!isDebugPreferenceSupported()) {
    // We skip storage initialization in environments without browser storage; debug remains false by design.
    return;
  } else {
    try {
      const stored = await browser.storage.sync.get(CTC_DEBUG_STORAGE_KEY);
      const storedValue = stored?.[CTC_DEBUG_STORAGE_KEY];
      setDebugLoggingEnabled(storedValue === true);
      if (storedValue === true) {
        ctcConsole.info("Debug logging enabled from saved preference.");
      } else {
        ctcConsole.debug("Debug logging defaulting to quiet mode.");
      }
    } catch (error) {
      ctcConsole.error("Failed to load debug logging preference:", error);
    }
  }
}

/**
 * Watch for debug preference changes in storage
 * SIDE EFFECT: Registers storage change listener
 */
function watchDebugLoggingPreferenceChanges() {
  if (!isDebugPreferenceSupported()) {
    // We cannot subscribe to storage changes when browser APIs are absent, so there is nothing to monitor.
    return;
  } else {
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") {
        // We only react to sync storage because options saves preferences there; other areas stay untouched.
        return;
      } else {
        if (Object.prototype.hasOwnProperty.call(changes, CTC_DEBUG_STORAGE_KEY)) {
          const { newValue } = changes[CTC_DEBUG_STORAGE_KEY];
          setDebugLoggingEnabled(newValue === true);
          if (newValue === true) {
            ctcConsole.info("Debug logging enabled by user preference change.");
          } else {
            ctcConsole.debug("Debug logging disabled by user preference change.");
          }
        } else {
          // We intentionally ignore unrelated storage updates so rule changes do not spam the console.
          return;
        }
      }
    });
  }
}

// ============================================================================
// AUTO-INITIALIZATION: Run on import (executes in each context independently)
// ============================================================================
// CRITICAL: These function calls happen automatically when this file loads
// WHY: Ensures debug logging preference is loaded before any logging occurs
// WHEN: Once per context (background on extension start, options on page open)
// WHAT: Loads saved preference + sets up storage change watcher
// ============================================================================
initializeDebugLoggingPreference();
watchDebugLoggingPreferenceChanges();

// ============================================================================
// GLOBAL EXPORTS: Make logging available across all scripts in this context
// ============================================================================
// PATTERN: Export to window (browser) or globalThis (workers/Node tests)
// SCOPE: Only accessible within same execution context
// ISOLATION: Background context's exports ≠ Options context's exports
// WHY: Enables all scripts to access logging utilities
// ============================================================================
if (typeof window !== "undefined") {
  window.ctcConsole = ctcConsole;
  window.setDebugLoggingEnabled = setDebugLoggingEnabled;
  window.isDebugLoggingEnabled = isDebugLoggingEnabled;
  window.CTC_DEBUG_STORAGE_KEY = CTC_DEBUG_STORAGE_KEY;
  window.isDebugPreferenceSupported = isDebugPreferenceSupported;
} else {
  // For background scripts that might not have window object
  globalThis.ctcConsole = ctcConsole;
  globalThis.setDebugLoggingEnabled = setDebugLoggingEnabled;
  globalThis.isDebugLoggingEnabled = isDebugLoggingEnabled;
  globalThis.CTC_DEBUG_STORAGE_KEY = CTC_DEBUG_STORAGE_KEY;
  globalThis.isDebugPreferenceSupported = isDebugPreferenceSupported;
}

