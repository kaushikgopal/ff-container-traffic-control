This file provides guidance to AI coding agents like Claude Code (claude.ai/code), Cursor AI, Codex, Gemini CLI, GitHub Copilot, and other AI coding assistants when working with code in this repository.

## Project Overview
Container Traffic Control is a Firefox extension that automatically routes websites to specific containers based on user-defined rules. It intercepts webRequests and redirects tabs using Firefox's Multi-Account Containers API.

**For user documentation, see [README.md](README.md). This file focuses on technical implementation for AI agents.**

## Essential Commands

```bash
# Core development workflow
make build    # Build extension package (default)
make test     # Run rule engine unit tests (test/rule-engine-test.js)
make lint     # Validate extension code and manifest
make run      # Run extension in Firefox for development
make clean    # Remove build artifacts

# Manual testing alternative: Firefox → about:debugging → "Load Temporary Add-on" → select manifest.json
```

**Critical**: Always run `make lint` after changes to ensure extension validity.

## Architecture Overview

### Core Components
- **src/background.js**: Main extension logic - intercepts webRequests and handles container switching
- **src/ctc-repository.js**: Thread-safe data repository (CtcRepo) managing containers and rules
- **src/rule-engine.js**: Pure rule evaluation logic (testable, no browser dependencies)
- **src/options.js**: Settings UI with rule management table
- **src/utils.js**: Shared utilities (ctcConsole logging, pattern matching)

### Data Flow
1. **Background script**: Owns CtcRepo initialization, intercepts all navigation
2. **Options page**: Consumes cached CtcRepo data, saves rules to browser.storage.sync
3. **Rule engine**: Pure function evaluating which container to use for a URL

### Critical Loading Order
`manifest.json` script order: `utils.js` → `rule-engine.js` → `ctc-repository.js` → `background.js`

## Development Patterns

### Data Access Rules
```javascript
// ✅ Always use CtcRepo methods
CtcRepo.getData((data) => {
    // Use data.containers and data.rules
});

// ❌ Never access browser APIs directly
browser.storage.sync.get('ctcRules'); // Don't do this
```

### Pattern Matching
```javascript
// ✅ Use utility function
if (matchesPattern(url, pattern)) { /* handle match */ }

// ❌ Don't implement inline
if (new RegExp(pattern).test(url)) { /* don't do this */ }
```

### Logging
```javascript
// ✅ Use ctcConsole for consistent formatting
ctcConsole.error('Error message');

// ❌ Don't use console directly
console.log('message'); // Don't do this
```

## Rule System Logic

### Rule Evaluation Algorithm
1. **Stay Put**: If current container accepts URL, stay there
2. **Restriction Check**: If in "restricted" container and URL doesn't match, must leave
3. **Find Matches**: Get all containers with rules matching URL
4. **Priority Selection**: High-priority rules win first (per URL pattern)
5. **Default**: No matches → "No Container"

### Rule Types
- **"no-rule"**: Container is disabled (no URL patterns active)
- **"open"** action: Container accepts these URLs plus any others
- **"restricted"** action: Container ONLY accepts these URLs
- **Constraint**: A container cannot mix "open" and "restricted" rules

### URL Patterns
- **Simple**: `github.com` (literal string matching)
- **Regex**: `/.*\.github\.com/` (wrapped in slashes)

## Memory Management
The codebase includes production-ready safeguards:
- Size-based cleanup triggers when Maps exceed 100 entries
- Thread-safe CtcRepo prevents race conditions
- Fail-fast error handling for uninitialized state

## Testing
- Tests: `test/rule-engine-test.js` (13 comprehensive test cases)
- Run: `make test` or `node test/rule-engine-test.js`
- Covers: Pattern matching, rule evaluation, container switching, edge cases

## Common Modification Areas

### Background Script Changes
- Only modify rule evaluation logic
- Never change data loading patterns
- All navigation goes through `handleRequest()` function

### Options Page Changes (Container-Centric UI)
- **UI Structure**: Container groups with multiple URL patterns per container
- **Type Options**: "no-rule", "open", "restricted" (no-rule disables container)
- **Data Collection**: Use `collectRulesFromTable()` to extract rules from container groups
- **Rendering**: Use `renderAllContainerGroups()` to display containers with grouped URLs
- **Rule structure**: `{containerName, action, urlPattern, highPriority}`

### Adding Features
- Data-related features: Add to CtcRepo
- UI features: Follow existing validation patterns
- Always maintain separation of concerns

## Storage Schema
```javascript
// browser.storage.sync.ctcRules
[{
  "containerName": "Work",          // Container name or "No Container"
  "action": "open"|"restricted",    // Rule type
  "urlPattern": "github.com",       // Pattern (simple or /regex/)
  "highPriority": false            // Precedence flag
}]
```

## Error Handling Philosophy
- Background script: Never crash navigation (return {} on errors)
- CtcRepo: Throw errors for invalid state, let callers handle
- Options page: Show validation errors to user
- Use fail-fast patterns with clear error messages