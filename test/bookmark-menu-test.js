const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/bookmark-menu.js", "utf8");
const PARENT_ID = "ctc-open-all-in-container";

function createDeferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createBrowser() {
  const menus = new Map();
  const listeners = {
    onShown: [],
    onClicked: [],
    onCreated: [],
    onRemoved: [],
    onUpdated: []
  };
  const failures = new Set();
  const logs = [];
  let containers = [];
  let nextQuery = null;

  function removeTree(id) {
    for (const [childId, item] of menus) {
      if (item.parentId === id) {
        removeTree(childId);
      }
    }
    menus.delete(id);
  }

  const browser = {
    runtime: {},
    menus: {
      create(item, callback) {
        let error = null;
        if (menus.has(item.id)) {
          error = { message: `Duplicate menu ID: ${item.id}` };
        } else if (item.parentId && !menus.has(item.parentId)) {
          error = { message: `Missing parent menu: ${item.parentId}` };
        } else if (failures.has(item.id)) {
          error = { message: `Rejected menu ID: ${item.id}` };
        } else {
          menus.set(item.id, { ...item });
        }

        if (callback) {
          queueMicrotask(() => {
            browser.runtime.lastError = error;
            callback();
            browser.runtime.lastError = undefined;
          });
        }
        return item.id;
      },
      remove(id) {
        if (!menus.has(id)) {
          return Promise.reject(new Error(`Unknown menu ID: ${id}`));
        }
        removeTree(id);
        return Promise.resolve();
      },
      update() {
        return Promise.resolve();
      },
      refresh() {},
      onShown: { addListener(listener) { listeners.onShown.push(listener); } },
      onClicked: { addListener(listener) { listeners.onClicked.push(listener); } }
    },
    bookmarks: {
      get: async () => [],
      getChildren: async () => []
    },
    contextualIdentities: {
      query() {
        if (nextQuery) {
          const pending = nextQuery;
          nextQuery = null;
          return pending.promise;
        }
        return Promise.resolve(containers.slice());
      },
      onCreated: { addListener(listener) { listeners.onCreated.push(listener); } },
      onRemoved: { addListener(listener) { listeners.onRemoved.push(listener); } },
      onUpdated: { addListener(listener) { listeners.onUpdated.push(listener); } }
    },
    tabs: { create: async () => ({}) }
  };

  return {
    browser,
    menus,
    listeners,
    failures,
    logs,
    setContainers(value) { containers = value.slice(); },
    deferNextQuery() {
      nextQuery = createDeferred();
      const deferred = nextQuery;
      const snapshot = containers.slice();
      return {
        promise: deferred.promise,
        resolve() { deferred.resolve(snapshot); }
      };
    }
  };
}

function loadContext(shared) {
  const context = vm.createContext({
    browser: shared.browser,
    ctcConsole: {
      error: (...args) => shared.logs.push(args),
      info: (...args) => shared.logs.push(args),
      log: (...args) => shared.logs.push(args)
    }
  });
  vm.runInContext(source, context, { filename: "src/bookmark-menu.js" });
  return context;
}

async function drainTasks() {
  for (let i = 0; i < 8; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function ownedMenuIds(menus) {
  return [...menus.entries()]
    .filter(([id, item]) => id === PARENT_ID || item.parentId === PARENT_ID)
    .map(([id]) => id)
    .sort();
}

async function testStartupRemovesPersistedItemsForDeletedIdentities() {
  const shared = createBrowser();
  shared.setContainers([
    { cookieStoreId: "firefox-container-1", name: "Work" },
    { cookieStoreId: "firefox-container-2", name: "Removed" }
  ]);
  loadContext(shared);
  await drainTasks();
  assert.equal(shared.menus.has("firefox-container-2"), true);

  // Firefox keeps menu state after the event page stops. The next context sees only live identities.
  shared.setContainers([{ cookieStoreId: "firefox-container-1", name: "Work" }]);
  loadContext(shared);
  await drainTasks();

  assert.deepEqual(ownedMenuIds(shared.menus), [
    "ctc-no-container",
    "ctc-open-all-in-container",
    "ctc-separator",
    "firefox-container-1"
  ]);
}

async function testOverlappingIdentityEventsUseLatestSnapshot() {
  const shared = createBrowser();
  shared.setContainers([{ cookieStoreId: "firefox-container-1", name: "Old" }]);
  const context = loadContext(shared);
  await drainTasks();

  const delayedQuery = shared.deferNextQuery();
  const update = shared.listeners.onUpdated[0]();
  await drainTasks();

  shared.setContainers([{ cookieStoreId: "firefox-container-2", name: "Current" }]);
  const created = shared.listeners.onCreated[0]();
  const removed = shared.listeners.onRemoved[0]();
  await drainTasks();
  delayedQuery.resolve();
  await Promise.all([update, created, removed]);
  await drainTasks();

  assert.deepEqual(ownedMenuIds(shared.menus), [
    "ctc-no-container",
    "ctc-open-all-in-container",
    "ctc-separator",
    "firefox-container-2"
  ]);
  assert.equal(shared.menus.get("firefox-container-2").title, "Current");
  assert.equal(vm.runInContext("containerMenuIds.length", context), 1);
}

async function testCreateCallbackErrorsDoNotRecordFailedChildren() {
  const shared = createBrowser();
  shared.setContainers([
    { cookieStoreId: "firefox-container-1", name: "Work" },
    { cookieStoreId: "firefox-container-failed", name: "Unavailable" }
  ]);
  shared.failures.add("firefox-container-failed");
  const context = loadContext(shared);
  await drainTasks();

  assert.equal(shared.menus.has("firefox-container-failed"), false);
  assert.equal(vm.runInContext("containerMenuIds.includes('firefox-container-1')", context), true);
  assert.equal(vm.runInContext("containerMenuIds.includes('firefox-container-failed')", context), false);
  assert.equal(shared.logs.some((entry) => entry[0] === "Failed to populate container menu:"), true);
}

async function main() {
  const tests = [
    ["startup removes persisted items for deleted identities", testStartupRemovesPersistedItemsForDeletedIdentities],
    ["overlapping identity events use the latest snapshot", testOverlappingIdentityEventsUseLatestSnapshot],
    ["create callback errors do not record failed children", testCreateCallbackErrorsDoNotRecordFailedChildren]
  ];

  for (const [name, test] of tests) {
    await test();
    console.log(`PASS ${name}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
