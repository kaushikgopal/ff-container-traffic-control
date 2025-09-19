This file provides guidance to AI coding agents like Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Container Traffic Control is a Firefox extension that helps define rules controlling which container a website opens in. It leverages Firefox's Multi-Account Containers and Contextual Identities API.

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
- Rule storage in `browser.storage.local` with key `'rules'`
- Table-based UI with dynamic row creation/deletion
- Real-time validation for regex patterns and rule conflicts
- Rules structure: `{containerName, action, urlPattern, highPriority}`

### Rule Validation Logic
- **Invalid combination**: "Allow Only" action + "*" pattern (blocks all navigation)
- **Pattern validation**: All URL patterns must be valid regex
- **Priority conflicts**: Multiple high priority rules for same pattern generate warnings

### Storage Schema
```javascript
// browser.storage.local structure
{
  "rules": [
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
- **Phase 2** (Planned): Background script implementation for actual URL routing and container enforcement