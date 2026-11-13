// Who may open which page — the single source of truth, shared by the server
// (require('./roles')) and the pages (via GET /roles.js, which serves roles.client.js).
//
// Exactly two accounts, each with one role:
//   weldyhermawan@gmail.com       -> admin  (index.html, everything incl. team member %)
//   sangkurianginovasi@gmail.com  -> PIC    (pic.html, CRUD except team member %)
// Any other signed-in account is a "viewer": it has no page and is refused at login.
//
// Add a person by adding one line to ADMIN_EMAILS or PIC_EMAILS below (and the same line in
// roles.client.js, which is the copy the browser loads).

const ADMIN_EMAILS = ['weldyhermawan@gmail.com'];

// PIC codes are the same ones the dashboard uses (index.html PIC_LIST).
const PIC_CODES = ['AMF', 'MDS', 'RS', 'AdF', 'FPB', 'WH', 'TRS', 'FR', 'AnF', 'HW', 'IFK', 'DF', 'MP', 'JBN', 'FM'];

// The PIC accounts: email -> PIC code. The code is their row in the project PIC list, so
// their own name is still offered when they set a project's PIC.
const PIC_EMAILS = {
  'sangkurianginovasi@gmail.com': 'HW',
};

const ROLE_ADMIN = 'admin';
const ROLE_PIC = 'pic';
const ROLE_VIEWER = 'viewer';

const ROLE_HOME = {
  admin: '/',
  pic: '/pic.html',
  viewer: '/login.html',
};

// Where to send someone after login (or when they open the wrong page).
// ADMINS > 1: index.html is the only page, so a PIC is refused at login rather than sent
// to a PIC page that would not exist. false: both pages are live.
const ADMINS = false;

function homeForRole(role) {
  if (role === ROLE_ADMIN) return ROLE_HOME.admin;
  if (role === ROLE_PIC) return ADMINS ? null : ROLE_HOME.pic;
  return ROLE_HOME.viewer;
}

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// The PIC code an email belongs to, or null. PIC_EMAILS is the list that counts; a code
// written in the email local part ("amf@x.com") is also accepted, so one can be added
// without touching this file again.
function picCodeForEmail(email) {
  const normalised = normaliseEmail(email);
  if (!normalised) return null;

  const mapped = Object.entries(PIC_EMAILS).find(([key]) => normaliseEmail(key) === normalised);
  if (mapped) return mapped[1];

  const local = normalised.split('@')[0];
  const direct = PIC_CODES.find(code => code.toLowerCase() === local);
  if (direct) return direct;

  // "amf.someone@x.com" / "someone.amf@x.com": first token that is exactly a PIC code.
  const tokens = local.split(/[._+\-]/).filter(Boolean);
  const tokenMatch = PIC_CODES.find(code => tokens.includes(code.toLowerCase()));
  return tokenMatch || null;
}

function isAdminEmail(email, adminRows) {
  const normalised = normaliseEmail(email);
  if (!normalised) return false;
  if (ADMIN_EMAILS.some(admin => normaliseEmail(admin) === normalised)) return true;

  // `admins` table rows may come back as { email } objects or as bare strings.
  return (adminRows || []).some(row => normaliseEmail(typeof row === 'string' ? row : row && row.email) === normalised);
}

// The whole decision, in one place. adminRows is the result of the `admins` table lookup
// (pass [] when it is not available); picCodeForEmail covers the rest.
function resolveRole(email, adminRows) {
  if (isAdminEmail(email, adminRows)) {
    return { role: ROLE_ADMIN, picCode: null, home: homeForRole(ROLE_ADMIN) };
  }
  const picCode = picCodeForEmail(email);
  if (picCode) {
    return { role: ROLE_PIC, picCode, home: homeForRole(ROLE_PIC) };
  }
  return { role: ROLE_VIEWER, picCode: null, home: homeForRole(ROLE_VIEWER) };
}

// Does this project belong to the PIC? A project can list several PICs; a PIC sees the
// ones that name them, plus the ones where they are a team member (their share lives there).
function projectBelongsToPic(project, picCode) {
  if (!project || !picCode) return false;
  const target = String(picCode).toLowerCase();

  const pic = project.pic;
  const pics = Array.isArray(pic) ? pic : (pic ? String(pic).split(',') : []);
  if (pics.some(name => String(name).trim().toLowerCase() === target)) return true;

  let team = project.team_members;
  if (typeof team === 'string') {
    try { team = JSON.parse(team); } catch (e) { team = null; }
  }
  if (team && typeof team === 'object') {
    return Object.keys(team).some(name => String(name).trim().toLowerCase() === target);
  }
  return false;
}

module.exports = {
  ADMINS,
  ADMIN_EMAILS,
  PIC_CODES,
  PIC_EMAILS,
  ROLE_ADMIN,
  ROLE_PIC,
  ROLE_VIEWER,
  ROLE_HOME,
  homeForRole,
  normaliseEmail,
  picCodeForEmail,
  isAdminEmail,
  resolveRole,
  projectBelongsToPic,
};
