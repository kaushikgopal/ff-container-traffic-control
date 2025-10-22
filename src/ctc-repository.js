// Container Traffic Control Data Repository
// Centralized container and rule management

/**
 * Centralized container and rule management
 * CRITICAL: Thread-safe data repository for background script
 */
class CtcRepository {
    // SHARED STATE: Accessed by multiple async operations
    containerMap = new Map();
    cookieStoreToNameMap = new Map();
    rules = [];

    // CONCURRENCY CONTROL: Prevent race conditions during async loads (private)
    #loadingContainersPromise = null;
    #loadingRulesPromise = null;
    #initializationFailed = false;

    /**
     * THREAD-SAFE: Load containers with race condition protection
     * PROBLEM: Multiple events (onCreated, onRemoved) can fire simultaneously
     * FAILURE MODE: Concurrent loads corrupt Maps, lose container data
     * @param {Function} onSuccess - Optional success callback
     * @param {Function} onError - Optional error callback
     */
    async loadContainers(onSuccess, onError) {
        // CONCURRENCY: If already loading, return the same promise
        // BENEFIT: Multiple callers get same result, no duplicate API calls
        if (this.#loadingContainersPromise) {
            return this.#loadingContainersPromise;
        }

        // ATOMIC OPERATION: Create promise for this load cycle
        this.#loadingContainersPromise = this.#doLoadContainers()
            .finally(() => {
                // CLEANUP: Always clear promise when done (success or failure)
                // CRITICAL: Allows future loads after errors
                this.#loadingContainersPromise = null;
            });

        try {
            const result = await this.#loadingContainersPromise;
            if (onSuccess) onSuccess(result);
            return result;
        } catch (error) {
            if (onError) onError(error);
            else throw error;
        }
    }

    /**
     * INTERNAL: Actual container loading implementation (private)
     * SEPARATION: Keep loading logic separate from concurrency control
     */
    async #doLoadContainers() {
        try {
            // BROWSER API: Query all Firefox containers
            const contextualIdentities = await browser.contextualIdentities.query({});

            // ATOMIC UPDATE: Clear and rebuild Maps in one operation
            // CRITICAL: Don't partially update - other code might see inconsistent state
            this.containerMap.clear();
            this.cookieStoreToNameMap.clear();

            // DEFAULT: Add built-in "No Container" option
            this.containerMap.set('No Container', 'firefox-default');
            this.cookieStoreToNameMap.set('firefox-default', 'No Container');

            // POPULATE: Add all user containers
            contextualIdentities.forEach(identity => {
                this.containerMap.set(identity.name, identity.cookieStoreId);
                this.cookieStoreToNameMap.set(identity.cookieStoreId, identity.name);
            });

            ctcConsole.log(`Loaded ${this.containerMap.size} containers`);
            return this.getContainerData();
        } catch (error) {
            // PROPAGATE: Let caller handle the error
            ctcConsole.error('Failed to load containers:', error);
            throw error;
        }
    }

    /**
     * THREAD-SAFE: Load rules with race condition protection
     * PROBLEM: Storage change events can fire rapidly during rule saves
     * FAILURE MODE: Concurrent loads can corrupt rules array
     * @param {Function} onSuccess - Optional success callback
     * @param {Function} onError - Optional error callback
     */
    async loadRules(onSuccess, onError) {
        // CONCURRENCY: Prevent multiple simultaneous rule loads
        if (this.#loadingRulesPromise) {
            return this.#loadingRulesPromise;
        }

        // ATOMIC OPERATION: Single promise for this load cycle
        this.#loadingRulesPromise = this.#doLoadRules()
            .finally(() => {
                // CLEANUP: Always clear promise state
                this.#loadingRulesPromise = null;
            });

        try {
            const result = await this.#loadingRulesPromise;
            if (onSuccess) onSuccess(result);
            return result;
        } catch (error) {
            if (onError) onError(error);
            else throw error;
        }
    }

    /**
     * INTERNAL: Actual rules loading implementation (private)
     */
    async #doLoadRules() {
        try {
            // STORAGE API: Get rules from Firefox sync storage
            const storage = await browser.storage.sync.get('ctcRules');
            const decodedRules = await decodeRulesFromStorage(storage.ctcRules);

            // ATOMIC UPDATE: Replace entire rules array
            // CRITICAL: Don't mutate existing array - other code might be iterating
            this.rules = decodedRules;

            ctcConsole.log(`Loaded ${this.rules.length} rules`);
            return this.rules;
        } catch (error) {
            ctcConsole.error('Failed to load rules:', error);
            throw error;
        }
    }

    /**
     * BOOTSTRAP: Initialize both containers and rules with failure tracking
     * CRITICAL: Extension is non-functional if this fails
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

            // SUCCESS: Reset failure flag
            this.#initializationFailed = false;
            ctcConsole.info('Extension initialized successfully');

            if (onSuccess) onSuccess(result);
            return result;
        } catch (error) {
            // CRITICAL FAILURE: Mark extension as non-functional
            this.#initializationFailed = true;
            ctcConsole.error('CRITICAL: Extension initialization failed - rules will not work');
            ctcConsole.error('Error details:', error);
            ctcConsole.error('User action: Try reloading the extension or restarting Firefox');

            if (onError) onError(error);
            else throw error;
        }
    }

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
    }

    /**
     * Get current rules
     */
    getRules() {
        return this.rules;
    }

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
}

// Create singleton instance
const CtcRepo = new CtcRepository();

// Make data repository available globally
if (typeof window !== 'undefined') {
    window.CtcRepo = CtcRepo;
} else {
    globalThis.CtcRepo = CtcRepo;
}
