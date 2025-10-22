// Shared utilities for Container Traffic Control
// This file provides common functions used across background and options scripts

// ============================================================================
// EXECUTION CONTEXT PATTERN: Auto-Initializing Utilities
// ============================================================================
// This file is loaded in BOTH contexts (background and options), creating
// independent instances of all utilities in each context:
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
// AUTO-INITIALIZATION (lines 125-126):
//    - Loads debug preference from storage on import
//    - Sets up storage change watcher automatically
//    - Both contexts run this initialization independently
//
// GLOBAL EXPORTS (lines 129-142):
//    - Functions exported to window/globalThis for cross-script access
//    - Each context gets its own copy of these functions
//    - Enables background.js and options.js to access utilities
// ============================================================================

const CTC_DEBUG_STORAGE_KEY = "ctcDebugLoggingEnabled";
let debugLoggingEnabled = false;

/**
 * Creates bound console methods with CTC formatting and debug control
 * @returns {Object} Console object with CTC-prefixed methods
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

    // Debug-controlled methods (only active when DEBUG is true)
    log: createDebugEmitter(prefixedLogEmitter),
    table: createDebugEmitter(tableEmitter),
  };
}

// Create and export the console instance
const ctcConsole = createCtcConsole();

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

function isDebugLoggingEnabled() {
  return debugLoggingEnabled;
}

function setDebugLoggingEnabled(enabled) {
  const normalizedEnabled = Boolean(enabled);
  if (debugLoggingEnabled === normalizedEnabled) {
    // We intentionally avoid touching listeners when the desired state already matches cached state.
    return;
  } else {
    debugLoggingEnabled = normalizedEnabled;
  }
}

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
        ctcConsole.log("Debug logging defaulting to quiet mode.");
      }
    } catch (error) {
      ctcConsole.error("Failed to load debug logging preference:", error);
    }
  }
}

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
            ctcConsole.log("Debug logging disabled by user preference change.");
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
// GLOBAL EXPORTS: Make utilities available across all scripts in this context
// ============================================================================
// PATTERN: Export to window (browser) or globalThis (workers/Node tests)
// SCOPE: Only accessible within same execution context
// ISOLATION: Background context's exports ≠ Options context's exports
// WHY: Enables background.js, options.js, and other scripts to access utilities
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
    ctcConsole.error("Invalid pattern:", pattern, error);
    return false;
  }
}

// Make utilities available globally
if (typeof window !== "undefined") {
  window.matchesPattern = matchesPattern;
} else {
  globalThis.matchesPattern = matchesPattern;
}

// Browser.storage.sync has strict size limits (8KB per item, 100KB total).
// CompressionStream API enables client-side gzip to maximize rule storage capacity.
function supportsCompressionNatively() {
  return (
    typeof CompressionStream === "function" &&
    typeof DecompressionStream === "function"
  );
}

// PRIVATE HELPERS: These functions are module-scoped and not exported
// They're effectively private - only accessible within this file
/**
 * Convert a base64 string to a Uint8Array (browser and Node compatible)
 * @param {string} base64String
 * @returns {Uint8Array}
 */
function base64ToUint8Array(base64String) {
  // Browser.storage.sync only stores strings. Binary compressed data must be
  // base64-encoded for storage. This reverses that encoding back to raw bytes.
  if (typeof atob === "function") {
    const binary = atob(base64String);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  // Node.js environments (tests) lack atob but have Buffer
  return new Uint8Array(Buffer.from(base64String, "base64"));
}

async function blobToBase64(blob) {
  // CompressionStream produces a Blob of binary data, but browser.storage.sync
  // requires strings. Base64 encoding allows binary→string conversion without data loss.
  if (typeof FileReader === "function") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        if (typeof result === "string") {
          // readAsDataURL returns "data:type;base64,<data>". We only need <data>.
          const commaIndex = result.indexOf(",");
          resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
        } else {
          reject(new Error("Unexpected FileReader result."));
        }
      };
      reader.onerror = () =>
        reject(reader.error || new Error("Failed to read blob as base64."));
      reader.readAsDataURL(blob);
    });
  }

  // Node.js fallback for tests
  const buffer = await blob.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

async function base64ToBlob(base64Encoded) {
  // DecompressionStream requires a Blob/stream input. This reconstructs the
  // compressed binary Blob from its base64 string representation in storage.
  const byteArray = base64ToUint8Array(base64Encoded);
  if (typeof Blob === "function") {
    return new Blob([byteArray], { type: "application/octet-stream" });
  }

  throw new Error("Blob constructor is not available in this environment.");
}

function parseRulesJson(jsonString) {
  // Support both legacy array format and versioned object format
  const parsed = JSON.parse(jsonString);
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && Array.isArray(parsed.rules)) {
    return parsed.rules;
  }
  throw new Error("Rules payload missing rules array.");
}

/**
 * Encode rules array into compressed base64 payload for storage
 * @param {Array} rules
 * @returns {Promise<string>}
 */
async function encodeRulesForStorage(rules) {
  ctcConsole.log(`Encoding ${rules.length} rules for storage`);

  if (!Array.isArray(rules)) {
    throw new Error("Rules must be an array before encoding.");
  }

  const payload = JSON.stringify({
    version: 1,
    rules,
  });

  if (!supportsCompressionNatively()) {
    // Older browsers without CompressionStream store uncompressed JSON.
    // This risks hitting storage limits but maintains compatibility.
    return payload;
  }

  // Step 1: Text → Bytes (compression algorithms work on bytes, not Unicode strings)
  const byteArray = new TextEncoder().encode(payload);

  // Step 2: Bytes → Stream (CompressionStream API requires stream input, not arrays)
  const sourceStream = new Response(byteArray).body;
  if (!sourceStream) {
    throw new Error("Failed to create readable stream for compression.");
  }

  // Step 3: Stream → Compressed Stream (gzip produces smaller binary output)
  const compressionStream = new CompressionStream("gzip");
  const compressedStream = sourceStream.pipeThrough(compressionStream);

  // Step 4: Compressed Stream → Blob (collect all compressed chunks into single object)
  const compressedBlob = await new Response(compressedStream).blob();

  // Step 5: Blob → Base64 (binary data must be base64-encoded for string storage)
  const base64Encoded = await blobToBase64(compressedBlob);

  // Prefix with "gz:" to distinguish compressed from legacy uncompressed storage
  return `gz:${base64Encoded}`;
}

/**
 * Decode stored rules payload (supports both compressed and legacy JSON formats)
 * @param {*} storedValue
 * @returns {Promise<Array>}
 */
async function decodeRulesFromStorage(storedValue) {
  if (!storedValue) {
    return [];
  }

  // Legacy format: raw array stored directly
  if (Array.isArray(storedValue)) {
    return storedValue;
  }

  if (typeof storedValue === "string") {
    if (storedValue.startsWith("gz:")) {
      if (!supportsCompressionNatively()) {
        // User's browser was downgraded or extension loaded in limited context.
        // Cannot decompress without the API.
        throw new Error(
          "Compressed rules were found but CompressionStream is unavailable.",
        );
      }

      // Step 1: Extract base64 payload (skip "gz:" prefix)
      const base64Payload = storedValue.slice(3);

      // Step 2: Base64 → Blob (reconstruct binary compressed data from string storage)
      const compressedBlob = await base64ToBlob(base64Payload);

      // Step 3: Blob → Stream → Decompressed Stream (decompress gzipped binary data)
      const decompressionStream = new DecompressionStream("gzip");
      const decompressedStream = compressedBlob
        .stream()
        .pipeThrough(decompressionStream);

      // Step 4: Decompressed Stream → Text (read decompressed bytes as UTF-8 text)
      const jsonPayload = await new Response(decompressedStream).text();

      // Step 5: Parse JSON and extract rules array
      return parseRulesJson(jsonPayload);
    }

    // Legacy format: uncompressed JSON string
    return parseRulesJson(storedValue);
  }

  throw new Error("Unsupported rules storage format.");
}

// Export for Node.js environments (tests)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    matchesPattern,
    encodeRulesForStorage,
    decodeRulesFromStorage,
    supportsCompressionNatively,
  };
}

// Attach helpers for browser environment
if (typeof window !== "undefined") {
  window.encodeRulesForStorage = encodeRulesForStorage;
  window.decodeRulesFromStorage = decodeRulesFromStorage;
} else {
  globalThis.encodeRulesForStorage = encodeRulesForStorage;
  globalThis.decodeRulesFromStorage = decodeRulesFromStorage;
}
