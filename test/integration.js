#!/usr/bin/env node
/**
 * Integration Tests for Container Traffic Control
 *
 * Usage:
 *   node test/integration.js
 *
 * Requires: geckodriver, selenium-webdriver, selenium-webext-bridge
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const {
  launchBrowser, cleanupBrowser, createTestServer,
  sleep, waitForCondition, TestResults
} = require('selenium-webext-bridge');

const PROJECT_ROOT = path.join(__dirname, '..');
const EXT_ID = 'ctc@kau.sh';

function buildExtension() {
  console.log('Building extension...');
  execSync('npx web-ext build --overwrite-dest', {
    cwd: PROJECT_ROOT,
    stdio: 'pipe'
  });
  const artifactsDir = path.join(PROJECT_ROOT, 'web-ext-artifacts');
  const zip = fs.readdirSync(artifactsDir).find(f => f.endsWith('.zip'));
  if (!zip) {
    throw new Error('web-ext build did not produce a .zip file');
  }
  return path.join(artifactsDir, zip);
}

async function main() {
  console.log('=== Integration Tests ===');

  const extPath = buildExtension();
  const results = new TestResults();
  const server = await createTestServer({ port: 8080 });
  let browser;

  try {
    console.log('----- Setup -----');

    // Launch Firefox.
    browser = await launchBrowser({
      extensions: [extPath]
    });
    const { driver, testBridge: bridge } = browser;

    // Get the extension's URL.
    let extBaseUrl;
    try {
      extBaseUrl = await bridge.getExtensionUrl(EXT_ID);
      if (extBaseUrl) {
        results.pass('Get Extension URL');
      } else {
        results.fail('Get Extension URL');
      }
    } catch (e) {
      results.error('Get Extension URL', e);
    }

    if (!extBaseUrl) {
      throw new Error('Could not get extension URL');
    }

    const optionsUrl = `${extBaseUrl}/src/options.html`;

    console.log('----- Options Page -----');

    await driver.get(optionsUrl);
    await sleep(2000);

    try {
      const structure = await driver.executeScript(() => {
        return {
          title: document.querySelector('h1')?.textContent,
          saveTopBtn: document.getElementById('saveRulesTopBtn') !== null,
          saveBottomBtn: document.getElementById('saveRulesBottomBtn') !== null,
          rulesTable: document.getElementById('rulesTableBody') !== null,
          debugCheckbox: document.getElementById('debugLoggingCheckbox') !== null,
          exportBtn: document.getElementById('exportBtn') !== null,
          importBtn: document.getElementById('importBtn') !== null
        };
      });

      if (structure.title === 'Container Traffic Control' &&
          structure.saveTopBtn && structure.saveBottomBtn &&
          structure.rulesTable && structure.debugCheckbox &&
          structure.exportBtn && structure.importBtn) {
        results.pass('Options page loads with expected structure');
      } else {
        results.fail('Options page loads with expected structure',
          JSON.stringify(structure));
      }
    } catch (e) {
      results.error('Options page loads with expected structure', e);
    }

    console.log('----- Container List -----');

    try {
      const containers = await driver.executeScript(() => {
        const groups = document.querySelectorAll('.container-group');
        return Array.from(groups).map(g => ({
          name: g.dataset.containerName,
          type: g.querySelector('.container-type-select').value
        }));
      });

      // Firefox has four built-in containers, plus the "no container" group.
      if (containers.length >= 4) {
        results.pass(`Lists ${containers.length} container groups`);
      } else {
        results.fail(`Lists container groups`,
          `found ${containers.length}: ${containers.map(c => c.name).join(', ')}`);
      }
    } catch (e) {
      results.error('Lists container groups', e);
    }

    console.log('----- Create Rules -----');

    // Changes "Personal" container to "Open"
    try {
      const changed = await driver.executeScript(() => {
        const groups = document.querySelectorAll('.container-group');
        for (const group of groups) {
          if (group.dataset.containerName === 'Personal') {
            const select = group.querySelector('.container-type-select');
            select.value = 'open';
            select.dispatchEvent(new Event('change'));
            return true;
          }
        }
        return false;
      });

      if (changed) {
        results.pass('Changes Personal container to "Open"');
      } else {
        results.fail('Changes Personal container to "Open"',
          'Personal container not found');
      }
    } catch (e) {
      results.error('Changes Personal container to "Open"', e);
    }

    // Validate success message after saving URL pattern rule.
    try {
      await driver.executeScript(() => {
        const groups = document.querySelectorAll('.container-group');
        for (const group of groups) {
          if (group.dataset.containerName === 'Personal') {
            const input = group.querySelector('.url-pattern-input');
            input.value = 'example.com';
            input.dispatchEvent(new Event('input'));
            break;
          }
        }
      });

      await driver.executeScript(() => {
        document.getElementById('saveRulesTopBtn').click();
      });
      await sleep(1000);

      // Check for success message.
      const message = await driver.executeScript(() => {
        const msg = document.querySelector('.validation-message');
        return msg ? { text: msg.textContent, type: msg.className } : null;
      });

      if (message && message.text.includes('saved successfully')) {
        results.pass('Success message appeared after saving rules');
      } else {
        results.fail('Success message appeared after saving rules',
          message ? message.text : 'no message');
      }
    } catch (e) {
      results.error('Success message appeared after saving rules', e);
    }

    console.log('----- Rule Persistence -----');
    try {
      // Refresh page.
      await driver.get(optionsUrl);
      await sleep(2000);

      const state = await driver.executeScript(() => {
        const groups = document.querySelectorAll('.container-group');
        for (const group of groups) {
          if (group.dataset.containerName === 'Personal') {
            const select = group.querySelector('.container-type-select');
            const input = group.querySelector('.url-pattern-input');
            return {
              type: select.value,
              pattern: input ? input.value : null
            };
          }
        }
        return null;
      });

      if (state && state.type === 'open' && state.pattern === 'example.com') {
        results.pass('Rules persists after reload');
      } else {
        results.fail('Rules persists after reload', JSON.stringify(state));
      }
    } catch (e) {
      results.error('Rules persists after reload', e);
    }

    console.log('----- Import/Export -----');

    // Clear existing rules first and import new ones.
    try {
      const importRules = JSON.stringify([
        { containerName: 'Work', action: 'open', urlPattern: 'github.com', highPriority: false },
        { containerName: 'Work', action: 'open', urlPattern: 'gitlab.com', highPriority: false },
        { containerName: 'Banking', action: 'restricted', urlPattern: 'bank.com', highPriority: true }
      ]);

      await driver.executeScript((json) => {
        document.getElementById('importJsonInput').value = json;
        document.getElementById('importBtn').click();
      }, importRules);
      await sleep(1000);

      const message = await driver.executeScript(() => {
        const msg = document.querySelector('.validation-message');
        return msg ? msg.textContent : null;
      });

      if (message && message.includes('imported successfully')) {
        results.pass('Import ruleset');
      } else {
        results.fail('Import ruleset', message || 'no message');
      }
    } catch (e) {
      results.error('Import ruleset', e);
    }

    // Verify imported ruleset appears in UI.
    try {
      const uiState = await driver.executeScript(() => {
        const result = {};
        const groups = document.querySelectorAll('.container-group');
        for (const group of groups) {
          const name = group.dataset.containerName;
          const select = group.querySelector('.container-type-select');
          const inputs = group.querySelectorAll('.url-pattern-input');
          if (select.value !== 'no-rule') {
            result[name] = {
              type: select.value,
              patterns: Array.from(inputs).map(i => i.value)
            };
          }
        }
        return result;
      });

      const workOk = uiState.Work &&
        uiState.Work.type === 'open' &&
        uiState.Work.patterns.includes('github.com') &&
        uiState.Work.patterns.includes('gitlab.com');
      const bankingOk = uiState.Banking &&
        uiState.Banking.type === 'restricted' &&
        uiState.Banking.patterns.includes('bank.com');

      if (workOk && bankingOk) {
        results.pass('Imported rules appear in UI');
      } else {
        results.fail('Imported rules appear in UI', JSON.stringify(uiState));
      }
    } catch (e) {
      results.error('Imported rules appear in UI', e);
    }

    // Verify export contains expected JSON.
    try {
      await driver.executeScript(() => {
        document.getElementById('exportBtn').click();
      });
      await sleep(500);

      const exported = await driver.executeScript(() => {
        const output = document.getElementById('exportOutput');
        return output.value;
      });

      const parsed = JSON.parse(exported);
      const hasGithub = parsed.some(r =>
        r.containerName === 'Work' && r.urlPattern === 'github.com'
      );
      const hasBank = parsed.some(r =>
        r.containerName === 'Banking' && r.urlPattern === 'bank.com'
      );

      if (parsed.length === 3 && hasGithub && hasBank) {
        results.pass('Export produces expected JSON');
      } else {
        results.fail('Export produces expected JSON',
          `${parsed.length} rules: ${JSON.stringify(parsed)}`);
      }
    } catch (e) {
      results.error('Export produces expected JSON', e);
    }

    console.log('----- Clear Container -----');

    try {
      await driver.executeScript(() => {
        const groups = document.querySelectorAll('.container-group');
        for (const group of groups) {
          if (group.dataset.containerName === 'Work') {
            group.querySelector('.clear-btn').click();
            break;
          }
        }
      });
      await sleep(500);

      const state = await driver.executeScript(() => {
        const groups = document.querySelectorAll('.container-group');
        for (const group of groups) {
          if (group.dataset.containerName === 'Work') {
            const select = group.querySelector('.container-type-select');
            const inputs = group.querySelectorAll('.url-pattern-input');
            return { type: select.value, patternCount: inputs.length };
          }
        }
        return null;
      });

      if (state && state.type === 'no-rule' && state.patternCount === 0) {
        results.pass('Clear resets container to "No Rule"');
      } else {
        results.fail('Clear resets container to "No Rule"', JSON.stringify(state));
      }
    } catch (e) {
      results.error('Clear resets container to "No Rule"', e);
    }

    // Last step: Attempt to clean up after tests.
    try {
      await driver.executeScript(async () => {
        await browser.storage.sync.remove('ctcRules');
      });
    } catch (e) {
      console.log('Warning: could not clean up test rules');
    }

  } catch (e) {
    results.error('Test Suite', e);
  } finally {
    await cleanupBrowser(browser);
    server.close();
  }

  console.log('');
  results.summary();
  process.exit(results.exitCode());
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
