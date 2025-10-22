// Container Traffic Control Data Repository
// Centralized container and rule management

// ============================================================================
// EXECUTION CONTEXT ISOLATION: Why We Use Singletons
// ============================================================================
// CtcRepository is instantiated as a singleton (line 220) and exported globally
// (lines 223-227). This pattern exists because:
//
// 1. FIREFOX CONTEXT ISOLATION:
//    - Background and options contexts each get their OWN CtcRepo instance
//    - window.CtcRepo in background ≠ window.CtcRepo in options
//    - Each context's singleton holds that context's data independently
//
// 2. WHY SINGLETON WITHIN EACH CONTEXT:
//    - Prevents multiple competing data caches in same context
//    - Single source of truth for containers and rules per context
//    - Enables race-condition-safe lazy loading (see concurrency notes below)
//
// 3. GLOBAL EXPORT PATTERN:
//    - Exported to window (browser contexts) and globalThis (workers/tests)
//    - Makes CtcRepo available across all scripts in same context
//    - Does NOT share across contexts (background vs options)
// ============================================================================

/**
 * Centralized container and rule management
 * CRITICAL: Thread-safe data repository with concurrency protection
 */
class CtcRepository {
    // SHARED STATE: Accessed by multiple async operations
    containerMap = new Map();            // name → cookieStoreId
    cookieStoreToNameMap = new Map();    // cookieStoreId → name
    rules = [];                          // Array of rule objects

    // ========================================================================
    // CONCURRENCY CONTROL: Race Condition Prevention (private fields)
    // ========================================================================
    // PROBLEM: Multiple async events can fire simultaneously:
    //    - onCreated + onRemoved firing in rapid succession
    //    - Multiple webRequests calling evaluateContainer concurrently
    //    - Options page saving while background is loading
    //
    // FAILURE MODE: Without protection, concurrent loads corrupt Maps:
    //    Thread A: containerMap.clear()
    //    Thread B: containerMap.clear()  ← Clears A's partial data
    //    Thread A: containerMap.set(...)  ← Writes incomplete data
    //    Thread B: containerMap.set(...)  ← Overwrites with different data
    //    Result: Inconsistent state, lost containers, broken navigation
    //
    // SOLUTION: Promise-based mutual exclusion
    //    - Store in-flight load promise in #loadingContainersPromise
    //    - Subsequent calls wait for same promise instead of starting new load
    //    - All callers get consistent result from single load operation
    //    - Promise cleared in .finally() to allow future loads
    // ========================================================================
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
        // ====================================================================
        // CONCURRENCY PROTECTION: Promise-based mutual exclusion
        // ====================================================================
        // SCENARIO: Container created and removed in rapid succession
        //    Event 1: onCreated fires → calls loadContainers()
        //    Event 2: onRemoved fires → calls loadContainers()
        //    WITHOUT PROTECTION: Both start parallel loads → race condition
        //
        // SOLUTION: Store in-flight promise, reuse for concurrent callers
        //    Call 1: No promise exists → create new load → store promise
        //    Call 2: Promise exists → wait for same promise → no new load
        //    Result: Single load, all callers get same consistent data
        // ====================================================================
        if (this.#loadingContainersPromise) {
            return this.#loadingContainersPromise;
        }

        // ATOMIC OPERATION: Create promise for this load cycle
        // CRITICAL: Assigned BEFORE any await to catch concurrent calls
        this.#loadingContainersPromise = this.#doLoadContainers()
            .finally(() => {
                // CLEANUP: Always clear promise when done (success or failure)
                // CRITICAL: Allows future loads after errors or completion
                // TIMING: Cleared after load completes, before next call
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

            ctcConsole.debug(`Loaded ${this.containerMap.size} containers`);
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

            ctcConsole.debug(`Loaded ${this.rules.length} rules`);
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

// ============================================================================
// SINGLETON PATTERN: Create single instance for this execution context
// ============================================================================
// CRITICAL: This creates ONE instance per context (not shared across contexts)
// - Background context gets its own CtcRepo instance
// - Options context gets its own CtcRepo instance
// - Both use same class, but maintain separate data
//
// WHY SINGLETON: Prevents multiple competing caches in same context
// WHY SEPARATE INSTANCES: Firefox isolates background/options contexts
// ============================================================================
const CtcRepo = new CtcRepository();

// ============================================================================
// GLOBAL EXPORT: Make available to all scripts in THIS context
// ============================================================================
// PATTERN: Export to window (browser) or globalThis (workers/tests)
// SCOPE: Only available within same execution context
// USAGE: Both background.js and options.js can access their context's CtcRepo
// ============================================================================
if (typeof window !== 'undefined') {
    window.CtcRepo = CtcRepo;
} else {
    globalThis.CtcRepo = CtcRepo;
}
