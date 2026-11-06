const assert = require('assert');
const { createOptionsHarness } = require('./options-stub');

const tests = [];
function test(name, run) {
  tests.push({ name, run });
}

test('ISSUE-3 rejects malformed imports without replacing committed rules', async () => {
  const savedRules = [{ containerName: 'Work', action: 'open', urlPattern: 'work.test' }];
  const harness = createOptionsHarness({ rules: savedRules });
  harness.elements.importJsonInput.value = JSON.stringify([{}]);

  await harness.options.saveRulesFromImport();

  assert.strictEqual(harness.writes.length, 0);
  assert.strictEqual(harness.options.rules, savedRules);
  assert.strictEqual(harness.storageData.ctcRules, savedRules);
});

test('ISSUE-3 supports prototype-like container names and URL patterns', () => {
  const specialRules = [
    { containerName: '__proto__', action: 'open', urlPattern: '__proto__', highPriority: true },
    { containerName: 'constructor', action: 'open', urlPattern: 'constructor', highPriority: true },
  ];
  const harness = createOptionsHarness({
    containers: [{ name: '__proto__' }, { name: 'constructor' }],
    rules: specialRules,
  });

  assert.strictEqual(harness.elements.rulesTableBody.querySelectorAll('.container-group').length, 2);
  assert.doesNotThrow(() => harness.options.validateAllRules(specialRules));
  assert.strictEqual(harness.evaluate('Object.prototype.open'), undefined);
});

test('ISSUE-3 preserves imported records without legacy highPriority', async () => {
  const legacyRule = { containerName: 'Work', action: 'open', urlPattern: 'work.test' };
  const harness = createOptionsHarness();
  harness.elements.importJsonInput.value = JSON.stringify([legacyRule]);

  await harness.options.saveRulesFromImport();

  assert.strictEqual(harness.writes.length, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(harness.storageData.ctcRules[0], 'highPriority'), false);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}`);
      console.error(error.stack || error);
    }
  }
  if (failures > 0) process.exitCode = 1;
})();
