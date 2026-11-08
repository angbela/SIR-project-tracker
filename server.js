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
  const { title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes } = req.body;
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .insert([{ title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes }]);
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
  const { title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes } = req.body;
  try {
    const { data, error } = await req.supabase
      .from('projects')
      .update({ title, location, client, type, progress, start_date, contract_value, payment_paid, pic, team_members, notes, modified_at: new Date() })
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

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
