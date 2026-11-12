const express = require('express');

// Minimal .env loader (no dependency): Node's --env-file does not exist on older runtimes,
// and dotenv is not installed. Only sets keys that are not already in the environment.
try {
  const fs = require('fs');
  const path = require('path');
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || line.trim().startsWith('#')) return;
      const key = match[1];
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    });
  }
} catch (err) {
  console.warn('[config] Could not read .env:', err.message);
}

const { createClient, supabaseUrl, supabaseAnonKey } = require('./supabaseClient');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(cors()); // Enable CORS for all routes

// Serve the Supabase config to the browser, so the URL/key live in one place (.env)
// instead of being hardcoded in index.html and login.html.
app.get('/config.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-cache');
  res.send(
    `window.APP_CONFIG = ${JSON.stringify({
      SUPABASE_URL: supabaseUrl,
      SUPABASE_ANON_KEY: supabaseAnonKey,
    })};`
  );
});

app.use(express.static(__dirname)); // Serve static files from the current directory

// Middleware to protect routes
// Validates the user's JWT, then hands the request its own Supabase client carrying that JWT,
// so Postgres row-level security applies to every query.
async function protect(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]; // Bearer TOKEN
  if (!token) {
    return res.status(401).json({ error: 'No authorization token provided' });
  }

  try {
    // Create a Supabase client instance for this request, configured with the user's JWT
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.user = user; // Attach user to request
    req.supabase = supabase; // Attach the authenticated Supabase client to the request
    next();
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

// Same auth check, but for the login page (which has no session yet): only confirms the
// configured Supabase project is reachable and the anon key is accepted.
app.get('/health/supabase', async (req, res) => {
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { error } = await supabase.from('projects').select('id', { count: 'exact', head: true });
    // RLS with no session returns 0 rows (no error), which is the healthy case.
    res.status(200).json({
      ok: !error,
      url: supabaseUrl,
      error: error ? error.message : null,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// Apply protection to all project routes
app.post('/projects', protect, async (req, res) => {
  const { title, location, company, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes } = req.body;
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .insert([{ title, location, company, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes }]);
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/projects', protect, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .select('*')
      .order('modified_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    res.status(200).json(data || []);
  } catch (error) {
    console.error('GET /projects failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.put('/projects/:id', protect, async (req, res) => {
  const { id } = req.params;
  const { title, location, company, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes } = req.body;
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .update({ title, location, company, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes, modified_at: new Date() })
      .match({ id });
    if (error) throw error;
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/projects/:id', protect, async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await req.supabase
      .from('projects')
      .delete()
      .match({ id });
    if (error) throw error;
    res.status(204).send(); // No content to send back
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Excel export ----
// Builds a formatted .xlsx from a list of projects with ExcelJS (server-side: the browser
// would need a ~1MB library for the same result). Shared by the authed route below and by
// the CLI export script, so the two can never drift apart.

// Cell values are written as plain data (no formulas, no HTML), so nothing can be injected
// into the workbook. Long text is wrapped rather than cut.
const EXPORT_COLUMNS = [
  { header: 'No.', key: 'no', width: 6, align: 'center' },
  { header: 'Title', key: 'title', width: 46, wrap: true },
  { header: 'Location', key: 'location', width: 20 },
  { header: 'Company', key: 'company', width: 22 },
  { header: 'Client', key: 'client', width: 24 },
  { header: 'Type', key: 'type', width: 34, wrap: true },
  { header: 'Progress', key: 'progress', width: 13, align: 'center' },
  { header: 'Start Date', key: 'start_date', width: 12, align: 'center' },
  { header: 'Contract Value', key: 'contract_value', width: 17, money: true },
  { header: 'Payment Paid', key: 'payment_paid', width: 17, money: true },
  { header: 'Paid %', key: 'paid_percent', width: 9, align: 'center', percent: true },
  { header: 'Outstanding', key: 'outstanding', width: 17, money: true },
  { header: 'PIC', key: 'pic', width: 16 },
  { header: 'Team Members (%)', key: 'team_members', width: 34, wrap: true },
  { header: 'Notes', key: 'notes', width: 44, wrap: true },
  { header: 'Last Modified', key: 'modified_at', width: 20, align: 'center' },
  { header: 'Status', key: 'status', width: 14, align: 'center' }
];

function parseTeamMembers(team) {
  if (!team) return {};
  if (typeof team === 'string') {
    try {
      const parsed = JSON.parse(team);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch (e) {
      return {};
    }
  }
  return typeof team === 'object' ? team : {};
}

function toList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean);
  return [String(value)];
}

function projectStatus(project) {
  if (project.progress === 'Completed') return 'Completed';
  const touched = project.modified_at || project.created_at;
  if (!touched) return 'Need update';
  const days = Math.abs(new Date() - new Date(touched)) / (1000 * 60 * 60 * 24);
  return days < 7 ? 'Up to date' : 'Need update';
}

// A date cell only when the value really is a date, otherwise the raw text is kept.
function toExcelDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date;
}

function projectToRow(project, index) {
  const contract = parseFloat(project.contract_value) || 0;
  const paid = parseFloat(project.payment_paid) || 0;
  const team = parseTeamMembers(project.team_members);
  const teamText = Object.entries(team).map(([name, fee]) => `${name} (${fee}%)`).join(', ');

  return {
    no: index + 1,
    title: project.title || '',
    location: project.location || '',
    company: project.company || '',
    client: project.client || '',
    type: project.type || '',
    progress: project.progress || '',
    start_date: toExcelDate(project.start_date),
    contract_value: contract,
    payment_paid: paid,
    paid_percent: contract > 0 ? paid / contract : 0,
    outstanding: contract - paid,
    pic: toList(project.pic).join(', '),
    team_members: teamText,
    notes: project.notes || '',
    modified_at: toExcelDate(project.modified_at || project.created_at),
    status: projectStatus(project)
  };
}

async function buildProjectsWorkbook(projects) {
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SIR Project Tracker';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Projects', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });

  sheet.columns = EXPORT_COLUMNS.map(column => ({
    header: column.header,
    key: column.key,
    width: column.width
  }));

  projects.forEach((project, index) => {
    sheet.addRow(projectToRow(project, index));
  });

  // Header: bold on the dark bar the app uses, so the sheet reads like the table on screen.
  const headerRow = sheet.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
      right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
    };
  });

  const lastRow = sheet.rowCount;
  if (lastRow > 1) {
    for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const column = EXPORT_COLUMNS[columnNumber - 1];
        if (!column) return;
        cell.alignment = { vertical: 'top', horizontal: column.align || 'left', wrapText: !!column.wrap };
        if (column.money) cell.numFmt = '#,##0';
        if (column.percent) cell.numFmt = '0.0%';
        if (column.key === 'start_date' || column.key === 'modified_at') {
          if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd';
        }
        cell.border = {
          top: { style: 'hair', color: { argb: 'FFD1D5DB' } },
          left: { style: 'hair', color: { argb: 'FFD1D5DB' } },
          bottom: { style: 'hair', color: { argb: 'FFD1D5DB' } },
          right: { style: 'hair', color: { argb: 'FFD1D5DB' } }
        };
      });
      if (rowNumber % 2 === 1) {
        row.eachCell({ includeEmpty: true }, cell => {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
        });
      }
    }

    // Totals row: only the money columns and the row count.
    const totals = sheet.addRow({ no: '', title: `${projects.length} projects` });
    ['contract_value', 'payment_paid', 'outstanding'].forEach(key => {
      const columnIndex = EXPORT_COLUMNS.findIndex(c => c.key === key);
      if (columnIndex === -1) return;
      const letter = sheet.getColumn(columnIndex + 1).letter;
      totals.getCell(columnIndex + 1).value = {
        formula: `SUM(${letter}2:${letter}${lastRow})`
      };
      totals.getCell(columnIndex + 1).numFmt = '#,##0';
    });
    totals.font = { bold: true };
    totals.eachCell(cell => {
      cell.border = { top: { style: 'double', color: { argb: 'FF9CA3AF' } } };
    });
  }

  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_COLUMNS.length } };

  return workbook;
}

function exportFileName() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `SIR-Projects-${stamp}.xlsx`;
}

// GET /projects/export.xlsx — the same rows the table shows, as a real workbook.
// Registered before the static middleware so it is not shadowed by a file of that name.
app.get('/projects/export.xlsx', protect, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .select('*')
      .order('modified_at', { ascending: false, nullsFirst: false });
    if (error) throw error;

    const workbook = await buildProjectsWorkbook(data || []);
    const buffer = await workbook.xlsx.writeBuffer();

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFileName()}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('GET /projects/export.xlsx failed:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = { app, buildProjectsWorkbook, projectToRow, projectStatus, EXPORT_COLUMNS };

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
