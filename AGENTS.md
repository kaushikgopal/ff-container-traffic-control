This file provides guidance to AI coding agents like Claude Code (claude.ai/code), Cursor AI, GitHub Copilot, and other AI coding assistants when working with code in this repository.

## Project Overview
Container Traffic Control is a Firefox extension that automatically manages container routing based on user-defined rules. It leverages Firefox's Multi-Account Containers and Contextual Identities API.

**For user documentation and examples, see [README.md](README.md). This file focuses on technical implementation details for AI coding agents.**

## Development Commands

### Development Commands (Makefile)
```bash
# Show all available commands
make help

# Build extension package (default)
make build

# Run unit tests for rule engine
make test

# Validate extension code and manifest
make lint

# Run extension in Firefox for development
make run

# Clean build artifacts
make clean
```

### Manual Testing
- Navigate to `about:debugging` in Firefox
- Click "This Firefox" → "Load Temporary Add-on"
- Select `manifest.json` (in project root)

### Debugging
- Go to `about:debugging` → Find extension → Click "Inspect"
- Console logs from background script appear in DevTools
- Extension storage viewable via DevTools → Storage tab
- Or programmatically: `browser.storage.sync.get()`

### Direct web-ext Commands (if needed)
```bash
# Install web-ext (recommended)
brew install web-ext

# Commands (or use Makefile equivalents above)
web-ext lint
web-ext run
web-ext build --overwrite-dest
```

**Important**: Always run `make lint` after making changes to verify the extension is valid and ready for distribution.

## Architecture

### Core Components
- **manifest.json**: Extension configuration with permissions for webRequest, tabs, cookies, contextualIdentities, storage, icons (project root)
- **src/utils.js**: Shared utilities (console logging, pattern matching)
- **src/ctc-repository.js**: Centralized data management (CtcRepo) for containers and rules
- **src/background.js**: Main extension logic for handling web requests and container routing
- **src/options.html/js/css**: Complete settings UI with rule management table interface
- **icons/**: High-quality extension icons (16px, 32px, 48px, 96px) (project root)

### Shared Utilities (utils.js)
Common functions used by both background and options scripts:
- **`ctcConsole`**: Consistent logging with debug control (`[CTC]` prefix, DEBUG flag controlled)
- **`matchesPattern(url, pattern)`**: Dual-mode URL pattern matching with error handling

### Data Management (ctc-repository.js)
Centralized data repository (CtcRepo) for all container and rule operations:
- **`CtcRepo.initialize(onSuccess, onError)`**: Load both containers and rules on startup
- **`CtcRepo.getData(onSuccess, onError)`**: Get cached data without re-initializing (used by options page)
- **`CtcRepo.loadContainers()`**: Returns `{containerMap, cookieStoreToNameMap}` with all Firefox containers
- **`CtcRepo.loadRules()`**: Returns array of rules from `browser.storage.sync.ctcRules`
- **`CtcRepo.getContainerData()`**: Returns containers in multiple formats (Maps + arrays)
- **`CtcRepo.getRules()`**: Returns current rules array

**Loading Strategy**: Background script owns initialization, options page consumes cached data

**Important**: Script loading order in manifest.json: `utils.js` → `ctc-repository.js` → `background.js`

## Development Patterns for AI Agents

### Code Style and Conventions
- Use `ctcConsole` for all logging (not `console` directly)
- Pattern matching: Use `matchesPattern(url, pattern)` function, never implement regex matching inline
- Data access: Always use `CtcRepo` methods, never access `browser.storage` or `browser.contextualIdentities` directly
- Error handling: Use callback patterns provided by CtcRepo methods
- Variable naming: Use descriptive names like `containerName`, `urlPattern`, `cookieStoreId`

### Common Implementation Patterns
```javascript
// ✅ Correct: Use CtcRepo for data access
CtcRepo.getData((data) => {
    // Use data.containers and data.rules
}, (error) => {
    ctcConsole.error('Failed to load data:', error);
});

// ❌ Wrong: Direct browser API access
browser.storage.sync.get('ctcRules');

// ✅ Correct: Pattern matching
if (matchesPattern(url, pattern)) {
    // Handle match
}

// ❌ Wrong: Inline regex
if (new RegExp(pattern).test(url)) {
    // Don't do this
}
```

### When Making Changes
1. **Background script changes**: Only modify rule evaluation logic, never data loading
2. **Options page changes**: Use existing validation methods, extend don't replace
3. **New features**: Add to CtcRepo if data-related, maintain separation of concerns
4. **Pattern changes**: Update both `matchesPattern()` and validation in options.js
5. **Testing**: Always run `make lint` and `make test` after changes to catch errors before distribution

### Options Page Architecture
The options page uses a class-based approach (`ContainerTrafficControlOptions`) with these key patterns:
- Data loading via `CtcRepo.getData()` (consumes cached data from background script)
- Rule storage in `browser.storage.sync` with key `'ctcRules'`
- Table-based UI with dynamic row creation/deletion
- Real-time validation for dual-mode URL patterns and rule conflicts
- Rules structure: `{containerName, action, urlPattern, highPriority}`

### Rule System Overview

#### How Container Traffic Control Works
Container Traffic Control uses a simple preference system:
1. **Stay Put**: If your current container accepts the URL, you stay there
2. **Restricted Containers**: If you're in a container with "Allow Only" rules and click a non-matching link, you'll be moved out
3. **Finding a Match**: When switching containers, high-priority rules win, then first matching rule (by order)
4. **Default**: If no rules match, opens in "No Container" (regular browsing)

#### Rule Types
- **Allow**: Container accepts this URL plus any others (open container)
- **Allow Only**: Container ONLY accepts these URLs (restricted container)
- **⚠️ Important**: A container cannot mix "Allow" and "Allow Only" rules

#### Rule Evaluation Algorithm (Detailed)
```
1. START: targetContainer = currentContainer

2. CHECK RESTRICTIONS:
   IF currentContainer has allow-only rules AND
      URL doesn't match ANY of them:
   THEN targetContainer = null (must leave container)

3. FIND MATCHING CONTAINERS:
   allowedContainers = all containers with rules matching URL

4. SELECT CONTAINER:
   IF targetContainer !== null AND targetContainer in allowedContainers:
      RETURN targetContainer (stay in current)

   ELSE IF any high-priority container in allowedContainers:
      RETURN first high-priority container (by rule order)

   ELSE IF allowedContainers.length > 0:
      RETURN allowedContainers[0] (first by rule order)

   ELSE:
      RETURN "No Container" (firefox-default)
```

#### Example Scenarios

**Scenario 1: Restricted Container Boot-Out**
- Current: "Work" container (allow-only: `.*\.work\.com`)
- Navigate to: facebook.com
- Result: Must leave Work container → check other rules → default to "No Container"

**Scenario 2: Stay in Current Container**
- Current: "Personal" container (allow: `.*\.github\.com`)
- Navigate to: github.com
- Result: Stay in Personal (preference for current container)

**Scenario 3: High Priority Selection**
- Current: "No Container"
- Navigate to: github.com
- Rules: Work (allow: `.*\.github\.com`, HIGH), Personal (allow: `.*\.github\.com`, NORMAL)
- Result: Open in Work (high priority wins)

**Scenario 4: Rule Order Tiebreaker**
- Current: "No Container"
- Navigate to: github.com
- Rules: Work (allow: `.*\.github\.com`, HIGH, Rule #1), Personal (allow: `.*\.github\.com`, HIGH, Rule #2)
- Result: Open in Work (first rule wins when same priority)

#### URL Pattern System (Dual-Mode)
**Simple Mode** (default): Literal string matching
- `github.com` → matches any URL containing "github.com"
- `mail.google.com` → matches Gmail URLs
- User-friendly, no regex knowledge required

**Regex Mode** (advanced): Full regex power when wrapped in slashes
- `/.*\.google\.com/` → matches any Google subdomain
- `/^https://github\.com/user/` → matches specific user's repos
- Power users can use complex patterns

**Pattern Processing:**
```javascript
function matchesPattern(url, pattern) {
    if (pattern.startsWith('/') && pattern.endsWith('/')) {
        // Regex mode: strip slashes and use as regex
        const regexPattern = pattern.slice(1, -1);
        return new RegExp(regexPattern).test(url);
    } else {
        // Literal mode: simple contains match
        return url.includes(pattern);
    }
}
```

#### Rule Validation
- **Container Consistency**: Cannot mix "allow" and "allow-only" rules in same container
- **Invalid combination**: "Allow Only" action + "*" pattern (blocks all navigation)
- **Pattern validation**: Regex patterns (in `/slashes/`) must be valid regex, literal patterns always valid
- **Priority conflicts**: Multiple high-priority rules for same pattern generate warnings
- **Privacy warnings**: Overly broad patterns generate warnings but are allowed

### Storage Schema
```javascript
// browser.storage.sync structure
{
  "ctcRules": [
    {
      "containerName": "Personal", // Container name or "No Container"
      "action": "allow|allow_only", // Rule enforcement type
      "urlPattern": "github.com", // Simple pattern or "/regex/" pattern
      "highPriority": true // Boolean for rule precedence
    }
  ]
}
```

### Key Firefox APIs Used
- `browser.contextualIdentities.*` - Container management
- `browser.tabs.create({cookieStoreId})` - Open tabs in specific containers
- `browser.webRequest.*` - Intercept and modify web requests
- `browser.storage.sync.*` - Persist and sync extension settings across devices

### Extension Structure
This is a Manifest v3 Firefox extension with:
- Background script for core logic
- Options page for user configuration
- Host permissions for all URLs
- Gecko-specific ID: `ctc@kau.sh`

### Development Phases
- **Phase 1** (Complete): Rule input, validation, and storage via options page
- **Phase 2** (Complete): Background script implementation for actual URL routing and container enforcement
- **Phase 3** (Complete): Code architecture optimization with CtcRepo and efficient data loading
- **Phase 4** (Complete): Dual-mode URL pattern system (simple + regex) with user-friendly interface
- **Phase 5** (Complete): Professional icons and visual identity

### Phase 2: URL Redirection Implementation

#### Background Script Architecture
The background script (`background.js`) implements the complete URL redirection system:

**WebRequest Interception:**
- Uses `webRequest.onBeforeRequest` with blocking mode
- Intercepts only `main_frame` navigation requests
- Skips privileged URLs (about:*, moz-extension:*)

**Container Management:**
- Caches container mappings (name ↔ cookieStoreId) for performance
- Responds to container creation/deletion events
- Maps "No Container" to `firefox-default` cookieStoreId

**Rule Processing:**
- Loads rules from storage on startup and changes
- Evaluates rules using exact algorithm specified above
- Handles container switching via tab creation/removal

**Key Functions:**
- `evaluateContainer(url, currentCookieStoreId)` - Core rule evaluation logic
- `handleRequest(details)` - WebRequest interceptor and tab switching
- `CtcRepo.initialize()` - Background script data initialization
- `matchesPattern(url, pattern)` - Dual-mode URL pattern matching with error handling

#### Container Switching Mechanism
When a container change is needed:
1. Create new tab in target container with same URL
2. Close original tab (if it exists)
3. Cancel original request (`return { cancel: true }`)

#### Debug and Monitoring
- Comprehensive console logging (controlled by DEBUG flag)
- Storage change listeners for real-time rule updates
- Container event listeners for Firefox container changes
- Error handling with fallbacks to prevent navigation blocking

#### Performance Optimizations
- In-memory rule and container caching
- Early exit for privileged URLs
- Efficient regex compilation and error handling
- Minimal DOM manipulation