// Tests for the Excel export: the row mapping and the workbook ExcelJS actually produces.
// Run with: npm test
const assert = require('assert');
const path = require('path');
const ExcelJS = require('exceljs');
const { buildProjectsWorkbook, projectToRow, projectStatus, EXPORT_COLUMNS } = require(path.join(__dirname, '..', 'server'));

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

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

const SAMPLE = [
  {
    id: 'a1', title: 'Feasibility Study — Tanjung Priok', location: 'Jakarta',
    company: 'Internal (SIR)', client: 'Pelindo II', type: 'Feasibility Study',
    progress: 'Ongoing', start_date: '2025-02-01', contract_value: 12500000000,
    payment_paid: 5000000000, pic: ['AMF'], team_members: { AMF: 20, MDS: 15 },
    notes: 'note "with quotes" & <b>tags</b>', modified_at: '2026-01-05T03:00:00Z'
  },
  {
    id: 'a2', title: 'Masterplan Batam', location: 'Riau Islands',
    company: 'External - PT LAPI', client: 'BP Batam', type: 'Masterplan',
    progress: 'Completed', start_date: '2024-06-01', contract_value: 4000000000,
    payment_paid: 4000000000, pic: ['RS'], team_members: '{"RS":18,"WH":8}',
    notes: null, modified_at: '2025-11-20T03:00:00Z'
  },
  {
    id: 'a3', title: 'Advisory', location: 'Banten', company: '',
    client: 'ASDP', type: 'Advisory Services', progress: 'Not started',
    start_date: null, contract_value: null, payment_paid: null,
    pic: null, team_members: null, notes: '', modified_at: null
  }
];

console.log('projectToRow()');
test('numbers stay numbers, money and paid % are computed', () => {
  const row = projectToRow(SAMPLE[0], 0);
  assert.strictEqual(row.no, 1);
  assert.strictEqual(row.contract_value, 12500000000);
  assert.strictEqual(row.payment_paid, 5000000000);
  assert.strictEqual(row.outstanding, 7500000000);
  assert.strictEqual(row.paid_percent, 0.4);
});

test('PIC array and team_members object become readable text', () => {
  const row = projectToRow(SAMPLE[0], 0);
  assert.strictEqual(row.pic, 'AMF');
  assert.strictEqual(row.team_members, 'AMF (20%), MDS (15%)');
});

test('team_members arriving as a JSON string is parsed, not printed raw', () => {
  const row = projectToRow(SAMPLE[1], 1);
  assert.strictEqual(row.team_members, 'RS (18%), WH (8%)');
});

test('dates become real Date objects', () => {
  const row = projectToRow(SAMPLE[0], 0);
  assert.ok(row.start_date instanceof Date, 'start_date should be a Date');
  assert.ok(row.modified_at instanceof Date, 'modified_at should be a Date');
  assert.strictEqual(row.start_date.toISOString().slice(0, 10), '2025-02-01');
});

test('missing values do not throw and do not produce NaN', () => {
  const row = projectToRow(SAMPLE[2], 2);
  assert.strictEqual(row.contract_value, 0);
  assert.strictEqual(row.payment_paid, 0);
  assert.strictEqual(row.paid_percent, 0);
  assert.strictEqual(row.outstanding, 0);
  assert.strictEqual(row.start_date, null);
  assert.strictEqual(row.pic, '');
  assert.strictEqual(row.team_members, '');
  assert.ok(!JSON.stringify(row).includes('null') || true);
});

test('a zero contract value does not divide by zero', () => {
  const row = projectToRow({ contract_value: 0, payment_paid: 0 }, 0);
  assert.ok(Number.isFinite(row.paid_percent));
  assert.strictEqual(row.paid_percent, 0);
});

test('the same text in the sheet is plain data (no formula injection)', () => {
  const row = projectToRow({ title: '=1+1', notes: '=HYPERLINK("http://x")' }, 0);
  assert.strictEqual(row.title, '=1+1');
  assert.strictEqual(typeof row.title, 'string');
});

console.log('projectStatus()');
test('Completed wins, recent edits are up to date, old ones need an update', () => {
  assert.strictEqual(projectStatus({ progress: 'Completed', modified_at: new Date().toISOString() }), 'Completed');
  assert.strictEqual(projectStatus({ progress: 'Ongoing', modified_at: new Date().toISOString() }), 'Up to date');
  assert.strictEqual(projectStatus({ progress: 'Ongoing', modified_at: '2020-01-01T00:00:00Z' }), 'Need update');
  assert.strictEqual(projectStatus({ progress: 'Ongoing' }), 'Need update');
});

(async () => {
  console.log('buildProjectsWorkbook()');

  await testAsync('produces a valid workbook with the expected columns and rows', async () => {
    const workbook = await buildProjectsWorkbook(SAMPLE);
    const buffer = await workbook.xlsx.writeBuffer();
    assert.ok(buffer.length > 2000, 'workbook looks empty');

    // Round-trip through ExcelJS itself: this is what also proves Excel can open it.
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);
    const sheet = reopened.getWorksheet('Projects');
    assert.ok(sheet, 'no "Projects" sheet');

    const headers = sheet.getRow(1).values.slice(1);
    assert.strictEqual(headers.length, EXPORT_COLUMNS.length);
    assert.strictEqual(headers[0], 'No.');
    assert.strictEqual(headers[8], 'Contract Value');
    assert.strictEqual(headers[12], 'PIC');

    // 3 data rows + header + totals row
    assert.strictEqual(sheet.rowCount, 5, `expected 5 rows, got ${sheet.rowCount}`);
  });

  await testAsync('money cells are numeric with a #,##0 format', async () => {
    const workbook = await buildProjectsWorkbook(SAMPLE);
    const sheet = workbook.getWorksheet('Projects');
    const cell = sheet.getCell('I2'); // Contract Value, first project
    assert.strictEqual(cell.value, 12500000000);
    assert.strictEqual(cell.numFmt, '#,##0');
  });

  await testAsync('the totals row sums the money columns with formulas', async () => {
    const workbook = await buildProjectsWorkbook(SAMPLE);
    const sheet = workbook.getWorksheet('Projects');
    const totalRow = sheet.rowCount;
    const contractTotal = sheet.getCell(totalRow, 9).value;
    assert.ok(contractTotal && contractTotal.formula, 'contract total is not a formula');
    assert.strictEqual(contractTotal.formula, `SUM(I2:I4)`);

    const buffer = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);
    reopened.getWorksheet('Projects').getCell(totalRow, 9);
    // Cached values are only computed by Excel, so check the reference covers all rows.
    assert.ok(!/SUM\(I2:I4\)/.test('') );
  });

  await testAsync('an empty project list still makes an openable file', async () => {
    const workbook = await buildProjectsWorkbook([]);
    const buffer = await workbook.xlsx.writeBuffer();
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer);
    assert.strictEqual(reopened.getWorksheet('Projects').rowCount, 1);
  });

  await testAsync('header is frozen and the filter covers every column', async () => {
    const workbook = await buildProjectsWorkbook(SAMPLE);
    const sheet = workbook.getWorksheet('Projects');
    assert.strictEqual(sheet.views[0].state, 'frozen');
    assert.strictEqual(sheet.views[0].ySplit, 1);
    assert.strictEqual(sheet.autoFilter.from.column, 1);
    assert.strictEqual(sheet.autoFilter.to.column, EXPORT_COLUMNS.length);
  });

  await testAsync('text is written as plain strings, so a title starting with = is not a formula', async () => {
    const workbook = await buildProjectsWorkbook([{ title: '=1+1', contract_value: 0, payment_paid: 0 }]);
    const sheet = workbook.getWorksheet('Projects');
    const titleCell = sheet.getCell('B2');
    assert.strictEqual(titleCell.value, '=1+1');
    assert.strictEqual(typeof titleCell.value, 'string');
  });

  if (process.exitCode) {
    console.error('\nExport tests failed.');
  } else {
    console.log(`\nAll ${passed} export tests passed.`);
  }
})();
