const assert = require('node:assert/strict');
const { createBackgroundHarness, deferred, flushMicrotasks } = require('./browser-stub');

const tests = [];
function assertEmpty(value) {
  assert.equal(Object.keys(value).length, 0);
}
function test(name, run) {
  tests.push({ name, run });
}

test('independent tabs route the same URL without sharing authorization', async () => {
  const harness = createBackgroundHarness();
  const results = await Promise.all([
    harness.request({ tabId: 1, url: 'https://work.example/a', method: 'GET' }),
    harness.request({ tabId: 2, url: 'https://work.example/a', method: 'GET' }),
  ]);

  assert.equal(harness.createCalls.length, 2);
  assert.deepEqual(results.map((result) => result.cancel), [true, true]);
  assert.deepEqual(harness.removeCalls, [1, 2]);
});

test('different URLs in one container pair route independently', async () => {
  const harness = createBackgroundHarness();
  const results = await Promise.all([
    harness.request({ tabId: 1, url: 'https://work.example/a', method: 'GET' }),
    harness.request({ tabId: 2, url: 'https://work.example/b', method: 'GET' }),
  ]);

  assert.equal(harness.createCalls.length, 2);
  assert.deepEqual(results.map((result) => result.cancel), [true, true]);
});

test('a cross-container redirect cycle stops after a bounded replacement chain', async () => {
  const stores = new Map([[1, 'work-id']]);
  const harness = createBackgroundHarness({
    rules: [
      { containerName: 'Work', action: 'open', urlPattern: 'work.example' },
      { containerName: 'Personal', action: 'open', urlPattern: 'personal.example' },
    ],
    getTab(tabId) {
      return Promise.resolve({ cookieStoreId: stores.get(tabId), active: true });
    },
    createTab(options, call) {
      const id = 100 + call;
      stores.set(id, options.cookieStoreId);
      return Promise.resolve({ id });
    },
  });
  let tabId = 1;
  let result;

  for (let requestCount = 0; requestCount < 12; requestCount += 1) {
    const sourceTabId = tabId;
    const currentStore = stores.get(tabId);
    const url = currentStore === 'work-id'
      ? 'https://personal.example/redirect'
      : 'https://work.example/redirect';
    result = await harness.request({ tabId, url, method: 'GET' });
    if (!result.cancel) break;

    tabId = 100 + harness.createCalls.length;
    harness.removeSourceTab(sourceTabId);
  }

  assert.equal(harness.createCalls.length <= 5, true, 'redirect chain must stop after a small hop limit');
  assert.equal(Object.keys(result).length, 0, 'the over-limit request must stay in its current tab');
  assert.equal(harness.logs.some(({ level, args }) =>
    level === 'warn' && args.some((message) => String(message).includes('redirect chain'))), true);
});


test('failed tab creation does not suppress a same-tab retry', async () => {
  const harness = createBackgroundHarness({
    createTab(_details, call) {
      return call === 1
        ? Promise.reject(new Error('temporary create failure'))
        : Promise.resolve({ id: 102 });
    },
  });
  const request = { tabId: 1, url: 'https://work.example/retry', method: 'GET' };

  assertEmpty(await harness.request(request));
  assert.equal((await harness.request(request)).cancel, true);
  assert.equal(harness.createCalls.length, 2);
});

test('a source tab that closes during lookup creates no replacement', async () => {
  const lookup = deferred();
  const harness = createBackgroundHarness({ getTab: () => lookup.promise });
  const pending = harness.request({ tabId: 7, url: 'https://work.example/lookup', method: 'GET' });
  await flushMicrotasks();
  harness.removeSourceTab(7);
  lookup.reject(new Error('tab closed'));

  assertEmpty(await pending);
  assert.equal(harness.createCalls.length, 0);
  assert.deepEqual(harness.removeCalls, []);
});

test('a source tab that closes during creation removes the replacement', async () => {
  const creation = deferred();
  const harness = createBackgroundHarness({ createTab: () => creation.promise });
  const pending = harness.request({ tabId: 8, url: 'https://work.example/create', method: 'GET' });
  await flushMicrotasks();
  assert.equal(harness.createCalls.length, 1);

  harness.removeSourceTab(8);
  creation.resolve({ id: 88 });

  assertEmpty(await pending);
  assert.deepEqual(harness.removeCalls, [88]);
});

test('a rejected source removal fails open and cleans up the replacement', async () => {
  const harness = createBackgroundHarness({
    removeTab(tabId) {
      return tabId === 9
        ? Promise.reject(new Error('source removal failed'))
        : Promise.resolve();
    },
  });

  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const result = await harness.request({
    tabId: 9,
    url: 'https://work.example/remove',
    method: 'GET',
  });
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandled);
  assertEmpty(result);
  assert.equal(unhandled.length, 0);
  assert.deepEqual(harness.removeCalls, [9, 100]);
});

async function run() {
  let failed = 0;
  for (const { name, run: runTest } of tests) {
    try {
      await runTest();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}: ${error.stack || error}`);
    }
  }
  console.log(`${tests.length - failed}/${tests.length} background ISSUE-1 tests passed`);
  if (failed) process.exitCode = 1;
}

run();
