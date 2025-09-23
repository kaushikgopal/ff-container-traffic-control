// Container Traffic Control Data Repository
// Centralized container and rule management

/**
 * Centralized container and rule management
 */
const CtcRepo = {
    // Global state
    containerMap: new Map(),
    cookieStoreToNameMap: new Map(),
    rules: [],

    /**
     * Load containers and update global state
     * @param {Function} onSuccess - Optional success callback
     * @param {Function} onError - Optional error callback
     */
    async loadContainers(onSuccess, onError) {
        try {
            const contextualIdentities = await browser.contextualIdentities.query({});
            this.containerMap.clear();
            this.cookieStoreToNameMap.clear();

            // Add default container
            this.containerMap.set('No Container', 'firefox-default');
            this.cookieStoreToNameMap.set('firefox-default', 'No Container');

            contextualIdentities.forEach(identity => {
                this.containerMap.set(identity.name, identity.cookieStoreId);
                this.cookieStoreToNameMap.set(identity.cookieStoreId, identity.name);
            });

            ctcConsole.log(`Loaded ${this.containerMap.size} containers`);

            if (onSuccess) onSuccess(this.getContainerData());
            return this.getContainerData();
        } catch (error) {
            ctcConsole.error('Failed to load containers:', error);
            if (onError) onError(error);
            else throw error;
        }
    },

    /**
     * Load rules and update global state
     * @param {Function} onSuccess - Optional success callback
     * @param {Function} onError - Optional error callback
     */
    async loadRules(onSuccess, onError) {
        try {
            const storage = await browser.storage.sync.get('ctcRules');
            this.rules = storage.ctcRules || [];
            ctcConsole.log(`Loaded ${this.rules.length} rules`);

            if (onSuccess) onSuccess(this.rules);
            return this.rules;
        } catch (error) {
            ctcConsole.error('Failed to load rules:', error);
            if (onError) onError(error);
            else throw error;
        }
    },

    /**
     * Initialize both containers and rules
     * @param {Function} onSuccess - Optional success callback with {containers, rules}
     * @param {Function} onError - Optional error callback
     */
    async initialize(onSuccess, onError) {
        try {
            await this.loadContainers();
            await this.loadRules();

            const result = {
                containers: this.getContainerData(),
                rules: this.rules
            };

            ctcConsole.info('Extension initialized');

            if (onSuccess) onSuccess(result);
            return result;
        } catch (error) {
            ctcConsole.error('Failed to initialize:', error);
            if (onError) onError(error);
            else throw error;
        }
    },

    /**
     * Get container data in different formats for different use cases
     */
    getContainerData() {
        return {
            containerMap: this.containerMap,
            cookieStoreToNameMap: this.cookieStoreToNameMap,
            // For options page - array format
            containerArray: Array.from(this.containerMap.entries()).map(([name, cookieStoreId]) => ({
                name,
                cookieStoreId
            }))
        };
    },

    /**
     * Get current rules
     */
    getRules() {
        return this.rules;
    },

    /**
     * Get existing data without re-initializing
     * Loads data if not already available
     * @param {Function} onSuccess - Success callback with {containers, rules}
     * @param {Function} onError - Optional error callback
     */
    async getData(onSuccess, onError) {
        try {
            // If already initialized, return cached data
            if (this.containerMap.size > 0 && this.rules !== undefined) {
                const result = {
                    containers: this.getContainerData(),
                    rules: this.rules
                };
                if (onSuccess) onSuccess(result);
                return result;
            }

            // Otherwise, initialize first
            return await this.initialize(onSuccess, onError);
        } catch (error) {
            ctcConsole.error('Failed to get data:', error);
            if (onError) onError(error);
            else throw error;
        }
    }
};

// Make data repository available globally
if (typeof window !== 'undefined') {
    window.CtcRepo = CtcRepo;
} else {
    globalThis.CtcRepo = CtcRepo;
}