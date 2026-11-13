// The Workload inputs on the admin page: one row per PIC initial, a 1-5 box each.
// "AMF  3" means AMF's workload on this project is 3. Anything typed outside 1-5 is
// refused here (and again by the API), and a blank box means "not set", which is stored
// as absent rather than 0.
//
// The page loads GET /workload.js for the rules (window.Workload), so the same code the
// server uses decides what is valid.

function workloadRulesClient() {
  return window.Workload || null;
}

// Builds (or rebuilds) the workload inputs in a container, one per initial in PIC_LIST.
// `values` is the stored object: { AMF: 3, HW: 5 }.
function buildWorkloadInputs(containerId, values) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const stored = (workloadRulesClient() ? workloadRulesClient().sanitiseWorkload(values) : (values || {}));
  container.innerHTML = '';
  PIC_LIST.forEach(initial => {
    const value = stored[initial];
    const row = document.createElement('div');
    row.className = 'workload-item';
    row.innerHTML = `
      <span class="workload-initial">${esc(initial)}</span>
      <input type="number" class="workload-input" data-initial="${esc(initial)}"
             min="1" max="5" step="1" inputmode="numeric" placeholder="1-5"
             value="${value ? esc(value) : ''}">
    `;
    container.appendChild(row);
  });
  // Keep the boxes honest while typing: no 0, no 7, no decimals.
  container.querySelectorAll('.workload-input').forEach(input => {
    input.dataset.lastGood = input.value;
    input.addEventListener('input', () => {
      const rules = workloadRulesClient();
      const level = rules ? rules.toWorkloadLevel(input.value) : null;
      const raw = input.value.trim();
      if (raw === '') {
        input.dataset.lastGood = '';
        return;
      }
      if (level === null || level === 0) {
        input.value = input.dataset.lastGood || '';
      } else {
        input.dataset.lastGood = String(level);
        input.value = String(level);
      }
    });
  });
}

// Reads the inputs back: only initials with a 1-5 value are sent, so a blank box never
// overwrites a stored value with nothing. Returns {} when nothing is set anywhere.
function collectWorkload(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return {};
  const values = {};
  container.querySelectorAll('.workload-input').forEach(input => {
    const rules = workloadRulesClient();
    const level = rules ? rules.toWorkloadLevel(input.value) : Number(input.value);
    if (level === 1 || level === 2 || level === 3 || level === 4 || level === 5) {
      values[input.dataset.initial] = level;
    }
  });
  return values;
}

// One readable line for the table cell and the search: "AMF 3, HW 5".
function formatWorkloadDisplay(values) {
  const rules = workloadRulesClient();
  if (rules) return rules.formatWorkload(values);
  const parsed = values && typeof values === 'object' ? values : {};
  return Object.entries(parsed).map(([initial, level]) => `${initial} ${level}`).join(', ');
}

window.buildWorkloadInputs = buildWorkloadInputs;
window.collectWorkload = collectWorkload;
window.formatWorkloadDisplay = formatWorkloadDisplay;
