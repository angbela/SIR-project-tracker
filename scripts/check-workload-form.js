// Runs workload-form.js against a tiny fake DOM, the way the pages would use it.
const fs = require('fs');
const path = require('path').join(__dirname, '..') + '/'; // repo root
const sandbox = { window: {} };
// window.Workload comes from workload.client.js
new Function('window', fs.readFileSync(path + 'workload.client.js', 'utf8'))(sandbox.window);

// --- a very small DOM: enough for createElement/appendChild/querySelectorAll/innerHTML ---
const nodes = {};
function makeEl(tag) {
  return {
    tagName: tag, className: '', innerHTML: '', dataset: {}, value: '', children: [],
    listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); },
    querySelectorAll(sel) { return this.children.flatMap(c => c.querySelectorAll ? c.querySelectorAll(sel) : []); }
  };
}
// Rows built by innerHTML: parse the inputs out of the markup so the test can type in them.
function parseRow(html) {
  const initial = /data-initial="([^"]*)"/.exec(html)[1];
  const value = /value="([^"]*)"/.exec(html)[1];
  const input = makeEl('input');
  input.dataset.initial = initial;
  input.value = value;
  const row = makeEl('div');
  row.children = [input];
  row.querySelectorAll = (sel) => (sel === '.workload-input' ? [input] : []);
  return { row, input };
}
const document = {
  getElementById(id) {
    if (!nodes[id]) {
      const el = makeEl('div');
      el.id = id;
      let rows = [];
      Object.defineProperty(el, 'innerHTML', {
        get() { return ''; },
        set(_) { rows = []; el.children = []; }
      });
      el.appendChild = (child) => {
        // when the module appends a row created from markup, wire the fake input up
        if (child.__html) {
          const { row, input } = parseRow(child.__html);
          rows.push(input);
          el.children.push(row);
        }
        return child;
      };
      el.querySelectorAll = (sel) => (sel === '.workload-input' ? rows : []);
      nodes[id] = el;
    }
    return nodes[id];
  }
};
// createElement must record the markup so appendChild can parse it
const realCreate = makeEl;
document.createElement = (tag) => {
  const el = realCreate(tag);
  let html = '';
  Object.defineProperty(el, 'innerHTML', { get: () => html, set: (v) => { html = v; el.__html = v; } });
  return el;
};
sandbox.document = document;

new Function('window', 'document', fs.readFileSync(path + 'workload-form.js', 'utf8'))(sandbox.window, document);
const w = sandbox.window;

// PIC_LIST the pages provide
const PIC_LIST = ['AMF', 'HW'];
sandbox.window.PIC_LIST = PIC_LIST;
globalThis.PIC_LIST = PIC_LIST;

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

// 1. building the inputs from a stored value
new Function('PIC_LIST', 'buildWorkloadInputs', 'esc', 'document', 'window',
  'buildWorkloadInputs("fWorkload", { HW: 4 });')(PIC_LIST, w.buildWorkloadInputs, (v) => v, document, sandbox.window);
const inputs = document.getElementById('fWorkload').querySelectorAll('.workload-input');
check('one box per initial', inputs.map(i => i.dataset.initial), ['AMF', 'HW']);
check('stored value lands in its box', inputs.map(i => i.value), ['', '4']);

// 2. reading them back
inputs[0].value = '3';
check('collect returns only the set initials', w.collectWorkload('fWorkload'), { AMF: 3, HW: 4 });
inputs[0].value = '';
check('a blanked box drops out instead of storing 0', w.collectWorkload('fWorkload'), { HW: 4 });
inputs[0].value = '9';
check('an out-of-range value never reaches the request', w.collectWorkload('fWorkload'), { HW: 4 });

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll workload-form checks passed.');
process.exitCode = failed ? 1 : 0;
