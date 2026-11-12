// Export every project to an .xlsx file from the command line.
//
//   npm run export                       -> SIR-Projects-<timestamp>.xlsx in the project folder
//   npm run export -- --out report.xlsx  -> choose the file name
//   npm run export -- --url http://localhost:3001 --email you@example.com --password ...
//
// It signs in with Supabase (the same account the app uses, so RLS still applies) and then
// reads the rows the same way the app's export button does. The workbook itself is built by
// buildProjectsWorkbook() in server.js, so a file made here is identical to one downloaded
// from the table.
const fs = require('fs');
const path = require('path');

// server.js reads .env through a plain parser, so loading it here is enough.
// server.js is required once: importing it also runs its .env loader, and it does not
// start listening (it only does that when run directly).
const { buildProjectsWorkbook } = require('../server');
const { createClient, supabaseUrl, supabaseAnonKey } = require('../supabaseClient');

function argValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
}

function timestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

(async () => {
  const email = argValue('email') || process.env.EXPORT_EMAIL;
  const password = argValue('password') || process.env.EXPORT_PASSWORD;
  const output = path.resolve(argValue('out') || `SIR-Projects-${timestamp()}.xlsx`);

  if (!email || !password) {
    console.error('Missing credentials.');
    console.error('Pass them with --email and --password, or set EXPORT_EMAIL / EXPORT_PASSWORD in .env.');
    process.exit(1);
  }

  const auth = createClient(supabaseUrl, supabaseAnonKey);
  const { data: signIn, error: signInError } = await auth.auth.signInWithPassword({ email, password });
  if (signInError) {
    console.error(`Could not sign in: ${signInError.message}`);
    process.exit(1);
  }

  // Query with the user's own token, so row-level security decides what is visible.
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${signIn.session.access_token}` } }
  });

  const { data, error } = await client
    .from('projects')
    .select('*')
    .order('modified_at', { ascending: false, nullsFirst: false });

  if (error) {
    console.error(`Could not read projects: ${error.message}`);
    process.exit(1);
  }

  const workbook = await buildProjectsWorkbook(data || []);
  await workbook.xlsx.writeFile(output);
  console.log(`Exported ${(data || []).length} projects to ${output}`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
