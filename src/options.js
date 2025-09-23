// Container Traffic Control Options Page
// Handles rule management, validation, and storage

class ContainerTrafficControlOptions {
    constructor() {
        this.containers = [];
        this.rules = [];
        this.rulesTableBody = document.getElementById('rulesTableBody');
        this.validationMessages = document.getElementById('validationMessages');

        this.initializeEventListeners();
        this.initializeData();
    }

    initializeEventListeners() {
        document.getElementById('addRuleBtn').addEventListener('click', () => this.addRuleRow());
        document.getElementById('saveRulesBtn').addEventListener('click', () => this.saveRules());
    }

    initializeData() {
        CtcRepo.getData(
            (data) => {
                // Success callback
                this.containers = data.containers.containerArray;
                this.rules = data.rules;

                ctcConsole.info('Options page initialized with:', this.containers.length, 'containers,', this.rules.length, 'rules');

                // Display existing rules in the table
                this.rules.forEach(rule => this.addRuleRow(rule));

                if (this.rules.length === 0) {
                    // Add one empty rule by default
                    this.addRuleRow();
                }
            },
            (error) => {
                // Error callback
                this.showValidationMessage('Failed to load extension data. Please reload the page.', 'error');
            }
        );
    }

    addRuleRow(existingRule = null) {
        const row = document.createElement('tr');
        row.className = 'rule-row';

        // Create container dropdown
        const containerSelect = this.createContainerSelect(existingRule?.containerName);

        // Create action dropdown
        const actionSelect = this.createActionSelect(existingRule?.action);

        // Create URL pattern input with validation
        const urlPatternInput = this.createUrlPatternInput(existingRule?.urlPattern);

        // Create high priority checkbox
        const priorityCheckbox = this.createPriorityCheckbox(existingRule?.highPriority);

        // Create delete button
        const deleteButton = this.createDeleteButton(row);

        row.innerHTML = `
            <td>${containerSelect.outerHTML}</td>
            <td>${actionSelect.outerHTML}</td>
            <td>${urlPatternInput.outerHTML}</td>
            <td class="text-center">${priorityCheckbox.outerHTML}</td>
            <td class="text-center">${deleteButton.outerHTML}</td>
        `;

        this.rulesTableBody.appendChild(row);

        // Re-attach event listeners after innerHTML
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

    createActionSelect(selectedAction = '') {
        const select = document.createElement('select');
        select.className = 'action-select';
        select.required = true;

        const options = [
            { value: '', text: 'Select Action' },
            { value: 'allow', text: 'Allow' },
            { value: 'allow_only', text: 'Allow Only' }
        ];

        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option.value;
            optionElement.textContent = option.text;
            if (option.value === selectedAction) {
                optionElement.selected = true;
            }
            select.appendChild(optionElement);
        });

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

        // Add validation for action + pattern combination
        const actionSelect = row.querySelector('.action-select');
        actionSelect.addEventListener('change', () => this.validateRow(row));
        urlPatternInput.addEventListener('input', () => this.validateRow(row));
    }

    deleteRuleRow(row) {
        if (this.rulesTableBody.children.length > 1) {
            row.remove();
        } else {
            // Keep at least one row, just clear it
            this.clearRow(row);
        }
    }

    clearRow(row) {
        row.querySelector('.container-select').value = '';
        row.querySelector('.action-select').value = '';
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
        const actionSelect = row.querySelector('.action-select');
        const urlPatternInput = row.querySelector('.url-pattern-input');

        const action = actionSelect.value;
        const pattern = urlPatternInput.value.trim();

        // Check for invalid "Allow Only" + "*" combination
        if (action === 'allow_only' && pattern === '*') {
            this.setRowValidation(row, 'invalid', 'Invalid rule: "Allow Only" with "*" pattern blocks all navigation');
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

        rows.forEach(row => {
            const containerName = row.querySelector('.container-select').value.trim();
            const action = row.querySelector('.action-select').value.trim();
            const urlPattern = row.querySelector('.url-pattern-input').value.trim();
            const highPriority = row.querySelector('.priority-checkbox').checked;

            // Only include rules with all required fields
            if (containerName && action && urlPattern) {
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

    validateAllRules(rules) {
        const errors = [];
        const warnings = [];

        // Check that containers don't mix allow and allow-only rules
        const containerRules = {};
        rules.forEach((rule, index) => {
            if (!containerRules[rule.containerName]) {
                containerRules[rule.containerName] = { allow: 0, allowOnly: 0, ruleNumbers: [] };
            }
            if (rule.action === 'allow') {
                containerRules[rule.containerName].allow++;
            } else if (rule.action === 'allow_only') {
                containerRules[rule.containerName].allowOnly++;
            }
            containerRules[rule.containerName].ruleNumbers.push(index + 1);
        });

        // Validate container rule consistency
        for (const [container, counts] of Object.entries(containerRules)) {
            if (counts.allow > 0 && counts.allowOnly > 0) {
                errors.push(`Container "${container}" cannot mix 'allow' and 'allow-only' rules. All rules for a container must be the same type.`);
            }
        }

        // Check each rule for validation issues
        rules.forEach((rule, index) => {
            // Check for invalid "Allow Only" + "*" combination
            if (rule.action === 'allow_only' && rule.urlPattern === '*') {
                errors.push(`Rule ${index + 1}: "Allow Only" with "*" pattern blocks all navigation`);
            }

            // Warn about wildcard patterns
            if (rule.urlPattern === '.*') {
                warnings.push(`Rule ${index + 1}: Wildcard pattern '.*' reduces privacy - use specific patterns when possible`);
            }

            // Validate regex pattern
            try {
                new RegExp(rule.urlPattern);
            } catch (error) {
                errors.push(`Rule ${index + 1}: Invalid regex pattern "${rule.urlPattern}"`);
            }
        });

        // Check for high priority conflicts
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

        Object.entries(highPriorityPatterns).forEach(([pattern, ruleNumbers]) => {
            if (ruleNumbers.length > 1) {
                warnings.push(`Pattern "${pattern}" has multiple high priority rules (${ruleNumbers.join(', ')}). Precedence follows rule order.`);
            }
        });

        return { errors, warnings };
    }

    async saveRules() {
        this.clearValidationMessages();

        try {
            // Collect rules from the table
            const rules = this.collectRulesFromTable();

            if (rules.length === 0) {
                this.showValidationMessage('No valid rules to save.', 'warning');
                return;
            }

            // Validate all rules
            const { errors, warnings } = this.validateAllRules(rules);

            // Show errors and prevent saving if any exist
            if (errors.length > 0) {
                const errorMessage = 'Validation errors:\n' + errors.join('\n');
                this.showValidationMessage(errorMessage, 'error');
                ctcConsole.error('Validation errors:', errors);
                return;
            }

            // Show warnings but allow saving
            if (warnings.length > 0) {
                warnings.forEach(warning => {
                    ctcConsole.warn(warning);
                });
                this.showValidationMessage(`Saved with warnings. Check console for details.`, 'warning');
            }

            // Save rules to storage
            await browser.storage.local.set({ ctcRules: rules });
            this.rules = rules;

            // Show success message
            const successMessage = `${rules.length} rules saved successfully`;
            ctcConsole.info(successMessage);
            this.showValidationMessage(`${rules.length} rules saved successfully.`, 'success');

            // Debug output: show rules in console table format
            ctcConsole.info('Saved rules:');
            ctcConsole.table(rules.map((rule, index) => ({
                '#': index + 1,
                Container: rule.containerName,
                Action: rule.action === 'allow' ? 'Allow' : 'Allow Only',
                'URL Pattern': rule.urlPattern,
                'High Priority': rule.highPriority ? 'Yes' : 'No'
            })));

        } catch (error) {
            ctcConsole.error('Failed to save rules:', error);
            this.showValidationMessage('Failed to save rules. Please try again.', 'error');
        }
    }
}

// Initialize the options page when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ContainerTrafficControlOptions();
});