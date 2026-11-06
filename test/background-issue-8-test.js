const assert = require('node:assert/strict');
const { createBackgroundHarness, flushMicrotasks } = require('./browser-stub');

async function testPostSwitchContinuesInSourceTab() {
  const harness = createBackgroundHarness();
  await flushMicrotasks();

  const result = await harness.request({
    url: 'https://work.example/submit',
    method: 'POST',
    type: 'main_frame',
    tabId: 1,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {});
  assert.equal(harness.createCalls.length, 0, 'POST must not create a URL-only replacement');
  assert.equal(harness.removeCalls.length, 0, 'POST must not remove the source tab');
  assert.equal(
    harness.logs.some(({ level, args }) => level === 'warn' && args.join(' ').includes('POST')),
    true,
    'the skipped switch must be logged with ctcConsole',
  );
}

async function testGetSwitchStillCreatesReplacement() {
  const harness = createBackgroundHarness();
  await flushMicrotasks();

  const result = await harness.request({
    url: 'https://work.example/page',
    method: 'GET',
    type: 'main_frame',
    tabId: 1,
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { cancel: true });
  assert.equal(harness.createCalls.length, 1);
  assert.deepEqual(harness.removeCalls, [1]);
}

async function main() {
  const tests = [
    ['POST switch continues in source tab', testPostSwitchContinuesInSourceTab],
    ['GET switch still creates replacement', testGetSwitchStillCreatesReplacement],
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
  else console.log(`${tests.length}/${tests.length} ISSUE-8 tests passed`);
}

main();
