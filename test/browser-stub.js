const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createBackgroundHarness(options = {}) {
  const listeners = {
    beforeRequest: null,
    tabRemoved: [],
    identityCreated: [],
    identityRemoved: [],
    identityUpdated: [],
    storageChanged: [],
  };
  const createCalls = [];
  const removeCalls = [];
  const logs = [];
  const timers = [];
  let nextTabId = 100;

  const containerMap = new Map([
    ['No Container', 'firefox-default'],
    ['Work', 'work-id'],
    ['Personal', 'personal-id'],
  ]);
  const cookieStoreToNameMap = new Map(
    Array.from(containerMap, ([name, id]) => [id, name]),
  );
  const rules = options.rules || [
    { containerName: 'Work', action: 'open', urlPattern: 'work.example' },
  ];

  const browser = {
    webRequest: {
      onBeforeRequest: {
        addListener(listener) {
          listeners.beforeRequest = listener;
        },
      },
    },
    storage: {
      onChanged: {
        addListener(listener) {
          listeners.storageChanged.push(listener);
        },
      },
    },
    contextualIdentities: {
      onCreated: { addListener(listener) { listeners.identityCreated.push(listener); } },
      onRemoved: { addListener(listener) { listeners.identityRemoved.push(listener); } },
      onUpdated: { addListener(listener) { listeners.identityUpdated.push(listener); } },
    },
    tabs: {
      onRemoved: {
        addListener(listener) {
          listeners.tabRemoved.push(listener);
        },
      },
      get(tabId) {
        if (options.getTab) return options.getTab(tabId);
        return Promise.resolve({
          id: tabId,
          cookieStoreId: options.sourceStoreId || 'firefox-default',
          active: true,
        });
      },
      create(createOptions) {
        createCalls.push(createOptions);
        if (options.createTab) return options.createTab(createOptions, createCalls.length);
        return Promise.resolve({ id: nextTabId++ });
      },
      remove(tabId) {
        removeCalls.push(tabId);
        if (options.removeTab) return options.removeTab(tabId, removeCalls.length);
        return Promise.resolve();
      },
    },
  };

  const CtcRepo = {
    containerMap,
    cookieStoreToNameMap,
    initialize() {
      return options.initialize ? options.initialize() : Promise.resolve();
    },
    loadContainers() {
      return options.loadContainers ? options.loadContainers() : Promise.resolve();
    },
    loadRules() {
      return options.loadRules ? options.loadRules() : Promise.resolve();
    },
    getContainerData() {
      return { containerMap, cookieStoreToNameMap };
    },
    getRules() {
      return rules;
    },
  };
  const ctcConsole = Object.fromEntries(
    ['debug', 'info', 'log', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push({ level, args }),
    ]),
  );
  const context = vm.createContext({
    browser,
    CtcRepo,
    ctcConsole,
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
  });
  const sourcePath = (name) => path.join(__dirname, '..', 'src', name);
  for (const name of ['pattern-matching.js', 'rule-engine.js', 'background.js']) {
    vm.runInContext(fs.readFileSync(sourcePath(name), 'utf8'), context, {
      filename: sourcePath(name),
    });
  }

  return {
    browser,
    CtcRepo,
    containerMap,
    cookieStoreToNameMap,
    createCalls,
    listeners,
    logs,
    removeCalls,
    timers,
    request(details) {
      return listeners.beforeRequest(details);
    },
    removeSourceTab(tabId) {
      for (const listener of listeners.tabRemoved) listener(tabId);
    },
    updateIdentity(identity) {
      for (const listener of listeners.identityUpdated) listener(identity);
    },
  };
}

async function flushMicrotasks(count = 8) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}

module.exports = { createBackgroundHarness, deferred, flushMicrotasks };
