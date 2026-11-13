// Static fallback for GET /config.js. The server serves the real values from .env (or the
// environment) and wins; this file only matters when the pages are opened without the API —
// a plain static host or the file system — so they still boot instead of failing to load.
// Keep the two strings in step with supabaseClient.js (the anon key is public by design).
//
// window.APP_CONFIG is set an entry at a time so that the API and this file can never
// cancel each other out: whoever declares a value first wins per field.
window.APP_CONFIG = window.APP_CONFIG || {};
window.APP_CONFIG.SUPABASE_URL = window.APP_CONFIG.SUPABASE_URL || 'https://vsjupkgxrmlmiofmdkex.supabase.co';
window.APP_CONFIG.SUPABASE_ANON_KEY = window.APP_CONFIG.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzanVwa2d4cm1sbWlvZm1ka2V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODU4NDIsImV4cCI6MjA5MjQ2MTg0Mn0.1of0BK16kuqEetRzr_Pd6il2Fgwy0Ztw6g5960RD8XA';
