// Container Traffic Control Options Page
// Handles rule management, validation, and storage

// ============================================================================
// FIREFOX EXTENSION ARCHITECTURE: Options Page Context
// ============================================================================
// This file runs in a SEPARATE context from background.js (see background.js
// header for full explanation of context isolation).
//
// OPTIONS CONTEXT (this file):
//    - Runs in browser tab when user opens extension settings
//    - Has its own independent CtcRepo instance (separate from background)
//    - Must call CtcRepo.getData() to load containers and rules
//    - Saves changes to browser.storage.sync (triggers background reload)
//
// DATA FLOW:
//    1. User opens options → CtcRepo.getData() loads data into THIS context
//    2. User modifies rules → Saved to browser.storage.sync
//    3. Storage change event → Background context reloads via CtcRepo.loadRules()
//    4. Navigation uses updated rules in background context
//
// SYNCHRONIZATION:
//    - Options and background contexts stay in sync via browser.storage.sync
//    - No direct variable sharing between contexts (by design)
//    - This isolation prevents UI operations from blocking navigation
// ============================================================================

// MISSION CONTROL: User interface for managing container routing rules
// FAILURE MODE: If this crashes, users can't modify rules (extension becomes read-only)
class CtcOptions {
    constructor() {
        // STATE: Core data structures that mirror background script
        this.containers = [];  // Available Firefox containers
        this.rules = [];      // User-defined routing rules

        // DOM REFERENCES: Critical UI elements
        this.rulesTableBody = document.getElementById('rulesTableBody');
        this.validationMessages = document.getElementById('validationMessages');
        this.debugLoggingCheckbox = document.getElementById('debugLoggingCheckbox');

        this.initializeEventListeners();
        this.initializeDebugCheckbox();
        this.initializeData();
    }

    initializeEventListeners() {
        document.getElementById('saveRulesTopBtn').addEventListener('click', () => this.saveRulesFromUi());
        document.getElementById('saveRulesBottomBtn').addEventListener('click', () => this.saveRulesFromUi());
        document.getElementById('exportBtn').addEventListener('click', () => this.exportRules());
        document.getElementById('importBtn').addEventListener('click', () => this.saveRulesFromImport());
        if (this.debugLoggingCheckbox) {
            this.debugLoggingCheckbox.addEventListener('change', () => this.handleDebugLoggingToggle());
        } else {
            ctcConsole.warn('Debug logging checkbox missing from options DOM; preference toggle unavailable.');
        }
    }

    // SIMPLIFIED: Debug checkbox initialization (utils.js handles the heavy lifting)
    // utils.js already loads preferences and watches for changes, we just sync the UI
    initializeDebugCheckbox() {
        if (!this.debugLoggingCheckbox) {
            return; // Checkbox missing, likely in test environment
        }

        // Sync checkbox with current debug state (utils.js already loaded this)
        this.debugLoggingCheckbox.checked = typeof isDebugLoggingEnabled === 'function'
            ? isDebugLoggingEnabled()
            : false;
    }

    async handleDebugLoggingToggle() {
        if (!this.debugLoggingCheckbox) {
            return;
        }

        const enabled = this.debugLoggingCheckbox.checked;

        try {
            // Save to storage (this will trigger utils.js storage watcher in background context)
            await browser.storage.sync.set({ ctcDebugLoggingEnabled: enabled });

            // Update local context immediately
            if (typeof setDebugLoggingEnabled === 'function') {
                setDebugLoggingEnabled(enabled);
            }

            ctcConsole.info(`Debug logging ${enabled ? 'enabled' : 'disabled'} via options UI.`);
        } catch (error) {
            // Revert checkbox on error
            this.debugLoggingCheckbox.checked = !enabled;
            this.showValidationMessage('Failed to update debug logging preference.', 'error');
            ctcConsole.error('Failed to save debug preference:', error);
        }
    }

    // BOOTSTRAP: Load container and rule data into OPTIONS context
    // CRITICAL: This must succeed or user can't configure anything
    // CONTEXT ISOLATION: This loads data into THIS context's CtcRepo instance
    // NOTE: This is SEPARATE from background context's CtcRepo instance
    // WHY: Firefox isolates background and options page JavaScript contexts
    // WHAT: CtcRepo.getData() either returns cached data or calls initialize()
    initializeData() {
        ctcConsole.info('[Options] Loading CtcRepo data...');
        CtcRepo.getData(
            (data) => {
                // SUCCESS PATH: Data loaded successfully
                this.containers = data.containers.containerArray;
                this.rules = data.rules;

                ctcConsole.info('Options page initialized with:', this.containers.length, 'containers,', this.rules.length, 'rules');

                // POPULATE UI: Create container groups for all containers
                this.renderAllContainerGroups();
            },
            (error) => {
                // RECOVERY: Extension data unavailable - likely background script crash
                // FAILURE MODE: User sees broken UI, thinks extension is broken
                this.showValidationMessage('Failed to load extension data. Please reload the page.', 'error');
            }
        );
    }

    // NEW: Render all containers as compound rows
    renderAllContainerGroups() {
        this.rulesTableBody.innerHTML = '';

        // Group existing rules by container
        const rulesByContainer = {};
        this.rules.forEach(rule => {
            if (!rulesByContainer[rule.containerName]) {
                rulesByContainer[rule.containerName] = [];
            }
            rulesByContainer[rule.containerName].push(rule);
        });

        // Render each container (including ones without rules)
        this.containers.forEach(container => {
            const containerRules = rulesByContainer[container.name] || [];
            this.renderContainerGroup(container.name, containerRules);
        });
    }

    // NEW: Render a single container group with its URL patterns
    renderContainerGroup(containerName, existingRules = []) {
        // Clone the container group template
        const template = document.getElementById('container-group-template');
        const groupWrapper = template.content.cloneNode(true);

        const containerGroup = groupWrapper.querySelector('.container-group');
        containerGroup.dataset.containerName = containerName;

        // Determine container type from existing rules
        let containerType = 'no-rule';
        if (existingRules.length > 0) {
            containerType = existingRules[0].action; // All rules in container have same type
        }

        // Set container name and type
        const containerNameSpan = containerGroup.querySelector('.container-name');
        containerNameSpan.textContent = containerName;

        const typeSelect = containerGroup.querySelector('.container-type-select');
        typeSelect.value = containerType;
        typeSelect.dataset.containerName = containerName;

        // Add event listeners for header controls
        const addUrlBtn = containerGroup.querySelector('.add-url-btn');
        addUrlBtn.onclick = () => this.addUrlPatternToContainer(containerName);

        const clearBtn = containerGroup.querySelector('.clear-btn');
        clearBtn.onclick = () => this.clearContainer(containerName);

        typeSelect.addEventListener('change', (e) => this.handleContainerTypeChange(e.target));

        // Create URL pattern rows
        if (existingRules.length > 0) {
            existingRules.forEach(rule => {
                const urlRow = this.createUrlPatternRow(rule.urlPattern, rule.highPriority, containerName);
                containerGroup.appendChild(urlRow);
            });
        } else if (containerType !== 'no-rule') {
            // Show one empty URL row for enabled containers
            const urlRow = this.createUrlPatternRow('', false, containerName);
            containerGroup.appendChild(urlRow);
        }

        this.rulesTableBody.appendChild(groupWrapper);
    }


    // NEW: Create a URL pattern row within a container
    createUrlPatternRow(urlPattern = '', highPriority = false, containerName) {
        // Clone the URL pattern row template
        const template = document.getElementById('url-pattern-row-template');
        const row = template.content.cloneNode(true).querySelector('.url-pattern-row');

        // Set values
        const urlInput = row.querySelector('.url-pattern-input');
        urlInput.value = urlPattern;

        const priorityCheckbox = row.querySelector('.priority-checkbox');
        priorityCheckbox.checked = highPriority;

        // Set up delete button
        const deleteBtn = row.querySelector('.delete-btn');
        deleteBtn.onclick = () => this.deleteUrlPattern(row, containerName);

        // Add validation listeners
        urlInput.addEventListener('input', (e) => this.validateUrlPattern(e.target));

        return row;
    }

    // NEW: Create type selector for container

    // NEW: Handle container type changes
    handleContainerTypeChange(typeSelect) {
        const containerName = typeSelect.dataset.containerName;
        const newType = typeSelect.value;
        const containerGroup = typeSelect.closest('.container-group');

        if (newType === 'no-rule') {
            // Remove all URL pattern rows
            const urlRows = containerGroup.querySelectorAll('.url-pattern-row');
            urlRows.forEach(row => row.remove());

            // Hide add button
            const addBtn = containerGroup.querySelector('.add-url-btn');
            if (addBtn) addBtn.style.display = 'none';
        } else {
            // Show add button
            const addBtn = containerGroup.querySelector('.add-url-btn');
            if (addBtn) addBtn.style.display = 'inline-block';

            // Add one empty URL row if none exist
            const existingUrlRows = containerGroup.querySelectorAll('.url-pattern-row');
            if (existingUrlRows.length === 0) {
                const urlRow = this.createUrlPatternRow('', false, containerName);
                containerGroup.appendChild(urlRow);
            }
        }
    }

    // NEW: Add URL pattern to container
    addUrlPatternToContainer(containerName) {
        const containerGroup = this.rulesTableBody.querySelector(`[data-container-name="${containerName}"]`);
        if (containerGroup) {
            const urlRow = this.createUrlPatternRow('', false, containerName);
            containerGroup.appendChild(urlRow);
        }
    }

    // NEW: Delete URL pattern from container
    deleteUrlPattern(urlRow, containerName) {
        const containerGroup = urlRow.closest('.container-group');
        const urlRows = containerGroup.querySelectorAll('.url-pattern-row');

        if (urlRows.length > 1) {
            urlRow.remove();
        } else {
            // Clear the last row instead of removing it
            const urlInput = urlRow.querySelector('.url-pattern-input');
            const priorityCheckbox = urlRow.querySelector('.priority-checkbox');
            urlInput.value = '';
            priorityCheckbox.checked = false;
            this.setInputValidation(urlInput, '', '');
        }
    }

    // NEW: Clear all URL patterns from container
    clearContainer(containerName) {
        const containerGroup = this.rulesTableBody.querySelector(`[data-container-name="${containerName}"]`);
        if (containerGroup) {
            const urlRows = containerGroup.querySelectorAll('.url-pattern-row');
            urlRows.forEach(row => row.remove());

            // Reset type to no-rule
            const typeSelect = containerGroup.querySelector('.container-type-select');
            if (typeSelect) {
                typeSelect.value = 'no-rule';
                this.handleContainerTypeChange(typeSelect);
            }
        }
    }

    validateUrlPattern(input) {
        const pattern = input.value.trim();

        if (!pattern) {
            this.setInputValidation(input, '', '');
            return true;
        }

        // Check if it's regex mode (enclosed in /.../)
        if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
            try {
                const regexPattern = pattern.slice(1, -1);
                new RegExp(regexPattern);
                this.setInputValidation(input, 'valid', '');
                return true;
            } catch (error) {
                this.setInputValidation(input, 'invalid', 'Invalid regex pattern');
                return false;
            }
        } else {
            // Literal mode - always valid as long as it's not empty
            this.setInputValidation(input, 'valid', '');
            return true;
        }
    }

    setInputValidation(input, className, message) {
        input.className = input.className.replace(/\s*(valid|invalid)\s*/g, ' ').trim();
        if (className) {
            input.className += ` ${className}`;
        }

        // Remove existing validation message
        const existingMessage = input.parentNode.querySelector('.validation-error');
        if (existingMessage) {
            existingMessage.remove();
        }

        // Add new validation message if needed
        if (message) {
            const messageElement = document.createElement('div');
            messageElement.className = 'validation-error';
            messageElement.textContent = message;
            input.parentNode.appendChild(messageElement);
        }
    }

    showValidationMessage(message, type = 'info') {
        this.validationMessages.innerHTML = '';

        const messageElement = document.createElement('div');
        messageElement.className = `validation-message ${type}`;
        messageElement.textContent = message;

        this.validationMessages.appendChild(messageElement);

        // Auto-hide after 5 seconds for non-error messages
        if (type !== 'error') {
            setTimeout(() => {
                if (messageElement.parentNode) {
                    messageElement.remove();
                }
            }, 5000);
        }
    }

    clearValidationMessages() {
        this.validationMessages.innerHTML = '';
    }

    collectRulesFromTable() {
        const rules = [];

        // Collect rules from all container groups
        const containerGroups = this.rulesTableBody.querySelectorAll('.container-group');

        containerGroups.forEach(containerGroup => {
            const containerName = containerGroup.dataset.containerName;
            const typeSelect = containerGroup.querySelector('.container-type-select');
            const action = typeSelect.value;

            // Skip containers with no-rule type
            if (action === 'no-rule') {
                return;
            }

            // Collect URL patterns from this container
            const urlRows = containerGroup.querySelectorAll('.url-pattern-row');
            urlRows.forEach(urlRow => {
                const urlInput = urlRow.querySelector('.url-pattern-input');
                const priorityCheckbox = urlRow.querySelector('.priority-checkbox');
                const urlPattern = urlInput.value.trim();
                const highPriority = priorityCheckbox.checked;

                // Only include rules with valid URL patterns
                if (urlPattern) {
                    rules.push({
                        containerName,
                        action,
                        urlPattern,
                        highPriority
                    });
                }
            });
        });

        return rules;
    }

    // VALIDATION ENGINE: Comprehensive rule safety checks
    // PURPOSE: Prevent user from creating rules that break navigation
    validateAllRules(rules) {
        const errors = [];   // BLOCKING: Must fix these to save
        const warnings = []; // ADVISORY: Should consider fixing

        // CRITICAL CHECK: Container rule consistency
        // PROBLEM: Mixing "open" and "restricted" rules creates undefined behavior
        // EXAMPLE: Work container with both "allow github.com" and "only allow work.com"
        const containerRules = {};
        rules.forEach((rule, index) => {
            if (!containerRules[rule.containerName]) {
                containerRules[rule.containerName] = { open: 0, restricted: 0, ruleNumbers: [] };
            }
            if (rule.action === 'open') {
                containerRules[rule.containerName].open++;
            } else if (rule.action === 'restricted') {
                containerRules[rule.containerName].restricted++;
            }
            containerRules[rule.containerName].ruleNumbers.push(index + 1);
        });

        // ENFORCE: No mixed rule types per container
        for (const [container, counts] of Object.entries(containerRules)) {
            if (counts.open > 0 && counts.restricted > 0) {
                errors.push(`Container "${container}" cannot mix 'open' and 'restricted' rules. All rules for a container must be the same type.`);
            }
        }

        // INDIVIDUAL RULE VALIDATION: Check each rule for safety issues
        rules.forEach((rule, index) => {
            // CRITICAL: Prevent rules that block ALL navigation
            // FAILURE MODE: "Restricted" + "*" = user can't browse anywhere
            if (rule.action === 'restricted' && rule.urlPattern === '*') {
                errors.push(`Rule ${index + 1}: "Restricted" with "*" pattern blocks all navigation`);
            }

            // PRIVACY WARNING: Overly broad patterns leak browsing data
            if (rule.urlPattern === '.*') {
                warnings.push(`Rule ${index + 1}: Wildcard pattern '.*' reduces privacy - use specific patterns when possible`);
            }

            // SYNTAX CHECK: Ensure regex patterns are valid
            // FAILURE MODE: Invalid regex crashes rule evaluation
            try {
                new RegExp(rule.urlPattern);
            } catch (error) {
                errors.push(`Rule ${index + 1}: Invalid regex pattern "${rule.urlPattern}"`);
            }
        });

        // PRECEDENCE ANALYSIS: Check for conflicting high-priority rules
        // ISSUE: Multiple high-priority rules for same pattern create ambiguity
        const highPriorityPatterns = {};
        rules.forEach((rule, index) => {
            if (rule.highPriority) {
                if (highPriorityPatterns[rule.urlPattern]) {
                    highPriorityPatterns[rule.urlPattern].push(index + 1);
                } else {
                    highPriorityPatterns[rule.urlPattern] = [index + 1];
                }
            }
        });

        // WARN: Multiple high-priority rules - behavior is implementation dependent
        Object.entries(highPriorityPatterns).forEach(([pattern, ruleNumbers]) => {
            if (ruleNumbers.length > 1) {
                warnings.push(`Pattern "${pattern}" has multiple high priority rules (${ruleNumbers.join(', ')}). Only one will be used.`);
            }
        });

        return { errors, warnings };
    }

    // PERSIST: Low-level storage operation (private)
    // Encodes and saves rules to browser.storage.sync
    async #saveRules(rules) {
        const encodedRules = await encodeRulesForStorage(rules);
        ctcConsole.log("saving to browser.storage.sync");
        await browser.storage.sync.set({ ctcRules: encodedRules });
        this.rules = rules;
    }

    // COMMIT: Save user rules from UI to extension storage
    // CRITICAL: This is the only way users can persist their configuration via UI
    async saveRulesFromUi() {
        this.clearValidationMessages();

        try {
            // HARVEST: Extract rules from DOM table
            const rules = this.collectRulesFromTable();

            // EDGE CASE: Empty table - nothing to save
            if (rules.length === 0) {
                this.showValidationMessage('No valid rules to save.', 'warning');
                return;
            }

            // SAFETY CHECK: Run comprehensive validation
            const { errors, warnings } = this.validateAllRules(rules);

            // BLOCKING: Don't save broken rules that would crash navigation
            if (errors.length > 0) {
                const errorMessage = 'Validation errors:\n' + errors.join('\n');
                this.showValidationMessage(errorMessage, 'error');
                ctcConsole.error('Validation errors:', errors);
                return; // ABORT: User must fix errors first
            }

            // ADVISORY: Show warnings but allow save to proceed
            if (warnings.length > 0) {
                warnings.forEach(warning => {
                    ctcConsole.warn(warning);
                });
                this.showValidationMessage(`Saved with warnings. Check console for details.`, 'warning');
            }

            // PERSIST: Write rules to Firefox sync storage
            // CRITICAL: This triggers background script to reload rules
            await this.#saveRules(rules);

            // SUCCESS FEEDBACK: Confirm save to user
            const successMessage = `${rules.length} rules saved successfully`;
            ctcConsole.info(successMessage);
            this.showValidationMessage(`${rules.length} rules saved successfully.`, 'success');

            // Debug output: show rules in console table format (only if debug mode is enabled)
            if (typeof ctcConsole.table === 'function') {
                ctcConsole.info('Saved rules:');
                ctcConsole.table(rules.map((rule, index) => ({
                    '#': index + 1,
                    Container: rule.containerName,
                    Type: rule.action === 'open' ? '🌐 Open' : '🔒 Restricted',
                    'URL Pattern': rule.urlPattern,
                    'High Priority': rule.highPriority ? 'Yes' : 'No'
                })));
            }


        } catch (error) {
            // RECOVERY: Save operation failed - could be storage quota, network, etc
            // FAILURE MODE: User loses all their configuration work
            ctcConsole.error('Failed to save rules:', error);
            this.showValidationMessage('Failed to save rules. Please try again.', 'error');
        }
    }

    // EXPORT: Export rules to JSON for backup/sharing
    // REQUIREMENT: User must save rules before exporting (ensures consistency)
    exportRules() {
        this.clearValidationMessages();

        try {
            // HARVEST: Get current rules from UI
            const currentRules = this.collectRulesFromTable();

            // CONSISTENCY CHECK: Compare current UI state with saved rules
            // PURPOSE: Prevent exporting unsaved/unvalidated rules
            const currentRulesJson = JSON.stringify(currentRules);
            const savedRulesJson = JSON.stringify(this.rules);

            if (currentRulesJson !== savedRulesJson) {
                this.showValidationMessage('Please save rules first before exporting.', 'error');
                return;
            }

            // EXPORT: Convert to single-line JSON for easy copy-paste
            const exportJson = JSON.stringify(this.rules);

            // DISPLAY: Show JSON in readonly input field
            const exportOutput = document.getElementById('exportOutput');
            exportOutput.value = exportJson;
            exportOutput.style.display = 'block';

            this.showValidationMessage('Rules exported successfully. Copy the JSON below.', 'success');
            ctcConsole.info('Exported', this.rules.length, 'rules');
        } catch (error) {
            ctcConsole.error('Failed to export rules:', error);
            this.showValidationMessage('Failed to export rules. Please try again.', 'error');
        }
    }

    // IMPORT: Import rules from JSON
    // SAFETY: Full validation before replacing existing rules
    async saveRulesFromImport() {
        this.clearValidationMessages();

        try {
            ctcConsole.log("importing rules from user input");

            // HARVEST: Get JSON from input field
            const importInput = document.getElementById('importJsonInput');
            const jsonString = importInput.value.trim();

            if (!jsonString) {
                this.showValidationMessage('Please paste JSON rules to import.', 'error');
                return;
            }

            // PARSE: Validate JSON syntax
            let importedRules;
            try {
                importedRules = JSON.parse(jsonString);
                ctcConsole.log(`parsed ${importedRules.length} rules`);
            } catch (parseError) {
                this.showValidationMessage('Invalid JSON format. Please check your input.', 'error');
                ctcConsole.error('JSON parse error:', parseError);
                return;
            }

            // TYPE CHECK: Ensure it's an array
            if (!Array.isArray(importedRules)) {
                this.showValidationMessage('Invalid format: Rules must be an array.', 'error');
                return;
            }

            // SAFETY CHECK: Run comprehensive validation (reuse existing logic)
            const { errors, warnings } = this.validateAllRules(importedRules);

            // BLOCKING: Don't import broken rules
            if (errors.length > 0) {
                const errorMessage = 'Validation errors:\n' + errors.join('\n');
                this.showValidationMessage(errorMessage, 'error');
                ctcConsole.error('Validation errors:', errors);
                return; // ABORT: User must fix errors first
            }

            // ADVISORY: Show warnings but allow import
            if (warnings.length > 0) {
                warnings.forEach(warning => {
                    ctcConsole.warn(warning);
                });
            }

            ctcConsole.log(`validated ${importedRules.length} rules`);

            // COMMIT: Replace all rules in storage
            await this.#saveRules(importedRules);

            ctcConsole.log(`saved and imported ${importedRules.length} rules`);

            // REFRESH: Re-render UI to show imported rules
            this.renderAllContainerGroups();

            // CLEANUP: Clear import input
            importInput.value = '';

            // SUCCESS FEEDBACK
            const successMessage = warnings.length > 0
                ? `${importedRules.length} rules imported with warnings. Check console for details.`
                : `${importedRules.length} rules imported successfully.`;
            this.showValidationMessage(successMessage, warnings.length > 0 ? 'warning' : 'success');
            ctcConsole.info('Imported', importedRules.length, 'rules');

        } catch (error) {
            ctcConsole.error('Failed to import rules:', error);
            this.showValidationMessage('Failed to import rules. Please try again.', 'error');
        }
    }
}

// Initialize the options page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new CtcOptions();
});
