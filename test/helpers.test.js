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

// The dashboard's money model. Pure functions, so they can be checked without a DOM.
const dashboardSource = ['isActiveProject', 'getMemberShares', 'computeMemberStats', 'formatMillions', 'projectsForFilter']
  .map(extractFunction)
  .join('\n');

const dashboard = new Function(`${dashboardSource}; return { isActiveProject, getMemberShares, computeMemberStats, formatMillions, projectsForFilter };`)();

const MEMBERS = ['AMF', 'MDS', 'RS'];
const byName = (list, name) => list.find(m => m.name === name);

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

console.log('dashboard: money model');
test('expected = contract value share, earned = the same share of what was paid', () => {
  const stats = dashboard.computeMemberStats([
    { id: 1, title: 'P1', contract_value: 1000, payment_paid: 400, team_members: { AMF: 20, MDS: 30 }, progress: 'Ongoing' }
  ], MEMBERS);
  const amf = byName(stats, 'AMF');
  assert.strictEqual(amf.expected, 200);
  assert.strictEqual(amf.earned, 80);
  assert.strictEqual(amf.pending, 120);
  assert.strictEqual(amf.paidRatio, 40);
});

test('progress does not affect the money, only the active/completed counts', () => {
  const project = { id: 1, contract_value: 1000, payment_paid: 400, team_members: { AMF: 20 }, progress: 'Completed' };
  const amf = byName(dashboard.computeMemberStats([project], MEMBERS), 'AMF');
  assert.strictEqual(amf.earned, 80);
  assert.strictEqual(amf.activeCount, 0);
  assert.strictEqual(amf.completedCount, 1);
});

test('a PIC with no team share still counts, with a 1% share', () => {
  const amf = byName(dashboard.computeMemberStats([
    { id: 1, contract_value: 1000, payment_paid: 0, pic: ['AMF'], team_members: {}, progress: 'Ongoing' }
  ], MEMBERS), 'AMF');
  assert.strictEqual(dashboard.getMemberShares({ pic: ['AMF'], team_members: {} }).AMF, 1);
  assert.strictEqual(amf.expected, 10);
  assert.strictEqual(amf.picCount, 1);
  assert.strictEqual(amf.activeCount, 1);
});

test('a PIC already in team_members keeps their real share, not 1%', () => {
  const amf = byName(dashboard.computeMemberStats([
    { id: 1, contract_value: 1000, payment_paid: 0, pic: ['AMF'], team_members: { AMF: 25 } }
  ], MEMBERS), 'AMF');
  assert.strictEqual(amf.expected, 250);
});

test('earnings add up across projects and track the latest modified date', () => {
  const stats = dashboard.computeMemberStats([
    { id: 1, contract_value: 1000, payment_paid: 1000, team_members: { RS: 10 }, modified_at: '2024-01-01T00:00:00Z' },
    { id: 2, contract_value: 500, payment_paid: 100, team_members: { RS: 20 }, modified_at: '2024-06-01T00:00:00Z' }
  ], MEMBERS);
  const rs = byName(stats, 'RS');
  assert.strictEqual(rs.expected, 200); // 100 + 100
  assert.strictEqual(rs.earned, 120);   // 100 + 20
  assert.strictEqual(rs.pending, 80);
  assert.strictEqual(rs.lastTouched, '2024-06-01T00:00:00Z');
  assert.strictEqual(rs.projects.length, 2);
});

test('team_members arriving as a JSON string (Supabase jsonb quirk) is parsed', () => {
  const amf = byName(dashboard.computeMemberStats([
    { id: 1, contract_value: 1000, payment_paid: 0, team_members: '{"AMF":15}' }
  ], MEMBERS), 'AMF');
  assert.strictEqual(amf.expected, 150);
});

test('every member of the list is returned, including those with no projects', () => {
  const stats = dashboard.computeMemberStats([], MEMBERS);
  assert.strictEqual(stats.length, 3);
  stats.forEach(m => {
    assert.strictEqual(m.expected, 0);
    assert.strictEqual(m.earned, 0);
    assert.strictEqual(m.paidRatio, 0);
    assert.deepStrictEqual(m.projects, []);
  });
});

test('a name in a project but not in the member list is still reported', () => {
  const stats = dashboard.computeMemberStats([
    { id: 1, contract_value: 1000, payment_paid: 0, team_members: { ZZZ: 10 } }
  ], MEMBERS);
  assert.ok(byName(stats, 'ZZZ'), 'unknown member was dropped from the numbers');
});

test('missing/blank numbers do not produce NaN', () => {
  const amf = byName(dashboard.computeMemberStats([
    { id: 1, contract_value: null, payment_paid: undefined, team_members: { AMF: 20 } }
  ], MEMBERS), 'AMF');
  assert.strictEqual(amf.expected, 0);
  assert.strictEqual(amf.earned, 0);
  assert.ok(!Number.isNaN(amf.paidRatio));
});

console.log('dashboard: formatMillions()');
test('shows millions with two decimals below 100M', () => {
  assert.strictEqual(dashboard.formatMillions(1250000000), 'Rp 1.250 M');
  assert.strictEqual(dashboard.formatMillions(15500000), 'Rp 15,5 M');
});
test('drops decimals from 100M up, and handles zero', () => {
  assert.strictEqual(dashboard.formatMillions(250000000), 'Rp 250 M');
  assert.strictEqual(dashboard.formatMillions(0), 'Rp 0 M');
  assert.strictEqual(dashboard.formatMillions(null), 'Rp 0 M');
});

console.log('dashboard: filters');
test('active excludes Completed, completed keeps only it', () => {
  const projects = [{ progress: 'Ongoing' }, { progress: 'Finishing' }, { progress: 'Completed' }, { progress: 'On hold' }];
  assert.strictEqual(dashboard.projectsForFilter(projects, 'active').length, 3);
  assert.strictEqual(dashboard.projectsForFilter(projects, 'completed').length, 1);
  assert.strictEqual(dashboard.projectsForFilter(projects, 'all').length, 4);
});

console.log('dashboard: wiring');
test('the dashboard is rendered when its tab is opened', () => {
  const switcher = html.slice(html.indexOf('function switchModule'), html.indexOf('function populateUpdateDropdown'));
  assert.ok(/moduleName === 'dashboard'/.test(switcher), 'switchModule() does not handle the dashboard tab');
  assert.ok(/renderDashboard\(\)/.test(switcher), 'switchModule() never calls renderDashboard()');
});
test('the dashboard refreshes after projects are re-fetched', () => {
  const fetcher = html.slice(html.indexOf('async function fetchProjects'), html.indexOf('function sortAndRenderProjects'));
  assert.ok(/renderDashboard\(\)/.test(fetcher), 'fetchProjects() never refreshes the dashboard');
});
test('filter buttons are wired to setDashboardFilter()', () => {
  assert.ok(/#dashboardFilters \.filter-btn/.test(html), 'no listener bound to the dashboard filter buttons');
});

// Guards against a whole class of bug: a <select> whose options used to be hardcoded in// the HTML but were moved into JS. If a form opens and the builder is never called, the
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
