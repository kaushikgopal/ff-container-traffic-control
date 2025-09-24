// Container Traffic Control Options Page
// Handles rule management, validation, and storage

// MISSION CONTROL: User interface for managing container routing rules
// FAILURE MODE: If this crashes, users can't modify rules (extension becomes read-only)
class ContainerTrafficControlOptions {
    constructor() {
        // STATE: Core data structures that mirror background script
        this.containers = [];  // Available Firefox containers
        this.rules = [];      // User-defined routing rules

        // DOM REFERENCES: Critical UI elements
        this.rulesTableBody = document.getElementById('rulesTableBody');
        this.validationMessages = document.getElementById('validationMessages');

        this.initializeEventListeners();
        this.initializeData();
    }

    initializeEventListeners() {
        document.getElementById('addRuleBtn').addEventListener('click', () => this.addRuleRow());
        document.getElementById('saveRulesBtn').addEventListener('click', () => this.saveRules());
    }

    // BOOTSTRAP: Load container and rule data from background script
    // CRITICAL: This must succeed or user can't configure anything
    initializeData() {
        CtcRepo.getData(
            (data) => {
                // SUCCESS PATH: Data loaded successfully
                this.containers = data.containers.containerArray;
                this.rules = data.rules;

                ctcConsole.info('Options page initialized with:', this.containers.length, 'containers,', this.rules.length, 'rules');

                // POPULATE UI: Create table rows for existing rules
                this.rules.forEach(rule => this.addRuleRow(rule));

                // UX: Always show at least one empty row for new users
                if (this.rules.length === 0) {
                    this.addRuleRow();
                }
            },
            (error) => {
                // RECOVERY: Extension data unavailable - likely background script crash
                // FAILURE MODE: User sees broken UI, thinks extension is broken
                this.showValidationMessage('Failed to load extension data. Please reload the page.', 'error');
            }
        );
    }

    addRuleRow(existingRule = null) {
        const row = document.createElement('tr');
        row.className = 'rule-row';

        // Create type selector
        const typeSelect = this.createTypeSelect(existingRule?.action);

        // Create container dropdown
        const containerSelect = this.createContainerSelect(existingRule?.containerName);

        // Create URL pattern input with validation
        const urlPatternInput = this.createUrlPatternInput(existingRule?.urlPattern);

        // Create high priority checkbox
        const priorityCheckbox = this.createPriorityCheckbox(existingRule?.highPriority);

        // Create delete button
        const deleteButton = this.createDeleteButton(row);

        // Create table cells and append elements safely
        const typeCell = document.createElement('td');
        typeCell.className = 'text-center';
        typeCell.appendChild(typeSelect);

        const containerCell = document.createElement('td');
        containerCell.appendChild(containerSelect);

        const urlPatternCell = document.createElement('td');
        urlPatternCell.appendChild(urlPatternInput);

        const priorityCell = document.createElement('td');
        priorityCell.className = 'text-center';
        priorityCell.appendChild(priorityCheckbox);

        const deleteCell = document.createElement('td');
        deleteCell.className = 'text-center';
        deleteCell.appendChild(deleteButton);

        // Append all cells to the row
        row.appendChild(typeCell);
        row.appendChild(containerCell);
        row.appendChild(urlPatternCell);
        row.appendChild(priorityCell);
        row.appendChild(deleteCell);

        // Add to single rules table
        this.rulesTableBody.appendChild(row);

        // Re-attach event listeners
        this.attachRowEventListeners(row);
    }

    createContainerSelect(selectedContainer = '') {
        const select = document.createElement('select');
        select.className = 'container-select';
        select.required = true;

        // Add empty option
        const emptyOption = document.createElement('option');
        emptyOption.value = '';
        emptyOption.textContent = 'Select Container';
        select.appendChild(emptyOption);

        // Add container options
        this.containers.forEach(container => {
            const option = document.createElement('option');
            option.value = container.name;
            option.textContent = container.name;
            if (container.name === selectedContainer) {
                option.selected = true;
            }
            select.appendChild(option);
        });

        return select;
    }

    createTypeSelect(selectedType = 'open') {
        const select = document.createElement('select');
        select.className = 'type-select';
        select.required = true;

        // Add options
        const openOption = document.createElement('option');
        openOption.value = 'open';
        openOption.textContent = '🌐 Open';
        openOption.title = 'Container accepts these URLs plus any others';
        if (selectedType === 'open') {
            openOption.selected = true;
        }
        select.appendChild(openOption);

        const restrictedOption = document.createElement('option');
        restrictedOption.value = 'restricted';
        restrictedOption.textContent = '🔒 Restricted';
        restrictedOption.title = 'Container ONLY accepts these URLs';
        if (selectedType === 'restricted') {
            restrictedOption.selected = true;
        }
        select.appendChild(restrictedOption);

        return select;
    }

    createUrlPatternInput(existingPattern = '') {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'url-pattern-input';
        input.placeholder = 'github.com or /regex/';
        input.value = existingPattern;
        input.required = true;

        return input;
    }

    createPriorityCheckbox(isHighPriority = false) {
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'priority-checkbox';
        checkbox.checked = isHighPriority || false;

        return checkbox;
    }

    createDeleteButton(row) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-danger btn-small';
        button.textContent = 'Delete';
        button.onclick = () => this.deleteRuleRow(row);

        return button;
    }

    attachRowEventListeners(row) {
        // Add real-time validation for URL pattern input
        const urlPatternInput = row.querySelector('.url-pattern-input');
        urlPatternInput.addEventListener('input', (e) => this.validateUrlPattern(e.target));
        urlPatternInput.addEventListener('input', () => this.validateRow(row));
    }

    deleteRuleRow(row) {
        const tableBody = row.parentNode;
        const totalRows = this.rulesTableBody.children.length;

        if (totalRows > 1) {
            row.remove();
        } else {
            // Keep at least one row, just clear it
            this.clearRow(row);
        }
    }

    clearRow(row) {
        row.querySelector('.type-select').value = 'open';
        row.querySelector('.container-select').value = '';
        row.querySelector('.url-pattern-input').value = '';
        row.querySelector('.priority-checkbox').checked = false;
        this.clearRowValidation(row);
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

    validateRow(row) {
        const urlPatternInput = row.querySelector('.url-pattern-input');
        const action = row.querySelector('.type-select').value;
        const pattern = urlPatternInput.value.trim();

        // Check for invalid "Restricted" + "*" combination
        if (action === 'restricted' && pattern === '*') {
            this.setRowValidation(row, 'invalid', 'Invalid rule: "Restricted" with "*" pattern blocks all navigation');
            return false;
        } else {
            this.clearRowValidation(row);
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

    setRowValidation(row, className, message) {
        row.className = row.className.replace(/\s*(valid|invalid)\s*/g, ' ').trim();
        if (className) {
            row.className += ` ${className}`;
        }

        // Show global validation message
        if (message) {
            this.showValidationMessage(message, 'error');
        }
    }

    clearRowValidation(row) {
        row.className = row.className.replace(/\s*(valid|invalid)\s*/g, ' ').trim();
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
        const rows = this.rulesTableBody.querySelectorAll('.rule-row');
        const rules = [];

        // Collect all rules from single table
        rows.forEach(row => {
            const containerName = row.querySelector('.container-select').value.trim();
            const urlPattern = row.querySelector('.url-pattern-input').value.trim();
            const highPriority = row.querySelector('.priority-checkbox').checked;
            const action = row.querySelector('.type-select').value;

            // Only include rules with all required fields
            if (containerName && urlPattern) {
                rules.push({
                    containerName,
                    action,
                    urlPattern,
                    highPriority
                });
            }
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

        // WARN: Multiple high-priority rules - behavior is rule-order dependent
        Object.entries(highPriorityPatterns).forEach(([pattern, ruleNumbers]) => {
            if (ruleNumbers.length > 1) {
                warnings.push(`Pattern "${pattern}" has multiple high priority rules (${ruleNumbers.join(', ')}). Precedence follows rule order.`);
            }
        });

        return { errors, warnings };
    }

    // COMMIT: Save user rules to extension storage
    // CRITICAL: This is the only way users can persist their configuration
    async saveRules() {
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
            await browser.storage.sync.set({ ctcRules: rules });
            this.rules = rules; // Update local cache

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
                    Action: rule.action === 'allow' ? 'Allow' : 'Allow Only',
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
}

// Initialize the options page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ContainerTrafficControlOptions();
});