const assert = require('assert');
const { createOptionsHarness, deferred } = require('./options-stub');

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

test('ISSUE-5 unchanged grouped save preserves rule precedence and ignores property order', async () => {
  const rules = JSON.parse('[{"containerName":"A","action":"open","urlPattern":"other.test","highPriority":false},{"urlPattern":"shared.test","highPriority":false,"action":"open","containerName":"B"},{"action":"open","containerName":"A","highPriority":false,"urlPattern":"shared.test"}]');
  const harness = createOptionsHarness({ containers: [{ name: 'A' }, { name: 'B' }], rules });
  const collected = harness.options.collectRulesFromTable();
  harness.context.rulesUnderTest = collected;
  assert.strictEqual(harness.evaluate('evaluateContainerForUrl("shared.test", "No Container", rulesUnderTest, new Map([["A", 1], ["B", 2]]))'), 'B');
  harness.options.exportRules();
  assert.strictEqual(harness.elements.exportOutput.style.display, 'block');
  await harness.options.saveRulesFromUi();
  assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.storageData.ctcRules)), rules);
});

test('ISSUE-6 prevents overlapping Save and Import commits', async () => {
  const firstEncode = deferred();
  let encodeCalls = 0;
  const initialRule = { containerName: 'Work', action: 'open', urlPattern: 'old.test', highPriority: false };
  const harness = createOptionsHarness({
    rules: [initialRule],
    encode: rules => {
      encodeCalls++;
      return encodeCalls === 1 ? firstEncode.promise : Promise.resolve(rules);
    },
  });
  harness.elements.rulesTableBody.querySelector('.url-pattern-input').value = 'saved.test';
  const savePromise = harness.options.saveRulesFromUi();
  harness.elements.importJsonInput.value = JSON.stringify([{ ...initialRule, urlPattern: 'imported.test' }]);
  await harness.options.saveRulesFromImport();
  assert.strictEqual(encodeCalls, 1);
  assert.strictEqual(harness.writes.length, 0);
  firstEncode.resolve([{ ...initialRule, urlPattern: 'saved.test' }]);
  await savePromise;
  assert.strictEqual(harness.storageData.ctcRules[0].urlPattern, 'saved.test');
  assert.strictEqual(harness.elements.importJsonInput.value.includes('imported.test'), true);
  await harness.options.saveRulesFromImport();
  assert.strictEqual(harness.storageData.ctcRules[0].urlPattern, 'imported.test');
  assert.strictEqual(harness.elements.importJsonInput.value, '');
});

test('ISSUE-6 prevents overlapping Save operations from committing an older snapshot last', async () => {
  const firstEncode = deferred();
  let encodeCalls = 0;
  const rule = { containerName: 'Work', action: 'open', urlPattern: 'old.test', highPriority: false };
  const harness = createOptionsHarness({
    rules: [rule],
    encode: rules => {
      encodeCalls++;
      return encodeCalls === 1 ? firstEncode.promise : Promise.resolve(rules);
    },
  });
  const input = harness.elements.rulesTableBody.querySelector('.url-pattern-input');
  input.value = 'first.test';
  const firstSave = harness.options.saveRulesFromUi();
  input.value = 'second.test';
  await harness.options.saveRulesFromUi();
  assert.strictEqual(encodeCalls, 1);
  firstEncode.resolve([{ ...rule, urlPattern: 'first.test' }]);
  await firstSave;
  assert.strictEqual(harness.storageData.ctcRules[0].urlPattern, 'first.test');
  assert.strictEqual(input.value, 'second.test');
  await harness.options.saveRulesFromUi();
  assert.strictEqual(harness.storageData.ctcRules[0].urlPattern, 'second.test');
});

test('ISSUE-6 retains a failed draft and allows a deliberate retry', async () => {
  let failWrite = true;
  const rule = { containerName: 'Work', action: 'open', urlPattern: 'saved.test', highPriority: false };
  const harness = createOptionsHarness({
    rules: [{ ...rule, urlPattern: 'old.test' }],
    write: async () => {
      if (failWrite) throw new Error('storage unavailable');
    },
  });
  harness.elements.rulesTableBody.querySelector('.url-pattern-input').value = rule.urlPattern;
  await harness.options.saveRulesFromUi();
  assert.strictEqual(harness.storageData.ctcRules[0].urlPattern, 'old.test');
  assert.strictEqual(harness.options.rules[0].urlPattern, 'old.test');
  failWrite = false;
  await harness.options.saveRulesFromUi();
  assert.strictEqual(harness.storageData.ctcRules[0].urlPattern, 'saved.test');
});

test('ISSUE-9 saves and reloads an intentional empty rule set', async () => {
  const harness = createOptionsHarness({ rules: [{ containerName: 'Work', action: 'open', urlPattern: 'old.test', highPriority: false }] });
  harness.elements.rulesTableBody.querySelector('.container-type-select').value = 'no-rule';
  await harness.options.saveRulesFromUi();
  await harness.options.saveRulesFromUi();
  assert.strictEqual(harness.writes.length, 2);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.storageData.ctcRules)), []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.options.rules)), []);
  const reloaded = createOptionsHarness({ rules: harness.storageData.ctcRules });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(reloaded.options.rules)), []);
});

test('ISSUE-10 accepts literal metacharacters and valid wrapped regular expressions', async () => {
  const harness = createOptionsHarness();
  const rules = [
    { containerName: 'Work', action: 'open', urlPattern: 'foo[', highPriority: false },
    { containerName: 'Work', action: 'open', urlPattern: '/foo\\.test/', highPriority: false },
  ];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(harness.options.validateAllRules(rules).errors)), []);
  assert.strictEqual(harness.evaluate('matchesPattern("https://foo[.example/", "foo[")'), true);
  assert.strictEqual(harness.evaluate('matchesPattern("https://foo.test/", "/foo\\\\.test/")'), true);
  harness.elements.importJsonInput.value = JSON.stringify(rules);
  await harness.options.saveRulesFromImport();
  assert.strictEqual(harness.writes.length, 1);
  assert.strictEqual(harness.storageData.ctcRules[0].urlPattern, 'foo[');
  assert.strictEqual(harness.storageData.ctcRules[1].urlPattern, '/foo\\.test/');
});

test('ISSUE-10 rejects an invalid wrapped regular expression on Save and Import', async () => {
  const invalidPattern = '/' + '\\' + '/';
  const harness = createOptionsHarness();
  const typeSelect = harness.elements.rulesTableBody.querySelector('.container-type-select');
  typeSelect.value = 'open';
  harness.options.handleContainerTypeChange(typeSelect);
  harness.elements.rulesTableBody.querySelector('.url-pattern-input').value = invalidPattern;
  await harness.options.saveRulesFromUi();
  assert.strictEqual(harness.writes.length, 0);
  harness.elements.importJsonInput.value = JSON.stringify([{
    containerName: 'Work', action: 'open', urlPattern: invalidPattern, highPriority: false,
  }]);
  await harness.options.saveRulesFromImport();
  assert.strictEqual(harness.writes.length, 0);
});

test('ISSUE-12 initial preference read updates the checkbox and local flag', async () => {
  const initialRead = deferred();
  const harness = createOptionsHarness({ debugRead: initialRead });
  initialRead.resolve({ ctcDebugLoggingEnabled: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(harness.elements.debugLoggingCheckbox.checked, true);
  assert.strictEqual(harness.evaluate('isDebugLoggingEnabled()'), true);
});

test('ISSUE-12 preference changes override delayed reads and failed toggles restore committed state', async () => {
  const initialRead = deferred();
  let failWrite = false;
  const harness = createOptionsHarness({
    debugRead: initialRead,
    write: async () => {
      if (failWrite) throw new Error('storage unavailable');
    },
  });
  harness.changeStorage({ ctcDebugLoggingEnabled: true });
  initialRead.resolve({ ctcDebugLoggingEnabled: false });
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(harness.elements.debugLoggingCheckbox.checked, true);
  assert.strictEqual(harness.evaluate('isDebugLoggingEnabled()'), true);
  assert.strictEqual(harness.storageData.ctcDebugLoggingEnabled, true);
  harness.elements.debugLoggingCheckbox.checked = false;
  failWrite = true;
  await harness.options.handleDebugLoggingToggle();
  assert.strictEqual(harness.elements.debugLoggingCheckbox.checked, true);
  assert.strictEqual(harness.evaluate('isDebugLoggingEnabled()'), true);
  assert.strictEqual(harness.storageData.ctcDebugLoggingEnabled, true);
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
