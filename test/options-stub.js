const fs = require('fs');
const path = require('path');
const vm = require('vm');

class StubElement {
  constructor(className = '') {
    this.className = className;
    this.dataset = {};
    this.style = {};
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this.children = [];
    this.parentNode = null;
    this.listeners = {};
    this.onclick = null;
    this._innerHTML = '';
  }

  set innerHTML(value) {
    this._innerHTML = value;
    if (value === '') {
      this.children.forEach(child => { child.parentNode = null; });
      this.children = [];
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  appendChild(child) {
    if (child.isFragment) {
      [...child.children].forEach(fragmentChild => this.appendChild(fragmentChild));
      child.children = [];
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  remove() {
    if (this.parentNode) {
      this.parentNode.children = this.parentNode.children.filter(child => child !== this);
      this.parentNode = null;
    }
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = element => {
      element.children.forEach(child => {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    const attribute = selector.match(/^\[data-container-name="(.*)"\]$/);
    return Boolean(attribute && this.dataset.containerName === attribute[1]);
  }

  closest(selector) {
    let element = this;
    while (element) {
      if (element.matches(selector)) return element;
      element = element.parentNode;
    }
    return null;
  }

  cloneNode(deep = false) {
    const clone = new StubElement(this.className);
    clone.dataset = { ...this.dataset };
    clone.style = { ...this.style };
    clone.value = this.value;
    clone.checked = this.checked;
    clone.textContent = this.textContent;
    if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
    return clone;
  }
}

class StubFragment extends StubElement {
  constructor() {
    super();
    this.isFragment = true;
  }

  cloneNode(deep = false) {
    const clone = new StubFragment();
    if (deep) this.children.forEach(child => clone.appendChild(child.cloneNode(true)));
    return clone;
  }
}

function createContainerTemplate() {
  const fragment = new StubFragment();
  const group = new StubElement('container-group');
  group.appendChild(new StubElement('container-name'));
  group.appendChild(new StubElement('container-type-select'));
  group.appendChild(new StubElement('add-url-btn'));
  group.appendChild(new StubElement('clear-btn'));
  fragment.appendChild(group);
  return { content: fragment };
}

function createPatternRowTemplate() {
  const fragment = new StubFragment();
  const row = new StubElement('url-pattern-row');
  row.appendChild(new StubElement('url-pattern-input'));
  row.appendChild(new StubElement('priority-checkbox'));
  row.appendChild(new StubElement('delete-btn'));
  fragment.appendChild(row);
  return { content: fragment };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createOptionsHarness({
  containers = [{ name: 'Work' }],
  rules = [],
  encode = rulesToEncode => Promise.resolve(rulesToEncode),
  write = null,
  debugRead = null,
  debugEnabled = false,
} = {}) {
  const elements = {
    rulesTableBody: new StubElement(),
    validationMessages: new StubElement(),
    debugLoggingCheckbox: new StubElement(),
    saveRulesTopBtn: new StubElement(),
    saveRulesBottomBtn: new StubElement(),
    exportBtn: new StubElement(),
    importBtn: new StubElement(),
    exportOutput: new StubElement(),
    importJsonInput: new StubElement(),
    'container-group-template': createContainerTemplate(),
    'url-pattern-row-template': createPatternRowTemplate(),
  };
  const changeListeners = [];
  const storageData = { ctcRules: rules, ctcDebugLoggingEnabled: debugEnabled };
  const writes = [];
  const sync = {
    get: key => {
      if (key === 'ctcDebugLoggingEnabled' && debugRead) return debugRead.promise;
      if (typeof key === 'string') return Promise.resolve({ [key]: storageData[key] });
      return Promise.resolve({ ...storageData });
    },
    set: async values => {
      writes.push(values);
      if (write) await write(values);
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        const oldValue = storageData[key];
        storageData[key] = value;
        changes[key] = { oldValue, newValue: value };
      }
      changeListeners.forEach(listener => listener(changes, 'sync'));
    },
  };
  const document = {
    getElementById: id => elements[id] || null,
    createElement: () => new StubElement(),
    addEventListener: () => {},
  };
  const context = vm.createContext({
    console,
    document,
    browser: {
      storage: {
        sync,
        onChanged: { addListener: listener => changeListeners.push(listener) },
      },
    },
    CtcRepo: {
      getData: success => success({ containers: { containerArray: containers }, rules }),
    },
    encodeRulesForStorage: encode,
    setTimeout: () => 0,
  });

  const runSource = relativePath => {
    const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
    vm.runInContext(source, context, { filename: relativePath });
  };
  runSource('src/logging.js');
  runSource('src/pattern-matching.js');
  runSource('src/options.js');
  const Options = vm.runInContext('CtcOptions', context);
  const options = new Options();

  return {
    context,
    document,
    elements,
    options,
    storageData,
    writes,
    dispatchStorageChange(changes, area = 'sync') {
      changeListeners.forEach(listener => listener(changes, area));
    },
    evaluate: source => vm.runInContext(source, context),
  };
}

module.exports = { createOptionsHarness, deferred };
