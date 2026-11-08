// Tests for the pure helpers in index.html.
// The frontend is a single static file with inline JS (no bundler), so the functions are
// extracted from the file and evaluated here. Run with: npm test
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Pull a top-level `function name(...) { ... }` block out of the inline script by brace matching.
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in index.html`);
  let depth = 0;
  let i = html.indexOf('{', start);
  const bodyStart = i;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name} (body starts at ${bodyStart})`);
}

const source = ['esc', 'formatTeamDisplay', 'formatPICDisplay', 'formatNumber']
  .map(extractFunction)
  .join('\n');

const helpers = new Function(`${source}; return { esc, formatTeamDisplay, formatPICDisplay, formatNumber };`)();

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('esc()');
test('escapes tag characters', () => {
  assert.strictEqual(helpers.esc('<script>'), '&lt;script&gt;');
});
test('escapes quotes, so values cannot break out of an attribute', () => {
  assert.strictEqual(helpers.esc('a" onmouseover="b'), 'a&quot; onmouseover=&quot;b');
});
test('escapes ampersands and single quotes', () => {
  assert.strictEqual(helpers.esc(`A & B's`), 'A &amp; B&#39;s');
});
test('neutralises an img onerror payload', () => {
  const out = helpers.esc('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<'), 'output must not contain a raw <');
  assert.ok(!out.includes('>'), 'output must not contain a raw >');
});
test('null/undefined become empty strings, 0 is kept', () => {
  assert.strictEqual(helpers.esc(null), '');
  assert.strictEqual(helpers.esc(undefined), '');
  assert.strictEqual(helpers.esc(0), '0');
});

console.log('formatTeamDisplay()');
test('object -> "name (pct%)" list', () => {
  assert.strictEqual(helpers.formatTeamDisplay({ AMF: 20, MDS: 30 }), 'AMF (20%), MDS (30%)');
});
test('JSON string is parsed', () => {
  assert.strictEqual(helpers.formatTeamDisplay('{"AMF":20}'), 'AMF (20%)');
});
test('malformed string is shown as-is instead of throwing', () => {
  assert.strictEqual(helpers.formatTeamDisplay('{oops'), '{oops');
});
test('empty values render empty', () => {
  assert.strictEqual(helpers.formatTeamDisplay(null), '');
  assert.strictEqual(helpers.formatTeamDisplay(undefined), '');
  assert.strictEqual(helpers.formatTeamDisplay(''), '');
});
test('non-object primitives do not throw', () => {
  assert.strictEqual(helpers.formatTeamDisplay(5), '5');
});

console.log('formatPICDisplay()');
test('array -> comma list', () => {
  assert.strictEqual(helpers.formatPICDisplay(['AMF', 'RS']), 'AMF, RS');
});
test('plain string is returned unchanged', () => {
  assert.strictEqual(helpers.formatPICDisplay('AMF'), 'AMF');
});
test('empty renders empty', () => {
  assert.strictEqual(helpers.formatPICDisplay(null), '');
});

console.log('formatNumber()');
test('groups thousands, no decimals', () => {
  assert.strictEqual(helpers.formatNumber(1234567), '1.234.567');
});
test('handles zero', () => {
  assert.strictEqual(helpers.formatNumber(0), '0');
});

// Guards against a whole class of bug: a <select> whose options used to be hardcoded in
// the HTML but were moved into JS. If a form opens and the builder is never called, the
// dropdown renders empty. Checks every select that the script is responsible for.
console.log('selects populated by script');
const requiredSelects = ['addLocation', 'addType', 'addProgress', 'updateLocation', 'updateType', 'updateProgress'];
requiredSelects.forEach(id => {
  test(`${id} has no hardcoded <option> left in the HTML`, () => {
    const selectBlock = html.slice(html.indexOf(`id="${id}"`), html.indexOf('</select>', html.indexOf(`id="${id}"`)));
    assert.ok(!/<option/i.test(selectBlock), `<option> found inside #${id}; it should be built from the constants`);
  });
});
test('updateProgress is rebuilt when a project is loaded', () => {
  const loader = html.slice(html.indexOf('function loadProjectDataForUpdate'), html.indexOf('function cancelUpdate'));
  assert.ok(/buildProgressOptions\([^)]*'updateProgress'\)/.test(loader), 'loadProjectDataForUpdate() never populates #updateProgress');
});
test('addProgress and addType are rebuilt after a successful add', () => {
  const submit = html.slice(html.indexOf("getElementById('addProjectForm').addEventListener"));
  assert.ok(/buildProgressOptions\('Not started'\)/.test(submit), 'add form progress select is not rebuilt after submit');
  assert.ok(/buildTypeOptions\(''\)/.test(submit), 'add form type select is not rebuilt after submit');
  assert.ok(/buildLocationOptions\(''\)/.test(submit), 'add form location select is not rebuilt after submit');
});

if (process.exitCode) {
  console.error('\nSome tests failed.');
} else {
  console.log(`\nAll ${passed} tests passed.`);
}
