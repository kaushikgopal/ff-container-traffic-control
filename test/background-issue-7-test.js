const assert = require('node:assert/strict');
const { createBackgroundHarness, deferred, flushMicrotasks } = require('./browser-stub');

async function testFailedStartupRetriesOnceForConcurrentRequests() {
  const retry = deferred();
  let attempts = 0;
  const harness = createBackgroundHarness({
    initialize() {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('initial load failed'));
      return retry.promise;
    },
  });
  await flushMicrotasks(12);
  assert.equal(attempts, 1);

  const requests = [
    harness.request({ url: 'https://work.example/one', tabId: 1 }),
    harness.request({ url: 'https://work.example/two', tabId: 2 }),
  ];
  await flushMicrotasks(12);
  const retryCount = attempts;
  retry.resolve();
  await Promise.all(requests);

  assert.equal(retryCount, 2, 'concurrent navigations must share one retry');
  assert.equal(harness.createCalls.length, 2, 'the successful retry must restore routing');
  assert.deepEqual(harness.createCalls.map(({ cookieStoreId }) => cookieStoreId), ['work-id', 'work-id']);
}

async function testDelayedInitializationKeeps500MillisecondFailOpen() {
  const pendingInitialization = deferred();
  const harness = createBackgroundHarness({ initialize: () => pendingInitialization.promise });
  harness.containerMap.clear();

  const request = harness.request({ url: 'https://work.example/page', tabId: 1 });
  await flushMicrotasks(8);
  assert.equal(harness.timers[0].delay, 500);
  harness.timers[0].callback();

  const result = await request;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {});
  assert.equal(harness.createCalls.length, 0);
}

async function main() {
  const tests = [
    ['failed startup retries once for concurrent requests', testFailedStartupRetriesOnceForConcurrentRequests],
    ['delayed initialization keeps the 500ms fail-open', testDelayedInitializationKeeps500MillisecondFailOpen],
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
  else console.log(`${tests.length}/${tests.length} ISSUE-7 tests passed`);
}

main();
