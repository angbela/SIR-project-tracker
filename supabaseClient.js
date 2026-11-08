const { createClient } = require('@supabase/supabase-js');

// Configuration comes from the environment (.env locally, dashboard env vars on Render).
// The anon key is public by design — it is safe to ship to the browser — but keeping it
// out of the source means it can be rotated without touching (or redeploying) the code.
const supabaseUrl = process.env.SUPABASE_URL || 'https://vsjupkgxrmlmiofmdkex.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzanVwa2d4cm1sbWlvZm1ka2V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODU4NDIsImV4cCI6MjA5MjQ2MTg0Mn0.1of0BK16kuqEetRzr_Pd6il2Fgwy0Ztw6g5960RD8XA';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.warn('[config] SUPABASE_URL / SUPABASE_ANON_KEY not set in the environment; using the built-in defaults.');
}

module.exports = {
  createClient,
  supabaseUrl,
  supabaseAnonKey
};
