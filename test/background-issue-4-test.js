const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { flushMicrotasks } = require('./browser-stub');

function createHarness({ identities = [], rules = [], tab = {} } = {}) {
  const listeners = {
    beforeRequest: null,
    identityCreated: [],
    identityRemoved: [],
    identityUpdated: [],
    tabRemoved: [],
    storageChanged: [],
  };
  const createdTabs = [];
  const removedTabs = [];
  const logs = [];
  let currentIdentities = identities;
  const browser = {
    webRequest: { onBeforeRequest: { addListener(listener) { listeners.beforeRequest = listener; } } },
    storage: {
      onChanged: { addListener(listener) { listeners.storageChanged.push(listener); } },
      sync: { get: () => Promise.resolve({ ctcRules: rules }) },
    },
    contextualIdentities: {
      query: () => Promise.resolve(currentIdentities),
      onCreated: { addListener(listener) { listeners.identityCreated.push(listener); } },
      onRemoved: { addListener(listener) { listeners.identityRemoved.push(listener); } },
      onUpdated: { addListener(listener) { listeners.identityUpdated.push(listener); } },
    },
    tabs: {
      onRemoved: { addListener(listener) { listeners.tabRemoved.push(listener); } },
      get: () => Promise.resolve({ cookieStoreId: 'firefox-default', active: true, ...tab }),
      create(options) {
        createdTabs.push(options);
        return Promise.resolve({ id: 90 + createdTabs.length });
      },
      remove(tabId) {
        removedTabs.push(tabId);
        return Promise.resolve();
      },
    },
  };
  const context = vm.createContext({
    browser,
    decodeRulesFromStorage: async (storedRules) => storedRules,
    ctcConsole: Object.fromEntries(
      ['debug', 'info', 'log', 'warn', 'error'].map((level) => [
        level,
        (...args) => logs.push({ level, args }),
      ]),
    ),
    setTimeout: () => 1,
  });
  const sourcePath = (name) => path.join(__dirname, '..', 'src', name);
  for (const name of ['pattern-matching.js', 'rule-engine.js', 'ctc-repository.js', 'background.js']) {
    vm.runInContext(fs.readFileSync(sourcePath(name), 'utf8'), context, {
      filename: sourcePath(name),
    });
  }

  return {
    context,
    createdTabs,
    listeners,
    removedTabs,
    setIdentities(value) { currentIdentities = value; },
    request(details) { return listeners.beforeRequest({ method: 'GET', ...details }); },
  };
}

async function initialize(harness) {
  await harness.context.CtcRepo.initialize();
  await flushMicrotasks(12);
}

async function testRemovedCandidateFallsThroughToLiveContainer() {
  const harness = createHarness({
    identities: [{ name: 'Work', cookieStoreId: 'work-id' }],
    rules: [
      { containerName: 'Removed', action: 'open', urlPattern: 'shared.example' },
      { containerName: 'Work', action: 'open', urlPattern: 'shared.example' },
    ],
  });
  await initialize(harness);

  await harness.request({ url: 'https://shared.example/page', tabId: 1 });

  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].cookieStoreId, 'work-id');
}

async function testDuplicateNameKeepsExistingStore() {
  const harness = createHarness({
    identities: [
      { name: 'Work', cookieStoreId: 'work-first' },
      { name: 'Work', cookieStoreId: 'work-second' },
    ],
    rules: [{ containerName: 'Work', action: 'open', urlPattern: 'shared.example' }],
    tab: { cookieStoreId: 'work-first' },
  });
  await initialize(harness);

  const result = await harness.request({ url: 'https://shared.example/page', tabId: 1 });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {});
  assert.equal(harness.createdTabs.length, 0);
  assert.equal(harness.removedTabs.length, 0);
}

async function testIdentityRenameRefreshesRepositoryMaps() {
  const harness = createHarness({
    identities: [{ name: 'Old Name', cookieStoreId: 'work-id' }],
  });
  await initialize(harness);
  harness.setIdentities([{ name: 'New Name', cookieStoreId: 'work-id' }]);

  for (const listener of harness.listeners.identityUpdated) listener({ cookieStoreId: 'work-id' });
  await flushMicrotasks(12);

  assert.equal(harness.context.CtcRepo.containerMap.has('Old Name'), false);
  assert.equal(harness.context.CtcRepo.containerMap.get('New Name'), 'work-id');
}

async function testReservedDefaultNameCannotReplaceDefaultStore() {
  const harness = createHarness({
    identities: [{ name: 'No Container', cookieStoreId: 'custom-default-name-id' }],
  });
  await initialize(harness);

  assert.equal(harness.context.CtcRepo.containerMap.get('No Container'), 'firefox-default');
}

async function main() {
  const tests = [
    ['removed candidate falls through to live container', testRemovedCandidateFallsThroughToLiveContainer],
    ['duplicate name keeps existing store', testDuplicateNameKeepsExistingStore],
    ['identity rename refreshes repository maps', testIdentityRenameRefreshesRepositoryMaps],
    ['reserved default name cannot replace default store', testReservedDefaultNameCannotReplaceDefaultStore],
  ];
  let failures = 0;
  for (const [name, test] of tests) {
    try {
      await test();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
  if (failures > 0) process.exitCode = 1;
  else console.log(`${tests.length}/${tests.length} ISSUE-4 tests passed`);
}

main();
