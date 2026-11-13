// Tests for dashboard.js, the cards and summary table both pages draw.
// Money mode is the admin page (covered in helpers.test.js too); workload mode is the PIC
// page. Run with: npm test
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Dashboard = require(path.join(__dirname, '..', 'dashboard.js'));
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

const indexHtml = read('index.html');
const picHtml = read('pic.html');

const MEMBERS = ['AMF', 'MDS', 'RS'];
const byName = (list, name) => list.find(m => m.name === name);

const PROJECTS = [
  {
    id: 1, title: 'Jetty A', progress: 'Ongoing', contract_value: 1000, payment_paid: 400,
    pic: ['AMF'], team_members: { AMF: 50, MDS: 50 }, workload: { AMF: 5, MDS: 2 }
  },
  {
    id: 2, title: 'Jetty B', progress: 'Completed', contract_value: 2000, payment_paid: 2000,
    pic: ['RS'], team_members: { RS: 100 }, workload: { RS: 4, MDS: 3 }
  },
  { id: 3, title: 'Study C', progress: 'Not started', contract_value: 500, payment_paid: 0, pic: [], team_members: {}, workload: {} }
];

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

console.log('dashboard: workload mode');
test('workload adds up the 1-5 points per member across projects', () => {
  const stats = Dashboard.computeMemberStats(PROJECTS, MEMBERS, 'workload');
  assert.strictEqual(byName(stats, 'AMF').workloadTotal, 5);
  assert.strictEqual(byName(stats, 'MDS').workloadTotal, 5); // 2 + 3
  assert.strictEqual(byName(stats, 'RS').workloadTotal, 4);
  assert.strictEqual(byName(stats, 'RS').workloadActive, 0);
  assert.strictEqual(byName(stats, 'AMF').workloadActive, 5);
});
test('workload mode counts nothing in money or shares', () => {
  const stats = Dashboard.computeMemberStats(PROJECTS, MEMBERS, 'workload');
  const amf = byName(stats, 'AMF');
  assert.strictEqual(amf.expected, 0);
  assert.strictEqual(amf.earned, 0);
  assert.strictEqual(amf.pending, 0);
});
test('a member with no workload set does not appear from their % share', () => {
  const stats = Dashboard.computeMemberStats(PROJECTS, MEMBERS, 'workload');
  // MDS is on project 1 through team_members but has workload there too; the empty project
  // 3 must not invent anyone.
  assert.strictEqual(stats.length, MEMBERS.length);
  assert.strictEqual(byName(stats, 'MDS').activeCount, 1);
});
test('money mode is unchanged: shares, not workload', () => {
  const stats = Dashboard.computeMemberStats(PROJECTS, MEMBERS, 'money');
  const amf = byName(stats, 'AMF');
  assert.strictEqual(amf.expected, 500);
  assert.strictEqual(amf.earned, 200);
  assert.strictEqual(amf.workloadTotal, 0);
});
test('only whole 1-5 values count, whatever the column holds', () => {
  // '3' (from a text column) is a 3; 7, 3.5 and words carry no workload at all.
  const stats = Dashboard.computeMemberStats([{
    id: 1, title: 'x', progress: 'Ongoing',
    workload: { AMF: '3', MDS: 7, RS: 3.5, HW: 5, ZZZ: 'abc', DF: '' }
  }], [], 'workload');
  const counted = Object.fromEntries(stats.map(m => [m.name, m.workloadTotal]));
  assert.deepStrictEqual(counted, { AMF: 3, HW: 5 });
});
test('a JSON string workload is read the same as an object', () => {
  const asText = Dashboard.computeMemberStats([{ id: 1, progress: 'Ongoing', workload: '{"AMF":2}' }], [], 'workload');
  const asObject = Dashboard.computeMemberStats([{ id: 1, progress: 'Ongoing', workload: { AMF: 2 } }], [], 'workload');
  assert.strictEqual(byName(asText, 'AMF').workloadTotal, byName(asObject, 'AMF').workloadTotal);
});

console.log('dashboard: the summary table');
test('the workload table shows workload columns, not earnings', () => {
  const labels = Dashboard.TABLE_COLUMNS.workload.map(c => c.label);
  assert.deepStrictEqual(labels, ['Member', 'Active Projects', 'Workload', 'Active Workload', 'Completed Workload', 'As PIC']);
  const keys = Dashboard.TABLE_COLUMNS.workload.map(c => c.key);
  ['earned', 'expected', 'pending', 'paidRatio'].forEach(k => {
    assert.ok(!keys.includes(k), `the workload table still has the ${k} column`);
  });
});
test('the money table is untouched', () => {
  const labels = Dashboard.TABLE_COLUMNS.money.map(c => c.label);
  assert.deepStrictEqual(labels, ['Member', 'Active Projects', 'Expected', 'Earned', 'Pending', '% of Expected Paid']);
});

console.log('dashboard: the two pages agree');
test('both pages load dashboard.js and use it for cards and table', () => {
  [indexHtml, picHtml].forEach(html => {
    assert.ok(/src="dashboard\.js"/.test(html), 'a page does not load dashboard.js');
  });
  assert.ok(/window\.Dashboard\.renderCards/.test(indexHtml), 'the admin page does not draw its cards with dashboard.js');
  assert.ok(/window\.Dashboard\.renderTableBody/.test(indexHtml), 'the admin page does not draw its table with dashboard.js');
  assert.ok(/window\.Dashboard\.renderCards/.test(picHtml), 'the PIC page does not draw its cards with dashboard.js');
  assert.ok(/window\.Dashboard\.renderTableBody/.test(picHtml), 'the PIC page does not draw its table with dashboard.js');
});
test('only the PIC page asks for workload mode', () => {
  assert.ok(/'workload'/.test(picHtml), 'pic.html never asks dashboard.js for workload mode');
  assert.ok(!/computeMemberStats\(scoped, PIC_LIST, 'workload'\)/.test(indexHtml), 'the admin page uses workload mode');
  assert.ok(/'money'/.test(indexHtml), 'the admin page does not ask for money mode');
});
test('the PIC page has the same three tabs and a dashboard module', () => {
  const tabs = [...picHtml.matchAll(/data-module="([a-z]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(tabs, ['add', 'update', 'dashboard']);
  assert.ok(/id="addModule"/.test(picHtml) && /id="updateModule"/.test(picHtml) && /id="dashboardModule"/.test(picHtml),
    'pic.html is missing one of the three modules');
  assert.ok(/id="dashboardKpis"/.test(picHtml) && /id="memberGrid"/.test(picHtml) && /id="memberTable"/.test(picHtml),
    'the PIC dashboard is missing its KPIs, cards or table');
});
test('the PIC dashboard shows workload on its cards instead of earnings', () => {
  const cards = picHtml.slice(picHtml.indexOf('function renderDashboard()'), picHtml.indexOf('function setDashboardFilter'));
  assert.ok(/renderCards\(.*?'workload'/.test(cards), 'the cards are not in workload mode');
  assert.ok(!/formatMillions\(member\.earned\)/.test(cards), 'the PIC cards still print earnings');
});

console.log('dashboard: one order for cards and table');
test('the cards keep the order they are given, so the top card is the top row', () => {
  const stats = Dashboard.computeMemberStats(PROJECTS, MEMBERS, 'workload');
  const sorted = Dashboard.sortMembers(stats, 'workloadTotal', 'desc');
  assert.deepStrictEqual(sorted.map(m => m.name), ['AMF', 'MDS', 'RS']);
  // renderCards only needs a container it can write innerHTML to.
  const container = { innerHTML: '' };
  Dashboard.renderCards(container, sorted, 'workload', v => String(v), true);
  const firstCard = container.innerHTML.indexOf('AMF');
  const others = Math.max(container.innerHTML.indexOf('>MDS<'), container.innerHTML.indexOf('>RS<'));
  assert.ok(firstCard > -1 && firstCard < others, 'the cards re-ordered themselves');
});
test('with no order given, the cards still lead with the least workload', () => {
  const stats = Dashboard.computeMemberStats(PROJECTS, MEMBERS, 'workload');
  const container = { innerHTML: '' };
  Dashboard.renderCards(container, [...stats].reverse(), 'workload', v => String(v));
  // AMF and MDS both have 5, RS has 4: RS must come first when the cards choose.
  const rs = container.innerHTML.indexOf('>RS<');
  const amf = container.innerHTML.indexOf('>AMF<');
  assert.ok(rs > -1 && rs < amf, 'the cards no longer sort least-workload-first on their own');
});

if (process.exitCode) {
  console.error('\nSome dashboard tests failed.');
} else {
  console.log(`\nAll ${passed} dashboard tests passed.`);
}
