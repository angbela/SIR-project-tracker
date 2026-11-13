// How a page turns a session into a role. The API is the authority (GET /me), because it
// also knows the optional `admins` table; rolesFromEmail() is the offline fallback so the
// page still routes sensibly when the API cannot be reached.
//
// Loaded by login.html, index.html and pic.html as:  <script src="roles.client.js"></script>

// The two accounts, mirrored from roles.js (the server's copy is the authority). Keep both
// in step when a person is added or removed.
window.ROLES = window.ROLES || {
  ADMIN_EMAILS: ['weldyhermawan@gmail.com'],
  PIC_CODES: ['AMF', 'MDS', 'RS', 'AdF', 'FPB', 'WH', 'TRS', 'FR', 'AnF', 'HW', 'IFK', 'DF', 'MP', 'JBN', 'FM'],
  PIC_EMAILS: {
    'sangkurianginovasi@gmail.com': 'HW'
  },
  ROLE_HOME: { admin: '/', pic: '/pic.html', viewer: '/login.html' },
  ADMINS: false
};

// The API base, the same rule the pages already use (localhost during local development).
function apiBaseUrl() {
  return window.location.hostname === 'localhost'
    ? 'http://localhost:3001'
    : 'https://sir-project-tracker.onrender.com';
}

// Offline fallback: an admin email, then a PIC code — from the PIC_EMAILS list, else from
// the email local part ("amf@x.com" -> AMF, "amf.someone@x.com" -> AMF) — and otherwise
// "viewer" (signed in, but allowed on no page).
function rolesFromEmail(email) {
  const rules = window.ROLES || {};
  const normal = String(email || '').trim().toLowerCase();
  const isAdmin = (rules.ADMIN_EMAILS || []).some(a => String(a).trim().toLowerCase() === normal);
  if (isAdmin) return { role: 'admin', picCode: null, home: (rules.ROLE_HOME || {}).admin || '/' };

  const local = normal.split('@')[0] || '';
  const mapped = Object.entries(rules.PIC_EMAILS || {}).find(([k]) => String(k).trim().toLowerCase() === normal);
  const code = mapped
    ? mapped[1]
    : (rules.PIC_CODES || []).find(c => local === c.toLowerCase() || local.split(/[._+-]/).includes(c.toLowerCase()));
  if (code) {
    return {
      role: 'pic',
      picCode: code,
      home: rules.ADMINS ? null : ((rules.ROLE_HOME || {}).pic || '/pic.html')
    };
  }
  return { role: 'viewer', picCode: null, home: (rules.ROLE_HOME || {}).viewer || '/login.html' };
}

// Ask the API who this token belongs to; fall back to the email rules if it cannot answer.
async function fetchRole(accessToken, email) {
  try {
    const response = await fetch(`${apiBaseUrl()}/me`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.ok) {
      const me = await response.json();
      if (me && me.role) return me;
    }
  } catch (err) {
    console.warn('Could not reach GET /me, using the email rules instead:', err.message);
  }
  return Object.assign({ email }, rolesFromEmail(email));
}

window.apiBaseUrl = apiBaseUrl;
window.rolesFromEmail = rolesFromEmail;
window.fetchRole = fetchRole;
