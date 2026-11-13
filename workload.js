// Workload per PIC initial, stored on a project as {"AMF": 3, "HW": 5}.
//
// Same shape as team_members (an object keyed by initial), but the value is a whole number
// 1–5 — or 0, which means "this initial is listed but has no workload set yet". Anything
// else is dropped rather than stored (a blank box, "abc", 7, 3.7), so the database can
// never hold a value the UI cannot show.
//
// This is the ONLY copy of the rules. server.js requires this file, and GET /workload.js
// serves this same file to the browser (see the route in server.js), so the boxes and the
// API cannot drift apart. That is why the exports are declared the way they are: one line
// works in both Node and a browser.

const WORKLOAD_MIN = 1;
const WORKLOAD_MAX = 5;

// A value the UI can show, or null when it is not a workload at all.
function toWorkloadLevel(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (!Number.isInteger(number)) return null;
  if (number === 0) return 0; // listed, not set
  if (number < WORKLOAD_MIN || number > WORKLOAD_MAX) return null;
  return number;
}

// The stored object, whatever came over the wire: JSON text, null, an array, junk.
function parseWorkload(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (e) {
      return {};
    }
  }
  if (typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

// Clean object for storage: known initials only when picCodes is given, valid 1–5 values
// only, and entries with no value dropped (so {"AMF": ""} stores as {}).
function sanitiseWorkload(value, picCodes) {
  const parsed = parseWorkload(value);
  const allowed = Array.isArray(picCodes) && picCodes.length ? new Set(picCodes.map(String)) : null;
  const clean = {};
  Object.entries(parsed).forEach(([key, level]) => {
    const initial = String(key).trim();
    if (!initial) return;
    if (allowed && !allowed.has(initial)) return;
    const number = toWorkloadLevel(level);
    if (number === null || number === 0) return;
    clean[initial] = number;
  });
  return clean;
}

// What the pages send from their boxes: { AMF: '3', HW: '' } -> { AMF: 3 }.
function workloadFromFormValues(values, picCodes) {
  return sanitiseWorkload(values, picCodes);
}

// A short readable summary for a table cell: "AMF 3, HW 5".
function formatWorkload(value) {
  const parsed = sanitiseWorkload(value);
  return Object.entries(parsed).map(([initial, level]) => `${initial} ${level}`).join(', ');
}

const workloadRules = {
  WORKLOAD_MIN,
  WORKLOAD_MAX,
  toWorkloadLevel,
  parseWorkload,
  sanitiseWorkload,
  workloadFromFormValues,
  formatWorkload,
};

// Node (server.js, the tests): the module above is what require() gets.
// Browser (this file served at /workload.js): the same object on window.Workload.
if (typeof module !== 'undefined' && module.exports) module.exports = workloadRules;
if (typeof window !== 'undefined') window.Workload = workloadRules;
