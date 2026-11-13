// Harness for the team_members rule: runs the real teamMembersForWrite() from server.js
// against a fake Supabase query builder, so "a PIC cannot change shares, an admin can" is
// checked without a live database or a session.  Run: node scripts/check-team-guard.js
const fs = require('fs');
const path = require('path');
const express = require('express');
const roles = require('../roles');

const TEAM_MEMBERS_FIELD = 'team_members';
const store = {
  p1: { id: 'p1', title: 'Old title', team_members: { AMF: 20, MDS: 15 }, pic: ['AMF'] }
};

// A stand-in for @supabase/supabase-js with just the calls the guard makes.
function fakeSupabase() {
  return {
    from() {
      const q = { id: null };
      q.select = () => q;
      q.match = (m) => { q.id = m.id; return q; };
      q.update = (row) => {
    // Writes land straight away and the result resolves, but stays chainable like the real
    // builder (.match() after .update()) so this test can be written the same way.
    store[q.id] = Object.assign({}, store[q.id], row);
    const result = Promise.resolve({ data: [store[q.id]], error: null });
    result.match = () => result;
    return result;
  };
      q.insert = (rows) => { const r = Object.assign({ id: 'p2' }, rows[0]); store[r.id] = r; return Promise.resolve({ data: [r], error: null }); };
      q.then = (resolve) => resolve({ data: q.id && store[q.id] ? [store[q.id]] : (q.id ? [] : Object.values(store)), error: null });
      return q;
    }
  };
}

// Use the real guards from projectFields.js, so this test cannot drift from the code.
const { teamMembersForWrite, workloadForWrite } = require('../projectFields');

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  req.role = req.query.as === 'admin' ? 'admin' : 'pic';
  req.supabase = fakeSupabase();
  next();
});
app.put('/projects/:id', async (req, res) => {
  const { id } = req.params;
  const team = await teamMembersForWrite(req.supabase, req.role, id, req.body.team_members);
  if (team.notFound) return res.status(404).json({ error: 'Project not found' });
  const { data } = await req.supabase.from('projects')
    .update(Object.assign({ title: req.body.title, team_members: team[TEAM_MEMBERS_FIELD] },
      workloadForWrite(req.body.workload) === null ? {} : { workload: workloadForWrite(req.body.workload) }))
    .match({ id });
  res.json(data);
});
app.post('/projects', async (req, res) => {
  const team = await teamMembersForWrite(req.supabase, req.role, null, req.body.team_members);
  const { data } = await req.supabase.from('projects')
    .insert([{ title: req.body.title, team_members: team[TEAM_MEMBERS_FIELD], workload: workloadForWrite(req.body.workload) || {} }]);
  res.json(data);
});

let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const server = app.listen(0, async () => {
  const base = `http://localhost:${server.address().port}`;
  const put = async (as, body) => (await fetch(`${base}/projects/p1?as=${as}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })).json();
  const post = async (as, body) => (await fetch(`${base}/projects?as=${as}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })).json();

  const picSave = await put('pic', { title: 'Renamed by PIC', team_members: { RS: 99 } });
  check('PIC can rename a project', picSave[0] && picSave[0].title, 'Renamed by PIC');
  check('PIC cannot change shares', picSave[0] && picSave[0].team_members, { AMF: 20, MDS: 15 });

  const adminSave = await put('admin', { title: 'Renamed by admin', team_members: { RS: 99 } });
  check('admin can change shares', adminSave[0] && adminSave[0].team_members, { RS: 99 });

  const picNew = await post('pic', { title: 'Made by PIC', team_members: { AMF: 50 } });
  check('PIC creates a project with no shares', picNew[0] && picNew[0].team_members, {});
  const adminNew = await post('admin', { title: 'Made by admin', team_members: { AMF: 50 } });
  check('admin creates a project with shares', adminNew[0] && adminNew[0].team_members, { AMF: 50 });


  // workload is open to both roles, and always stored as whole numbers 1-5.
  const picWorkload = await put('pic', { title: 'x', workload: { AMF: '9', HW: 2 } });
  check('PIC can set workload, clamped to 1-5', picWorkload[0] && picWorkload[0].workload, { HW: 2 });
  const keptWorkload = await put('admin', { title: 'y' });
  check('a save without workload keeps the stored value', keptWorkload[0] && keptWorkload[0].workload, { HW: 2 });
  const clearedWorkload = await put('admin', { title: 'z', workload: {} });
  check('an explicit {} clears the workload', clearedWorkload[0] && clearedWorkload[0].workload, {});

  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll team guard checks passed.');
  server.close();
  if (failed) process.exitCode = 1;
});
