// Tests for the two-login setup: the role rules (roles.js) and the guards in the pages.
// Run with: npm test
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const roles = require(path.join(__dirname, '..', 'roles'));
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const indexHtml = read('index.html');
const loginHtml = read('login.html');
const picHtml = read('pic.html');
const clientJs = read('roles.client.js');

// The page, with window.ROLES loaded first exactly as the <script> tags do it, and the
// page's own functions returned so they can be called.
function loadClient(customFetch) {
  const rules = `window.ROLES = ${JSON.stringify({
    ADMIN_EMAILS: roles.ADMIN_EMAILS,
    PIC_CODES: roles.PIC_CODES,
    PIC_EMAILS: roles.PIC_EMAILS,
    ROLE_HOME: roles.ROLE_HOME,
    ADMINS: roles.ADMINS,
    ROLE_ADMIN: roles.ROLE_ADMIN,
    ROLE_PIC: roles.ROLE_PIC,
    ROLE_VIEWER: roles.ROLE_VIEWER
  })};\n`;
  const window = { location: { hostname: 'localhost' } };
  const fetchImpl = customFetch || (() => Promise.reject(new Error('offline')));
  const run = new Function('window', 'fetch', `${rules}${clientJs}\nreturn { rolesFromEmail, fetchRole };`);
  return Object.assign({ window }, run(window, fetchImpl));
}

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

console.log('resolveRole()');
test('an email on the admin list is an admin, whatever its case', () => {
  assert.strictEqual(roles.resolveRole('weldyhermawan@gmail.com', []).role, 'admin');
  assert.strictEqual(roles.resolveRole('  WeldyHermawan@Gmail.com ', []).role, 'admin');
});
test('the two-office setup: exactly the accounts that were asked for', () => {
  // sangkurianginovasi@gmail.com -> PIC, weldyhermawan@gmail.com -> admin, nobody else in.
  const pic = roles.resolveRole('sangkurianginovasi@gmail.com', []);
  assert.strictEqual(pic.role, 'pic');
  assert.strictEqual(pic.picCode, 'HW');
  assert.strictEqual(pic.home, '/pic.html');

  const admin = roles.resolveRole('weldyhermawan@gmail.com', []);
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(admin.home, '/');

  assert.strictEqual(roles.resolveRole('angbela@gmail.com', []).role, 'viewer');
  assert.strictEqual(roles.resolveRole('hilmiwirasatya@gmail.com', []).role, 'viewer');
});
test('an email in the optional admins table is an admin', () => {
  assert.strictEqual(roles.resolveRole('boss@corp.com', [{ email: 'boss@corp.com' }]).role, 'admin');
  assert.strictEqual(roles.resolveRole('boss@corp.com', ['boss@corp.com']).role, 'admin');
});
test('a PIC code in the email local part makes a PIC', () => {
  const amf = roles.resolveRole('amf@company.com', []);
  assert.strictEqual(amf.role, 'pic');
  assert.strictEqual(amf.picCode, 'AMF');

  assert.strictEqual(roles.resolveRole('amf.someone@x.com', []).picCode, 'AMF');
  assert.strictEqual(roles.resolveRole('someone-rs@x.com', []).picCode, 'RS');
});
test('a company domain does not invent a PIC code', () => {
  // "sangkurianginovasi" contains letters, not a code; the match must be on whole tokens.
  assert.strictEqual(roles.resolveRole('jbn@sangkurianginovasi.com', []).picCode, 'JBN');
  assert.strictEqual(roles.resolveRole('sangkuriang@x.com', []).role, 'viewer');
  assert.strictEqual(roles.resolveRole('nobody@x.com', []).role, 'viewer');
  assert.strictEqual(roles.resolveRole('', []).role, 'viewer');
});
test('an explicit PIC_EMAILS entry wins over the local part', () => {
  const original = roles.PIC_EMAILS['someone@x.com'];
  roles.PIC_EMAILS['someone@x.com'] = 'MDS';
  try {
    assert.strictEqual(roles.resolveRole('someone@x.com', []).picCode, 'MDS');
  } finally {
    if (original === undefined) delete roles.PIC_EMAILS['someone@x.com'];
    else roles.PIC_EMAILS['someone@x.com'] = original;
  }
});
test('ADMINS is off now that the PIC page is published', () => {
  // roles.ADMINS was true while index.html was the only page; with it false a PIC lands on
  // /pic.html and index.html turns non-admins away. Admins still go to /.
  assert.strictEqual(roles.ADMINS, false);
  const pic = roles.resolveRole('sangkurianginovasi@gmail.com', []);
  assert.strictEqual(pic.role, 'pic');
  assert.strictEqual(pic.picCode, 'HW');
  assert.strictEqual(pic.home, '/pic.html');
  assert.strictEqual(roles.resolveRole('weldyhermawan@gmail.com', []).home, '/');
});

console.log('projectBelongsToPic()');
test('a listed PIC owns the project, in any case and as an array or a string', () => {
  assert.ok(roles.projectBelongsToPic({ pic: ['AMF', 'MDS'] }, 'AMF'));
  assert.ok(roles.projectBelongsToPic({ pic: 'AMF' }, 'amf'));
  assert.ok(roles.projectBelongsToPic({ pic: ['MDS', ' AMF '] }, 'AMF'));
});
test('a team member sees the project their share is on', () => {
  assert.ok(roles.projectBelongsToPic({ pic: ['MDS'], team_members: { AMF: 20 } }, 'AMF'));
  assert.ok(roles.projectBelongsToPic({ pic: ['MDS'], team_members: '{"AMF":20}' }, 'AMF'));
});
test('someone else\'s project is not theirs, and missing data does not throw', () => {
  assert.strictEqual(roles.projectBelongsToPic({ pic: ['MDS'] }, 'AMF'), false);
  assert.strictEqual(roles.projectBelongsToPic({ pic: 'MDS, FR' }, 'AMF'), false);
  assert.strictEqual(roles.projectBelongsToPic({}, 'AMF'), false);
  assert.strictEqual(roles.projectBelongsToPic(null, 'AMF'), false);
  assert.strictEqual(roles.projectBelongsToPic({ pic: ['AMF'] }, null), false);
});

console.log('browser copy (roles.client.js)');
test('browser roles match the server for the same emails', () => {
  const client = loadClient();
  const clientRoles = client.window.ROLES;
  assert.deepStrictEqual(clientRoles.ADMIN_EMAILS, roles.ADMIN_EMAILS);
  assert.deepStrictEqual(clientRoles.PIC_CODES, roles.PIC_CODES);
  assert.deepStrictEqual(clientRoles.PIC_EMAILS, roles.PIC_EMAILS);
  assert.strictEqual(clientRoles.ADMINS, roles.ADMINS);

  ['weldyhermawan@gmail.com', 'sangkurianginovasi@gmail.com', 'nobody@x.com'].forEach(email => {
    const server = roles.resolveRole(email, []);
    const browser = client.rolesFromEmail(email);
    assert.strictEqual(browser.role, server.role, `${email}: role differs from the server`);
    assert.strictEqual(browser.picCode, server.picCode, `${email}: PIC code differs from the server`);
  });
});
test('the pages load the shared role rules', () => {
  ['index.html', 'login.html', 'pic.html'].forEach(page => {
    assert.ok(read(page).includes('roles.client.js'), `${page} does not load roles.client.js`);
  });
});

console.log('page guards');
test('login.html loads the role rules and routes on the role', () => {
  assert.ok(/roles\.client\.js/.test(loginHtml), 'login.html does not load roles.client.js');
  assert.ok(/fetchRole\(/.test(loginHtml), 'login.html never asks for the account role');
  assert.ok(/me\.home/.test(loginHtml), 'login.html does not use the role home page');
});
test('index.html (admin page) refuses a non-admin before loading data', () => {
  assert.ok(/roles\.client\.js/.test(indexHtml), 'index.html does not load roles.client.js');
  const gate = indexHtml.indexOf("me.role !== 'admin'");
  const fetchAt = indexHtml.indexOf('fetchProjects();', indexHtml.indexOf('Supabase client'));
  assert.ok(gate !== -1, 'index.html has no admin check');
  assert.ok(gate < fetchAt, 'index.html loads projects before checking the role');
});
test('pic.html exists, is PIC-only, and sends an admin back to the admin page', () => {
  assert.ok(/window\.location\.href = me\.home \|\| '\/'/.test(picHtml), 'pic.html does not redirect admins');
  assert.ok(/me\.role !== 'pic'/.test(picHtml), 'pic.html does not check the PIC role');
  assert.ok(/\/projects\//.test(picHtml), 'pic.html never saves a project');
});
test('pic.html can create, update and delete projects', () => {
  assert.ok(/method: id \? 'PUT' : 'POST'/.test(picHtml), 'pic.html does not create/update through POST/PUT');
  assert.ok(/method: 'DELETE'/.test(picHtml), 'pic.html cannot delete a project');
  assert.ok(/newProjectBtn/.test(picHtml), 'pic.html has no way to add a project');
});
test('pic.html never sends or edits team_members (shares are admin-only)', () => {
  const payload = picHtml.slice(picHtml.indexOf('function formPayload'), picHtml.indexOf('async function saveProject'));
  assert.ok(!/team_members/.test(payload), 'formPayload() sends team_members, which a PIC must not change');
  assert.ok(!/fTeamMembers/.test(picHtml), 'pic.html shows a team member editor');
});
test('pic.html does not display the team member shares at all', () => {
  assert.ok(!/formatTeam|Team Members<\/th>/.test(picHtml), 'pic.html still renders the Team Members column or its shares');
});
test('the API keeps the stored shares when a PIC saves', () => {
  // The guard moved into projectFields.js, so it can be tested directly (check-team-guard.js).
  const serverJs = read('server.js');
  const fields = read('projectFields.js');
  assert.ok(/teamMembersForWrite/.test(serverJs), 'server.js has no team_members guard');
  assert.ok(/role !== roles\.ROLE_PIC\) return \{ \[TEAM_MEMBERS_FIELD\]: requested \}/.test(fields), 'the guard does not let an admin set shares');
  const put = serverJs.slice(serverJs.indexOf("app.put('/projects/:id'"), serverJs.indexOf("app.delete('/projects/:id'"));
  assert.ok(/teamMembersForWrite\(req\.supabase, req\.role, id, team_members\)/.test(put), 'PUT does not apply the team_members guard');
  assert.ok(/team_members: team\[TEAM_MEMBERS_FIELD\]/.test(put), 'PUT writes the request team_members instead of the kept value');
});
test('a PIC can delete, so the delete route is not admin-only any more', () => {
  const serverJs = read('server.js');
  const del = serverJs.slice(serverJs.indexOf("app.delete('/projects/:id'"), serverJs.indexOf("app.delete('/projects/:id'") + 120);
  assert.ok(/canManageProjects/.test(del), 'DELETE /projects/:id is still admin-only');
});
test('a PIC sees every project, not just their own', () => {
  const serverJs = read('server.js');
  const get = serverJs.slice(serverJs.indexOf("app.get('/projects'"), serverJs.indexOf("app.put('/projects/:id'"));
  assert.ok(!/projectBelongsToPic/.test(get), 'GET /projects still filters to the PIC\'s own projects');
});

(async () => {
  // fetchRole() is async, so its fallback is checked outside test().
  try {
    const client = loadClient();
    const role = await client.fetchRole('t', 'sangkurianginovasi@gmail.com');
    assert.strictEqual(role.role, 'pic');
    assert.strictEqual(role.picCode, 'HW');
    passed++;
    console.log('  ok   fetchRole() returns the email rules when GET /me fails');
  } catch (err) {
    console.error(`  FAIL fetchRole() fallback\n       ${err.message}`);
    process.exitCode = 1;
  }

  if (process.exitCode) {
    console.error('\nSome role tests failed.');
  } else {
    console.log(`\nAll ${passed} role tests passed.`);
  }
})();
