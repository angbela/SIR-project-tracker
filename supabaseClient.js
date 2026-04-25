const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://vsjupkgxrmlmiofmdkex.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzanVwa2d4cm1sbWlvZm1ka2V4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODU4NDIsImV4cCI6MjA5MjQ2MTg0Mn0.1of0BK16kuqEetRzr_Pd6il2Fgwy0Ztw6g5960RD8XA';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

module.exports = supabase;
