This file provides guidance to AI coding agents like Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Container Traffic Control is a Firefox extension that automatically manages container routing based on user-defined rules. It leverages Firefox's Multi-Account Containers and Contextual Identities API.

**For user documentation and examples, see [README.md](README.md). This file focuses on technical implementation details for AI coding agents.**

## Development Commands

### Loading the Extension for Development
```bash
# Install web-ext (recommended)
brew install web-ext

# Run extension with hot reload
cd src/
web-ext run
```

### Manual Testing
- Navigate to `about:debugging` in Firefox
- Click "This Firefox" → "Load Temporary Add-on"
- Select `src/manifest.json`

### Debugging
- Go to `about:debugging` → Find extension → Click "Inspect"
- Console logs from background script appear in DevTools
- Extension storage viewable via DevTools → Storage tab
- Or programmatically: `browser.storage.local.get()`

### Code Validation
```bash
# Check JavaScript syntax (no build process required - pure extension)
# Manual testing via web-ext is the primary validation method
web-ext lint src/
```

## Architecture

### Core Components
- **manifest.json**: Extension configuration with permissions for webRequest, tabs, cookies, contextualIdentities, storage
- **background.js**: Main extension logic for handling web requests and container routing
- **options.html/js/css**: Complete settings UI with rule management table interface

### Options Page Architecture
The options page uses a class-based approach (`ContainerTrafficControlOptions`) with these key patterns:
- Container loading via `browser.contextualIdentities.query()`
- Rule storage in `browser.storage.local` with key `'ctcRules'`
- Table-based UI with dynamic row creation/deletion
- Real-time validation for regex patterns and rule conflicts
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

#### Rule Validation
- **Container Consistency**: Cannot mix "allow" and "allow-only" rules in same container
- **Invalid combination**: "Allow Only" action + "*" pattern (blocks all navigation)
- **Pattern validation**: All URL patterns must be valid regex
- **Priority conflicts**: Multiple high-priority rules for same pattern generate warnings
- **Wildcard Warning**: ".*" patterns generate privacy warnings but are allowed

### Storage Schema
```javascript
// browser.storage.local structure
{
  "ctcRules": [
    {
      "containerName": "Personal", // Container name or "No Container"
      "action": "allow|allow_only", // Rule enforcement type
      "urlPattern": ".*\\.google\\.com", // Regex pattern
      "highPriority": true // Boolean for rule precedence
    }
  ]
}
```

### Key Firefox APIs Used
- `browser.contextualIdentities.*` - Container management
- `browser.tabs.create({cookieStoreId})` - Open tabs in specific containers
- `browser.webRequest.*` - Intercept and modify web requests
- `browser.storage.local.*` - Persist extension settings

### Extension Structure
This is a Manifest v3 Firefox extension with:
- Background script for core logic
- Options page for user configuration
- Host permissions for all URLs
- Gecko-specific ID: `ctc@kau.sh`

### Development Phases
- **Phase 1** (Complete): Rule input, validation, and storage via options page
- **Phase 2** (Complete): Background script implementation for actual URL routing and container enforcement

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
- `loadRules()` / `loadContainers()` - Cache management and initialization
- `matchesPattern(url, pattern)` - Regex URL matching with error handling

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