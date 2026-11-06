const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createBackgroundHarness, deferred, flushMicrotasks } = require('./browser-stub');

function createRepositoryHarness(options = {}) {
  const browser = {
    contextualIdentities: { query: () => Promise.resolve([]) },
    storage: {
      sync: {
        get: (...args) => options.getStorage(...args),
      },
    },
  };
  const context = vm.createContext({
    browser,
    decodeRulesFromStorage: (value) => options.decode(value),
    ctcConsole: Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map((level) => [level, () => {}]),
    ),
  });
  const sourcePath = path.join(__dirname, '..', 'src', 'ctc-repository.js');
  vm.runInContext(fs.readFileSync(sourcePath, 'utf8'), context, {
    filename: sourcePath,
  });
  return { CtcRepo: context.CtcRepo };
}

async function testReloadDuringDecodeReadsLatestRules() {
  const firstDecode = deferred();
  let storedRules = 'R1';
  let storageReads = 0;
  const harness = createRepositoryHarness({
    getStorage: () => {
      storageReads += 1;
      return Promise.resolve({ ctcRules: storedRules });
    },
    decode: (value) => (value === 'R1' ? firstDecode.promise : Promise.resolve([{ urlPattern: value }])),
  });

  const firstLoad = harness.CtcRepo.loadRules();
  await flushMicrotasks();
  storedRules = 'R2';
  const invalidatedLoad = harness.CtcRepo.loadRules();
  firstDecode.resolve([{ urlPattern: 'R1' }]);
  await Promise.all([firstLoad, invalidatedLoad]);

  assert.equal(storageReads, 2, 'a reload request during decode must start a second storage read');
  assert.equal(harness.CtcRepo.getRules()[0].urlPattern, 'R2');
}

async function testFailedRuleLoadCanRecover() {
  let shouldFail = true;
  const harness = createRepositoryHarness({
    getStorage: () => {
      if (shouldFail) return Promise.reject(new Error('storage unavailable'));
      return Promise.resolve({ ctcRules: 'recovered' });
    },
    decode: (value) => Promise.resolve([{ urlPattern: value }]),
  });

  await assert.rejects(harness.CtcRepo.loadRules(), /storage unavailable/);
  shouldFail = false;
  await harness.CtcRepo.loadRules();

  assert.equal(harness.CtcRepo.getRules()[0].urlPattern, 'recovered');
}

async function testStorageListenerHandlesReloadFailure() {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const harness = createBackgroundHarness({
      loadRules: () => Promise.reject(new Error('reload failed')),
    });
    for (const listener of harness.listeners.storageChanged) {
      listener({ ctcRules: { newValue: 'changed' } }, 'sync');
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(unhandled.length, 0, 'the storage listener must handle a rejected reload');
    assert.ok(harness.logs.some(({ level, args }) => level === 'error' && args.some((value) => value?.message === 'reload failed')));
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

async function main() {
  const tests = [
    ['reload during decode reads latest rules', testReloadDuringDecodeReadsLatestRules],
    ['failed rule load can recover', testFailedRuleLoadCanRecover],
    ['storage listener handles reload failure', testStorageListenerHandlesReloadFailure],
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
  else console.log(`${tests.length}/${tests.length} ISSUE-2 tests passed`);
}

main();
