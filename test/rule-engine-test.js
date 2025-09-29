// Simple Test Framework for Container Traffic Control
// Run with: node test/simple-test.js

// Import the rule engine and utilities
const { evaluateContainerForUrl } = require('../src/rule-engine.js');
const { matchesPattern } = require('../src/utils.js');

// Simple test framework
let testCount = 0;
let passCount = 0;

function test(name, testFunction) {
    testCount++;
    console.log(`\n🧪 Test ${testCount}: ${name}`);
    console.log('='.repeat(50));

    try {
        testFunction();
        passCount++;
        console.log('✅ PASS');
    } catch (error) {
        console.log('❌ FAIL:', error.message);
        console.log('Stack:', error.stack);
    }
}

function assertEqual(actual, expected, message = '') {
    if (actual !== expected) {
        throw new Error(`${message}\nExpected: "${expected}"\nActual: "${actual}"`);
    }
}

function createContainer(name, id = name.toLowerCase()) {
    return { name, id };
}

function createRule(containerName, action, urlPattern, highPriority = false) {
    return { containerName, action, urlPattern, highPriority };
}

// Test Suite
console.log('🚀 Container Traffic Control Rule Engine Tests');
console.log('=' .repeat(60));

// Test 1: Pattern matching
test('Pattern Matching - Simple patterns', () => {
    assertEqual(matchesPattern('https://github.com/user/repo', 'github.com'), true, 'Should match simple pattern');
    assertEqual(matchesPattern('https://example.com', 'github.com'), false, 'Should not match different domain');
    assertEqual(matchesPattern('https://mail.google.com', 'google.com'), true, 'Should match subdomain');
});

test('Pattern Matching - Regex patterns', () => {
    assertEqual(matchesPattern('https://github.com', '/.*\\.github\\.com/'), false, 'Should not match main domain with subdomain regex');
    assertEqual(matchesPattern('https://api.github.com', '/.*\\.github\\.com/'), true, 'Should match subdomain with regex');
    assertEqual(matchesPattern('https://github.com/user', '/^https://github\\.com/'), true, 'Should match with anchor regex');
});

// Test 2: No rules scenario (your current issue)
test('No Rules - Should stay in current container', () => {
    const rules = [];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com', 'Personal', rules, containerMap);
    assertEqual(result, 'Personal', 'Should stay in current container when no rules exist');
});

test('No Rules - Should default to No Container when starting fresh', () => {
    const rules = [];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com', 'No Container', rules, containerMap);
    assertEqual(result, 'No Container', 'Should stay in No Container when no rules exist');
});

test('Rules Exist But No Match - Should stay in current container', () => {
    const rules = [
        createRule('Work', 'open', 'company.com'),
        createRule('Personal', 'open', 'facebook.com')
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com', 'Personal', rules, containerMap);
    assertEqual(result, 'Personal', 'Should stay in current container when rules exist but none match');
});

// Test 3: Open rules
test('Open Rules - Stay in current container', () => {
    const rules = [
        createRule('Personal', 'open', 'github.com')
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com/user/repo', 'Personal', rules, containerMap);
    assertEqual(result, 'Personal', 'Should stay in Personal container');
});

test('Open Rules - Switch to matching container', () => {
    const rules = [
        createRule('Work', 'open', 'github.com')
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com/user/repo', 'No Container', rules, containerMap);
    assertEqual(result, 'Work', 'Should switch to Work container');
});

// Test 4: Restricted rules (restricted containers)
test('Restricted Rules - Boot from restricted container', () => {
    const rules = [
        createRule('Work', 'restricted', 'company.com')
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com', 'Work', rules, containerMap);
    assertEqual(result, 'No Container', 'Should be booted from restricted container');
});

test('Restricted Rules - Stay in restricted container for matching URL', () => {
    const rules = [
        createRule('Work', 'restricted', 'company.com')
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://company.com/login', 'Work', rules, containerMap);
    assertEqual(result, 'Work', 'Should stay in restricted container for matching URL');
});

// Test 5: High priority rules
test('High Priority Rules - Should win over normal priority', () => {
    const rules = [
        createRule('Personal', 'open', 'github.com', false), // Normal priority
        createRule('Work', 'open', 'github.com', true)      // High priority
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com', 'No Container', rules, containerMap);
    assertEqual(result, 'Work', 'High priority rule should win');
});

// Test 6: Rule order (first rule wins when same priority)
test('Rule Order - First rule wins when same priority', () => {
    const rules = [
        createRule('Personal', 'open', 'github.com', true), // First high priority
        createRule('Work', 'open', 'github.com', true)     // Second high priority
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    const result = evaluateContainerForUrl('https://github.com', 'No Container', rules, containerMap);
    assertEqual(result, 'Personal', 'First rule should win when same priority');
});

// Test 7: HTTP Redirect scenarios (simulating redirect URL evaluation)
test('HTTP Redirect - Boot from restricted container on redirect destination', () => {
    const rules = [
        createRule('Personal', 'restricted', 'www.google.com'),  // Allow Google redirect URLs
        createRule('Personal', 'restricted', 'mail.google.com') // Allow Gmail
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    // First: Google redirect URL is allowed in Personal container
    const redirectResult = evaluateContainerForUrl('https://www.google.com/url?q=https://addons.mozilla.org/', 'Personal', rules, containerMap);
    assertEqual(redirectResult, 'Personal', 'Should stay in Personal for Google redirect URL');

    // Second: Final destination should boot from restricted container
    const finalResult = evaluateContainerForUrl('https://addons.mozilla.org/en-US/firefox/', 'Personal', rules, containerMap);
    assertEqual(finalResult, 'No Container', 'Should be booted from Personal container to No Container for final destination');
});

test('HTTP Redirect - Open rule should not boot from container', () => {
    const rules = [
        createRule('Personal', 'open', 'github.com')  // Regular open rule (not restricted)
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    // Should stay in Personal even for non-matching URLs (open rules are not restrictive)
    const result = evaluateContainerForUrl('https://addons.mozilla.org/', 'Personal', rules, containerMap);
    assertEqual(result, 'Personal', 'Should stay in Personal container with open rules');
});

// Test 8: Google search container isolation
test('Google Search Isolation - Keep searches in one container, results in default', () => {
    const rules = [
        createRule('Search', 'restricted', 'google.com/search'),  // Only Google search pages
        createRule('Search', 'restricted', '/.*\\.google\\.com/search/')  // Any Google domain search
    ];
    const containerMap = new Map([
        ['Search', 'search-id'],
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    // Should stay in Search container for search pages
    const searchResult = evaluateContainerForUrl('https://google.com/search?q=javascript', 'Search', rules, containerMap);
    assertEqual(searchResult, 'Search', 'Should stay in Search container for Google search');

    // Should be booted from Search container for result links (restricted rule)
    const resultResult = evaluateContainerForUrl('https://developer.mozilla.org/docs', 'Search', rules, containerMap);
    assertEqual(resultResult, 'No Container', 'Should be booted from Search container for result links');

    // Direct navigation to search from No Container should work
    const directSearch = evaluateContainerForUrl('https://google.com/search?q=firefox', 'No Container', rules, containerMap);
    assertEqual(directSearch, 'Search', 'Should switch to Search container for direct search navigation');
});

// Test 9: Conditional GitHub routing based on organization
test('Conditional GitHub Routing - Work vs Personal by organization', () => {
    const rules = [
        createRule('Work', 'open', '/github\\.com\\/instacart/', true),      // High priority for work org
        createRule('Personal', 'open', '/github\\.com\\/kaushikgopal/', true), // High priority for personal
        createRule('Work', 'open', 'github.com')  // Default GitHub to Work (lower priority)
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    // From Gmail, instacart links should go to Work
    const instacartResult = evaluateContainerForUrl('https://github.com/instacart/some-repo', 'Personal', rules, containerMap);
    assertEqual(instacartResult, 'Work', 'Should switch to Work for instacart GitHub links');

    // From Gmail, personal links should stay in Personal
    const personalResult = evaluateContainerForUrl('https://github.com/kaushikgopal/my-repo', 'Personal', rules, containerMap);
    assertEqual(personalResult, 'Personal', 'Should stay in Personal for kaushikgopal GitHub links');

    // Other GitHub links should go to Work (default)
    const otherResult = evaluateContainerForUrl('https://github.com/microsoft/vscode', 'Personal', rules, containerMap);
    assertEqual(otherResult, 'Work', 'Should switch to Work for other GitHub links');

    // From No Container, personal links should go to Personal
    const freshPersonalResult = evaluateContainerForUrl('https://github.com/kaushikgopal/dotfiles', 'No Container', rules, containerMap);
    assertEqual(freshPersonalResult, 'Personal', 'Should switch to Personal for kaushikgopal links from No Container');
});

// Test 10: Google Workspace container coherence (stay put principle)
test('Google Workspace Coherence - Stay in current container for cross-product links', () => {
    const rules = [
        createRule('Work', 'open', 'docs.google.com'),
        createRule('Work', 'open', 'sheets.google.com'),  // Default Sheets to Work
        createRule('Work', 'open', 'drive.google.com'),
        createRule('Personal', 'open', 'docs.google.com'),
        createRule('Personal', 'open', 'sheets.google.com'),  // Also allow Personal Sheets
        createRule('Personal', 'open', 'drive.google.com')
    ];
    const containerMap = new Map([
        ['Personal', 'personal-id'],
        ['Work', 'work-id'],
    ]);

    // From Personal Docs, clicking Sheets should stay in Personal (stay put wins)
    const docsToSheetsResult = evaluateContainerForUrl('https://sheets.google.com/spreadsheets/d/abc123', 'Personal', rules, containerMap);
    assertEqual(docsToSheetsResult, 'Personal', 'Should stay in Personal when clicking Sheets from Personal Docs');

    // From Personal Docs, clicking Drive should stay in Personal
    const docsToDriveResult = evaluateContainerForUrl('https://drive.google.com/drive/folders/xyz789', 'Personal', rules, containerMap);
    assertEqual(docsToDriveResult, 'Personal', 'Should stay in Personal when clicking Drive from Personal Docs');

    // From Work Docs, clicking Drive should stay in Work
    const workDocsToDriveResult = evaluateContainerForUrl('https://drive.google.com/drive/folders/work123', 'Work', rules, containerMap);
    assertEqual(workDocsToDriveResult, 'Work', 'Should stay in Work when clicking Drive from Work Docs');

    // Fresh navigation to Sheets should go to Work (first rule wins when no current container)
    const freshSheetsResult = evaluateContainerForUrl('https://sheets.google.com/create', 'No Container', rules, containerMap);
    assertEqual(freshSheetsResult, 'Work', 'Should switch to Work for fresh Sheets navigation');
});

// Summary
console.log('\n' + '=' .repeat(60));
console.log(`📊 Test Results: ${passCount}/${testCount} tests passed`);

if (passCount === testCount) {
    console.log('🎉 All tests passed!');
    process.exit(0);
} else {
    console.log('💥 Some tests failed!');
    process.exit(1);
}