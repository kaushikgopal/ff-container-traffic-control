// Container Traffic Control Storage Compression
// Gzip compression for rule storage to maximize browser.storage.sync capacity

// ============================================================================
// STORAGE CONSTRAINTS & COMPRESSION STRATEGY
// ============================================================================
// browser.storage.sync has strict size limits:
//    - 8KB per item
//    - 100KB total across all items
//
// For users with many rules, uncompressed JSON can easily exceed these limits.
//
// SOLUTION: Client-side gzip compression using browser CompressionStream API
//    - Reduces storage footprint by ~60-80%
//    - Enables storing 100+ rules instead of ~30
//    - Gracefully falls back to uncompressed for older browsers
//
// COMPRESSION PIPELINE:
//    Rules Array → JSON → UTF-8 Bytes → Gzip → Binary Blob → Base64 → Storage
//
// DECOMPRESSION PIPELINE:
//    Storage → Base64 → Binary Blob → Gunzip → UTF-8 Bytes → JSON → Rules Array
//
// FORMAT MARKERS:
//    - "gz:" prefix = compressed (modern browsers)
//    - No prefix = uncompressed (legacy format or old browsers)
// ============================================================================

/**
 * Check if browser supports native compression
 * @returns {boolean} True if CompressionStream and DecompressionStream are available
 */
function supportsCompressionNatively() {
  return (
    typeof CompressionStream === "function" &&
    typeof DecompressionStream === "function"
  );
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================================
// These functions are module-scoped (not exported) and handle low-level
// conversions between different data formats needed for compression pipeline.
// ============================================================================

/**
 * Convert base64 string to Uint8Array (browser and Node compatible)
 * @param {string} base64String - Base64 encoded binary data
 * @returns {Uint8Array} Raw bytes
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

/**
 * Convert Blob to base64 string
 * @param {Blob} blob - Binary data blob
 * @returns {Promise<string>} Base64 encoded string
 */
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

/**
 * Convert base64 string to Blob
 * @param {string} base64Encoded - Base64 encoded binary data
 * @returns {Promise<Blob>} Binary data blob
 */
async function base64ToBlob(base64Encoded) {
  // DecompressionStream requires a Blob/stream input. This reconstructs the
  // compressed binary Blob from its base64 string representation in storage.
  const byteArray = base64ToUint8Array(base64Encoded);
  if (typeof Blob === "function") {
    return new Blob([byteArray], { type: "application/octet-stream" });
  }

  throw new Error("Blob constructor is not available in this environment.");
}

/**
 * Parse rules from JSON (supports legacy and versioned formats)
 * @param {string} jsonString - JSON string to parse
 * @returns {Array} Rules array
 */
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

// ============================================================================
// PUBLIC API: Encoding and Decoding Functions
// ============================================================================

/**
 * Encode rules array into compressed base64 payload for storage
 *
 * COMPRESSION PIPELINE:
 *   1. Rules Array → JSON string
 *   2. JSON → UTF-8 bytes (TextEncoder)
 *   3. Bytes → Stream (for CompressionStream API)
 *   4. Stream → Compressed Stream (gzip)
 *   5. Compressed Stream → Blob (collect chunks)
 *   6. Blob → Base64 string (for storage)
 *   7. Add "gz:" prefix marker
 *
 * @param {Array} rules - Rules array to encode
 * @returns {Promise<string>} Compressed base64 string with "gz:" prefix
 */
async function encodeRulesForStorage(rules) {
  // Defensive logging: ctcConsole may not be available in test environments
  if (typeof ctcConsole !== "undefined") {
    ctcConsole.debug(`Encoding ${rules.length} rules for storage`);
  }

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
    if (typeof ctcConsole !== "undefined") {
      ctcConsole.debug("CompressionStream unavailable, using uncompressed storage");
    }
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
  if (typeof ctcConsole !== "undefined") {
    ctcConsole.debug(`Compressed ${payload.length} bytes to ${base64Encoded.length} bytes`);
  }
  return `gz:${base64Encoded}`;
}

/**
 * Decode stored rules payload (supports compressed and legacy formats)
 *
 * DECOMPRESSION PIPELINE:
 *   1. Detect format by "gz:" prefix
 *   2. Base64 → Binary Blob
 *   3. Blob → Stream
 *   4. Stream → Decompressed Stream (gunzip)
 *   5. Decompressed Stream → UTF-8 text
 *   6. Text → JSON → Rules Array
 *
 * LEGACY SUPPORT:
 *   - Raw array (very old format)
 *   - Uncompressed JSON string (old browsers)
 *   - Compressed base64 with "gz:" prefix (current format)
 *
 * @param {*} storedValue - Value from browser.storage.sync
 * @returns {Promise<Array>} Decoded rules array
 */
async function decodeRulesFromStorage(storedValue) {
  if (!storedValue) {
    return [];
  }

  // Legacy format: raw array stored directly
  if (Array.isArray(storedValue)) {
    if (typeof ctcConsole !== "undefined") {
      ctcConsole.debug("Decoding legacy array format");
    }
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

      if (typeof ctcConsole !== "undefined") {
        ctcConsole.debug("Decoding compressed format");
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
    if (typeof ctcConsole !== "undefined") {
      ctcConsole.debug("Decoding uncompressed JSON format");
    }
    return parseRulesJson(storedValue);
  }

  throw new Error("Unsupported rules storage format.");
}

// ============================================================================
// EXPORTS: Make compression functions available
// ============================================================================

// Export for Node.js environments (tests)
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    encodeRulesForStorage,
    decodeRulesFromStorage,
    supportsCompressionNatively,
  };
}

// Export for browser environments
if (typeof window !== "undefined") {
  window.encodeRulesForStorage = encodeRulesForStorage;
  window.decodeRulesForStorage = decodeRulesFromStorage;
  window.supportsCompressionNatively = supportsCompressionNatively;
} else {
  globalThis.encodeRulesForStorage = encodeRulesForStorage;
  globalThis.decodeRulesFromStorage = decodeRulesFromStorage;
  globalThis.supportsCompressionNatively = supportsCompressionNatively;
}

