# Container Traffic Control (CTC) - Rule Management Implementation Plan

## Project Context
Container Traffic Control is a Firefox extension that controls which container a website opens in based on user-defined rules. It leverages Firefox's Multi-Account Containers and Contextual Identities API.

## Current State
- Basic boilerplate structure exists with manifest.json, background.js (minimal), and placeholder options.html
- Extension has necessary permissions: webRequest, tabs, cookies, contextualIdentities, storage
- Gecko ID: ctc@kau.sh

## Requirements Overview
CTC differs from similar extensions (like Conductor) by implementing a 4-field rule system with allow/block semantics and priority handling.

## Rule Structure
Each rule contains exactly 4 fields:

1. **Container Name**:
   - Dropdown populated with existing Firefox containers
   - Must include "No Container" as an option
   - "No Container" refers to default browsing (cookieStoreId = 'firefox-default')

2. **Action Type**:
   - Two options: "Allow" or "Allow Only" (NOT "block")
   - "Allow" = URL can open in this container (non-exclusive)
   - "Allow Only" = URL MUST open ONLY in this container (exclusive)

3. **URL Pattern**:
   - Regex pattern to match website URLs
   - Real-time validation of regex syntax
   - Examples: `mail.google.com`, `.*\.google\.com`, `*`

4. **High Priority**:
   - Boolean field (checkbox)
   - Empty/unchecked = false
   - Determines rule precedence in conflicts

## Validation Rules (CRITICAL)

### Must Validate on Save:
1. **Invalid Rule**: "Allow Only" + "*" pattern
   - This combination is explicitly forbidden
   - Must show clear error message

2. **Warning**: Same URL pattern with multiple high priority containers
   - Should warn but not block saving
   - Log clear console warning explaining precedence

3. **Error**: Invalid regex patterns
   - Validate regex syntax before saving
   - Show user-friendly error messages

### Rule Precedence (for future implementation):
1. High priority rules first
2. Then by order in rule list
3. Console warning when conflicts detected

## UI Requirements

### Options Page Layout:
- Table-based interface similar to Conductor extension
- Columns: Container | Allow/Allow Only | URL Pattern | High Priority
- "Add Rule" button to add new rule rows
- "Save Rules" button to persist changes
- Delete button per rule row
- Real-time regex validation feedback

### Example Rule Table:
```
| Container     | Allow/Block  | URL Pattern      | High Priority |
|---------------|--------------|------------------|---------------|
| No Container  | Allow        | *                | true          |
| Instacart     | Allow        | *                |               |
| Instacart     | Allow        | mail.google.com  | true          |
| Personal      | Allow Only   | mail.google.com  |               |
| Personal      | Allow Only   | google.com       |               |
```

## Storage Requirements
- Rules saved to browser.storage.local
- Only persist when "Save Rules" button clicked
- Load existing rules on options page load
- Structure:
```javascript
{
  rules: [
    {
      containerName: string,      // e.g., "Personal", "No Container"
      action: string,             // "allow" or "allow_only"
      urlPattern: string,         // regex pattern
      highPriority: boolean       // true or false
    }
  ]
}
```

## Debug Output Requirements
After each successful save:
1. Print console.table() showing all saved rules
2. Format matches the UI table structure
3. Show validation errors/warnings clearly
4. Log: "CTC: X rules saved successfully"

## Code Style Requirements
Based on firefox-sticky-containers style:
- Clear, descriptive comments explaining "why" not "how"
- Single responsibility functions
- Descriptive variable names (no abbreviations)
- Minimal nesting, early returns
- Consistent debug logging with context
- Example:
```javascript
// Check if this rule combination is invalid
// "Allow Only" with wildcard would block all navigation
if (rule.action === 'allow_only' && rule.urlPattern === '*') {
    console.error('CTC: Invalid rule - "Allow Only" with "*" pattern blocks all navigation');
    return false;
}
```

## Implementation Tasks

### Phase 1: Core UI Implementation
1. **Update options.html**
   - Create table-based rule interface
   - Add control buttons (Add Rule, Save Rules)
   - Include container dropdown, action dropdown, pattern input, priority checkbox

2. **Create options.js**
   - Fetch containers via browser.contextualIdentities.query()
   - Add "No Container" option to dropdown
   - Implement dynamic rule row creation/deletion
   - Real-time regex validation on pattern input

3. **Create options.css**
   - Clean, simple styling matching Firefox extension guidelines
   - Visual feedback for validation states (error/success)

### Phase 2: Validation & Storage
1. **Implement Validation Logic**
   - Check for "Allow Only" + "*" combination
   - Validate regex patterns
   - Check for high priority conflicts
   - Show appropriate error/warning messages

2. **Storage Management**
   - Save rules to browser.storage.local on button click
   - Load and display existing rules on page load
   - Handle storage errors gracefully

### Phase 3: Debug & Logging
1. **Debug Output**
   - Implement console.table() for rule display
   - Add detailed logging for validation failures
   - Include timestamp in log messages

## Testing Checklist
- [ ] Can add new rule rows dynamically
- [ ] Container dropdown shows all Firefox containers + "No Container"
- [ ] Regex validation works in real-time
- [ ] "Allow Only" + "*" shows error and prevents save
- [ ] Multiple high priority rules for same pattern shows warning
- [ ] Rules persist after extension reload
- [ ] Console.table() displays rules correctly after save
- [ ] Invalid regex patterns are caught and reported
- [ ] Can delete individual rules
- [ ] Empty rules are not saved

## Reference Extensions
1. **Conductor** (https://github.com/mcortt/Conductor)
   - Reference for basic rule management UI
   - Pattern: URL pattern → Container mapping

2. **firefox-sticky-containers** (https://github.com/kemayo/firefox-sticky-containers)
   - Reference for code style and commenting
   - Clean debug logging patterns

3. **container-redirect** (https://github.com/max-dw-i/container-redirect)
   - Reference for advanced container functionality
   - Complex rule handling patterns

## Next Steps After This Implementation
1. Implement rule processing in background.js
2. Add webRequest listener to intercept navigation
3. Apply rules based on precedence
4. Handle edge cases (new tabs, redirects, etc.)

## Important Notes for Implementation
- This is Phase 1: Focus only on rule input, validation, and storage
- Do NOT implement actual URL redirection yet
- Prioritize clean, readable code over complex features
- Ensure all validation messages are user-friendly
- Test with actual Firefox containers before finalizing

## Questions Already Answered
1. Container name: Dropdown with existing containers
2. URL validation: Real-time regex validation
3. Priority conflicts: Highest priority first, then order
4. "Allow Only" + "*": This specific combination is invalid
5. Debug format: Console.table similar to UI
6. Persistence: Only on "Save Rules" click

## Current File Structure
```
/src/
├── manifest.json (configured with permissions)
├── background.js (minimal boilerplate)
├── options.html (placeholder, needs complete rewrite)
├── options.js (to be created)
└── options.css (to be created)
```

---
*This checkpoint document contains all context needed to resume implementation of the CTC rule management feature. Any developer should be able to continue from this point without additional context.*