// Large Ruleset Compression Tests
// Related to: https://github.com/kaushikgopal/ff-container-traffic-control/issues/4
// Tests compression with large rulesets to verify browser.storage.sync limits

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Constants
const STORAGE_SYNC_MAX_ITEM_SIZE = 8192; // 8KB per item
const STORAGE_SYNC_MAX_TOTAL_SIZE = 102400; // 100KB total

// Simple test framework
let testCount = 0;
let passCount = 0;
const tests = [];

function test(name, testFunction) {
    tests.push({ name, testFunction });
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: "${expected}"\nActual: "${actual}"`);
    }
}

function assertTrue(condition, message = '') {
    if (!condition) {
        throw new Error(message || 'Expected condition to be true');
    }
}

function assertLessThanOrEqual(actual, expected, message = '') {
    if (actual > expected) {
        throw new Error(`${message}\nExpected: ${actual} <= ${expected}`);
    }
}

// Test Suite
console.log('🚀 Large Ruleset Compression Tests');
console.log('='.repeat(60));

// Load the large ruleset once for all tests
const rulesetPath = path.join(__dirname, 'fixtures', 'large-ruleset.json');
const largeRuleset = JSON.parse(fs.readFileSync(rulesetPath, 'utf-8'));

test('Large Ruleset - Loads successfully', () => {
    assertTrue(Array.isArray(largeRuleset), 'Ruleset should be an array');
    assertTrue(largeRuleset.length > 0, 'Ruleset should contain rules');
    assertTrue(largeRuleset.length >= 100, `Ruleset should have at least 100 rules (has ${largeRuleset.length})`);
});

test('Large Ruleset - Uncompressed size exceeds single item limit', () => {
    const payload = JSON.stringify({ version: 1, rules: largeRuleset });
    const uncompressedBytes = Buffer.from(payload, 'utf-8');
    const uncompressedSize = uncompressedBytes.length;

    assertTrue(
        uncompressedSize > STORAGE_SYNC_MAX_ITEM_SIZE,
        `Uncompressed size (${uncompressedSize} bytes) should exceed 8KB limit to validate compression need`
    );
});

test('Large Ruleset - Compression succeeds', async () => {
    const payload = JSON.stringify({ version: 1, rules: largeRuleset });
    const uncompressedBytes = Buffer.from(payload, 'utf-8');

    const compressedBuffer = await gzip(uncompressedBytes);
    assertTrue(compressedBuffer.length > 0, 'Compressed buffer should not be empty');
    assertTrue(
        compressedBuffer.length < uncompressedBytes.length,
        'Compressed size should be smaller than uncompressed'
    );
});

test('Large Ruleset - Compressed data fits in storage limits', async () => {
    const payload = JSON.stringify({ version: 1, rules: largeRuleset });
    const uncompressedBytes = Buffer.from(payload, 'utf-8');
    const compressedBuffer = await gzip(uncompressedBytes);

    const base64Encoded = compressedBuffer.toString('base64');
    const storedValue = `gz:${base64Encoded}`;
    const compressedSize = Buffer.from(storedValue, 'utf-8').length;

    assertLessThanOrEqual(
        compressedSize,
        STORAGE_SYNC_MAX_ITEM_SIZE,
        `Compressed size (${compressedSize} bytes) must fit in 8KB item limit`
    );

    assertLessThanOrEqual(
        compressedSize,
        STORAGE_SYNC_MAX_TOTAL_SIZE,
        `Compressed size (${compressedSize} bytes) must fit in 100KB total limit`
    );
});

test('Large Ruleset - Decompression succeeds', async () => {
    const payload = JSON.stringify({ version: 1, rules: largeRuleset });
    const uncompressedBytes = Buffer.from(payload, 'utf-8');
    const compressedBuffer = await gzip(uncompressedBytes);

    const decompressedBytes = await gunzip(compressedBuffer);
    const decompressedText = decompressedBytes.toString('utf-8');
    const parsed = JSON.parse(decompressedText);

    assertTrue(parsed.rules !== undefined, 'Decompressed data should have rules property');
    assertTrue(Array.isArray(parsed.rules), 'Decompressed rules should be an array');
});

test('Large Ruleset - Data integrity after compression cycle', async () => {
    const payload = JSON.stringify({ version: 1, rules: largeRuleset });
    const uncompressedBytes = Buffer.from(payload, 'utf-8');
    const compressedBuffer = await gzip(uncompressedBytes);

    const decompressedBytes = await gunzip(compressedBuffer);
    const decompressedText = decompressedBytes.toString('utf-8');
    const parsed = JSON.parse(decompressedText);
    const decompressed = parsed.rules || parsed;

    assertEqual(
        decompressed.length,
        largeRuleset.length,
        `Rule count should match: expected ${largeRuleset.length}, got ${decompressed.length}`
    );

    for (let i = 0; i < largeRuleset.length; i++) {
        assertEqual(
            JSON.stringify(decompressed[i]),
            JSON.stringify(largeRuleset[i]),
            `Rule ${i} should match after compression/decompression`
        );
    }
});

test('Large Ruleset - Compression ratio is significant', async () => {
    const payload = JSON.stringify({ version: 1, rules: largeRuleset });
    const uncompressedBytes = Buffer.from(payload, 'utf-8');
    const uncompressedSize = uncompressedBytes.length;
    const compressedBuffer = await gzip(uncompressedBytes);

    const base64Encoded = compressedBuffer.toString('base64');
    const storedValue = `gz:${base64Encoded}`;
    const compressedSize = Buffer.from(storedValue, 'utf-8').length;

    const compressionRatio = (1 - compressedSize / uncompressedSize) * 100;

    assertTrue(
        compressionRatio > 50,
        `Compression ratio should be significant (got ${compressionRatio.toFixed(1)}% reduction)`
    );
});

async function runTests() {
    for (const { name, testFunction } of tests) {
        console.log(`\n🧪 Test ${testCount + 1}: ${name}`);
        console.log('='.repeat(50));

        try {
            const result = testFunction();
            if (result && typeof result.then === 'function') {
                await result;
            }
            passCount++;
            console.log('✅ PASS');
        } catch (error) {
            console.log('❌ FAIL:', error.message);
            console.log('Stack:', error.stack);
        } finally {
            testCount++;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`📊 Test Results: ${passCount}/${testCount} tests passed`);

    if (passCount === testCount) {
        console.log('🎉 All tests passed!');
        process.exit(0);
    } else {
        console.log('💥 Some tests failed!');
        process.exit(1);
    }
}

runTests();
