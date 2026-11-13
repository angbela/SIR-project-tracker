// Tests for the workload field: the 1-5 rules (shared module + its browser copy), what the
// API stores, and the column it adds to the pages and the export.  Run with: npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const workload = require(path.join(__dirname, '..', 'workload'));
const { workloadForWrite, TEAM_MEMBERS_FIELD, WORKLOAD_FIELD } = require(path.join(__dirname, '..', 'projectFields'));
const { EXPORT_COLUMNS, projectToRow } = require(path.join(__dirname, '..', 'server'));
const roles = require(path.join(__dirname, '..', 'roles'));

const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const indexHtml = read('index.html');
const picHtml = read('pic.html');

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

console.log('workload: 1-5 rules');
test('accepts the whole numbers 1 to 5', () => {
  [1, 2, 3, 4, 5, '3', ' 5 '].forEach(value => {
    const level = workload.toWorkloadLevel(value);
    assert.ok(level >= 1 && level <= 5, `${value} -> ${level}`);
  });
});
test('refuses 0, negatives, decimals, words and blanks', () => {
  [0, -1, 6, 99, 3.5, 'abc', '', '   ', null, undefined, NaN].forEach(value => {
    const level = workload.toWorkloadLevel(value);
    assert.ok(level === null || level === 0, `${value} -> ${level}`);
  });
});
test('sanitiseWorkload keeps valid values and drops everything else', () => {
  const clean = workload.sanitiseWorkload({ AMF: '3', MDS: '', RS: 'abc', AdF: 7, FPB: 3.5, WH: 0, HW: '5' });
  assert.deepStrictEqual(clean, { AMF: 3, HW: 5 });
});
test('only the known initials survive when the PIC list is given', () => {
  assert.deepStrictEqual(workload.sanitiseWorkload({ ZZZ: 3, AMF: 2 }, roles.PIC_CODES), { AMF: 2 });
  // ...and a call without the list keeps the keys it is given (the browser summarising)
  assert.deepStrictEqual(workload.sanitiseWorkload({ ZZZ: 3 }), { ZZZ: 3 });
});
test('junk shapes are treated as empty, not as crashes', () => {
  assert.deepStrictEqual(workload.sanitiseWorkload(null), {});
  assert.deepStrictEqual(workload.sanitiseWorkload([1, 2, 3]), {});
  assert.deepStrictEqual(workload.sanitiseWorkload('not json'), {});
  assert.deepStrictEqual(workload.sanitiseWorkload('{"AMF":4}'), { AMF: 4 });
});
test('formats as "initial value" pairs', () => {
  assert.strictEqual(workload.formatWorkload({ AMF: 3, HW: 5 }), 'AMF 3, HW 5');
  assert.strictEqual(workload.formatWorkload({}), '');
  assert.strictEqual(workload.formatWorkload(null), '');
});

console.log('workload: served to the browser');
test('the file served at /workload.js is the one server.js requires', () => {
  // One copy of the rules: the route must not point at some other file.
  assert.ok(/sendFile\(path\.join\(__dirname, 'workload\.js'\)\)/.test(read('server.js')), 'server.js does not serve workload.js at /workload.js');
  const sandbox = {};
  new Function('window', 'module', read('workload.js'))(sandbox, undefined);
  const client = sandbox.Workload;
  const samples = [
    { AMF: 3, HW: 5 }, { AMF: '3', MDS: '' }, { AdF: 7, FPB: 3.5 }, {}, null, '{"RS":2}'
  ];
  samples.forEach(sample => {
    assert.deepStrictEqual(
      client.sanitiseWorkload(sample, roles.PIC_CODES),
      workload.sanitiseWorkload(sample, roles.PIC_CODES),
      `differs for ${JSON.stringify(sample)}`
    );
  });
  assert.strictEqual(client.WORKLOAD_MIN, workload.WORKLOAD_MIN);
  assert.strictEqual(client.WORKLOAD_MAX, workload.WORKLOAD_MAX);
});

console.log('workload: what the API stores');
test('a write clamps every value to 1-5 on known initials', () => {
  assert.deepStrictEqual(workloadForWrite({ AMF: '9', HW: '2', ZZZ: 4 }), { HW: 2 });
  assert.deepStrictEqual(workloadForWrite({ AMF: 0 }), {});
});
test('a body that leaves workload out keeps the stored value', () => {
  // null is the "leave it alone" signal the PUT route checks for.
  assert.strictEqual(workloadForWrite(undefined), null);
});
test('an explicit {} clears the workload', () => {
  assert.deepStrictEqual(workloadForWrite({}), {});
});

console.log('workload: pages and export');
test('both pages load the workload rules and show a column', () => {
  [indexHtml, picHtml].forEach(html => {
    assert.ok(/src="workload\.js"/.test(html), 'a page does not load workload.js');
    assert.ok(/src="workload-form\.js"/.test(html), 'a page does not load workload-form.js');
    assert.ok(/formatWorkloadDisplay\(project\.workload\)/.test(html), 'a page has no workload cell');
    assert.ok(/buildWorkloadInputs\(/.test(html), 'a page never builds the workload inputs');
    assert.ok(/collectWorkload\(/.test(html), 'a page never reads the workload inputs back');
  });
  assert.ok(/<th>Workload<\/th>/.test(indexHtml) && /<th>Workload<\/th>/.test(picHtml), 'the Workload column header is missing');
});
test('the admin page sends workload on add and on update', () => {
  assert.ok(/workload: collectWorkload\('addWorkload'\)/.test(indexHtml), 'the add form does not send workload');
  assert.ok(/workload: collectWorkload\('updateWorkload'\)/.test(indexHtml), 'the update form does not send workload');
});
test('a workload value outside 1-5 never survives the input box', () => {
  const form = read('workload-form.js');
  assert.ok(/min="1" max="5"/.test(form), 'the box does not limit itself to 1-5');
  assert.ok(/toWorkloadLevel/.test(form), 'the box does not use the shared 1-5 rules');
});
test('the workbook carries a Workload column with the readable value', () => {
  const column = EXPORT_COLUMNS.find(c => c.key === 'workload');
  assert.ok(column, 'no workload column in EXPORT_COLUMNS');
  assert.strictEqual(column.header, 'Workload (1-5)');
  const row = projectToRow({
    id: 'x', title: 'T', contract_value: 100, payment_paid: 50,
    pic: ['AMF'], team_members: { AMF: 20 }, workload: { AMF: 3, HW: 5 }, modified_at: new Date().toISOString()
  }, 0);
  assert.strictEqual(row.workload, 'AMF 3, HW 5');
});
test('the workload column is not admin-only in the field rules', () => {
  // team_members stays PIC-protected; workload is deliberately open to both roles.
  assert.strictEqual(TEAM_MEMBERS_FIELD, 'team_members');
  assert.strictEqual(WORKLOAD_FIELD, 'workload');
  const fields = read('projectFields.js');
  const workloadBlock = fields.slice(fields.indexOf('function workloadForWrite'));
  assert.ok(!/ROLE_PIC/.test(workloadBlock), 'workloadForWrite() refuses PICs');
});

if (process.exitCode) {
  console.error('\nSome workload tests failed.');
} else {
  console.log(`\nAll ${passed} workload tests passed.`);
}
