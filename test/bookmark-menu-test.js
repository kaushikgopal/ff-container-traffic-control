const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("src/bookmark-menu.js", "utf8");
const PARENT_ID = "ctc-open-all-in-container";

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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
  const updateCalls = [];
  let refreshCalls = 0;
  let containers = [];
  let nextQuery = null;
  let nextUpdate = null;
  let nextRefresh = null;

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
      update(id, properties) {
        updateCalls.push({ id, ...properties });
        if (nextUpdate) {
          const pending = nextUpdate;
          nextUpdate = null;
          return pending.promise;
        }
        return Promise.resolve();
      },
      refresh() {
        refreshCalls += 1;
        if (nextRefresh) {
          const pending = nextRefresh;
          nextRefresh = null;
          return pending.promise;
        }
        return Promise.resolve();
      },
      onShown: { addListener(listener) { listeners.onShown.push(listener); } },
      onClicked: { addListener(listener) { listeners.onClicked.push(listener); } }
    },
    bookmarks: {
      get: async (id) => [{ id, title: "Folder" }],
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
    updateCalls,
    get refreshCalls() { return refreshCalls; },
    setContainers(value) { containers = value.slice(); },
    deferNextQuery() {
      nextQuery = createDeferred();
      const deferred = nextQuery;
      const snapshot = containers.slice();
      return {
        promise: deferred.promise,
        resolve() { deferred.resolve(snapshot); }
      };
    },
    deferNextMenuUpdate() {
      nextUpdate = createDeferred();
      return nextUpdate;
    },
    deferNextMenuRefresh() {
      nextRefresh = createDeferred();
      return nextRefresh;
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

async function testOnShownWaitsForRebuildAndMenuUpdates() {
  const shared = createBrowser();
  shared.setContainers([{ cookieStoreId: "firefox-container-1", name: "Old" }]);
  loadContext(shared);
  await drainTasks();

  const delayedQuery = shared.deferNextQuery();
  const rebuild = shared.listeners.onUpdated[0]();
  await drainTasks();
  const delayedUpdate = shared.deferNextMenuUpdate();
  const delayedRefresh = shared.deferNextMenuRefresh();
  const shown = shared.listeners.onShown[0]({
    contexts: ["bookmark"],
    bookmarkId: "folder"
  });
  let shownSettled = false;
  shown.then(() => { shownSettled = true; });
  await drainTasks();

  assert.equal(shownSettled, false);
  assert.equal(shared.updateCalls.length, 0);
  delayedQuery.resolve();
  await drainTasks();
  assert.equal(shared.updateCalls.length, 1);
  assert.equal(shared.refreshCalls, 0);
  assert.equal(shownSettled, false);
  delayedUpdate.resolve();
  await drainTasks();
  assert.equal(shared.refreshCalls, 1);
  assert.equal(shownSettled, false);
  delayedRefresh.resolve();
  await Promise.all([rebuild, shown]);

  assert.deepEqual(shared.updateCalls[0], { id: PARENT_ID, visible: true });
  assert.equal(shownSettled, true);
}

async function testOnShownHandlesMenuUpdateFailure() {
  const shared = createBrowser();
  shared.setContainers([{ cookieStoreId: "firefox-container-1", name: "Work" }]);
  loadContext(shared);
  await drainTasks();
  const delayedUpdate = shared.deferNextMenuUpdate();
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on("unhandledRejection", onUnhandled);

  const shown = shared.listeners.onShown[0]({
    contexts: ["bookmark"],
    bookmarkId: "folder"
  });
  await drainTasks();
  delayedUpdate.reject(new Error("menu update failed"));
  await shown;
  await new Promise((resolve) => setImmediate(resolve));
  process.off("unhandledRejection", onUnhandled);

  assert.equal(unhandled.length, 0);
  assert.equal(shared.logs.some((entry) =>
    entry[0] === "Failed to update bookmark menu visibility:"), true);
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
    ["onShown waits for rebuild and menu updates", testOnShownWaitsForRebuildAndMenuUpdates],
    ["onShown handles menu update failure", testOnShownHandlesMenuUpdateFailure],
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
