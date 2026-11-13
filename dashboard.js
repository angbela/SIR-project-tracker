// The team dashboard, shared by the admin page and the PIC page.
//
// Both pages show the same cards and the same summary table; the only difference is what
// the numbers are made of, chosen with `mode`:
//   mode 'money'    -> each member's share of contract value (Expected) and of what the
//                      client has paid (Earned). The admin page.
//   mode 'workload' -> each member's total workload points (1-5 per project, from the
//                      project's workload field), split into active and completed.
//                      The PIC page.
// The aggregation, the ordering and every line of markup live here, so the two pages
// cannot drift apart. The pages supply the projects and a few formatting helpers.
//
// Loaded as a plain <script> by both pages (window.Dashboard) and by test/dashboard.test.js.

(function () {
  const FILTERS = { all: 'All projects', active: 'Active only', completed: 'Completed only' };

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // True when a project still counts as work in progress (anything but Completed).
  function isActiveProject(project) {
    return (project.progress || '') !== 'Completed';
  }

  function toNumber(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  }

  // JSON from Supabase arrives as an object, but a text column would arrive as a string.
  function asObject(value) {
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch (e) {
        return {};
      }
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return value;
  }

  function picListOf(project) {
    let pics = project.pic || [];
    if (typeof pics === 'string') pics = [pics];
    return Array.isArray(pics) ? pics.filter(Boolean) : [];
  }

  // The PIC is a member too, even when they were left out of team_members.
  // A PIC with no explicit share gets 1% so they show up (never 0).
  function getMemberShares(project) {
    const shares = {};
    Object.entries(asObject(project.team_members)).forEach(([name, fee]) => {
      shares[name] = toNumber(fee);
    });
    picListOf(project).forEach(name => {
      if (shares[name] === undefined) shares[name] = 1;
    });
    return shares;
  }

  // Who counts as being on a project, and with what numbers.
  //   money    -> the % share (team_members, or 1% for a PIC who has none)
  //   workload -> the 1-5 points in the workload field, nobody else
  function membersOnProject(project, mode) {
    if (mode !== 'workload') return getMemberShares(project);
    const workload = asObject(project.workload);
    const members = {};
    Object.entries(workload).forEach(([name, points]) => {
      // 1-5 whole points only. parseInt would turn 3.5 into 3, so the value is checked
      // whole first: a stored decimal or a word is no workload, not a rounded one.
      const n = Number(points);
      if (!Number.isInteger(n) || n < 1 || n > 5) return;
      members[name] = n;
    });
    return members;
  }

  // One row per member of memberList, plus anyone who appears in a project but is not in
  // memberList, so no work is ever lost from the numbers.
  function computeMemberStats(projects, memberList, mode) {
    const names = (memberList || []).slice();
    projects.forEach(project => {
      Object.keys(membersOnProject(project, mode)).forEach(name => {
        if (name && !names.includes(name)) names.push(name);
      });
    });

    const stats = {};
    names.forEach(name => {
      stats[name] = {
        name,
        expected: 0,
        earned: 0,
        pending: 0,
        paidRatio: 0,
        workloadTotal: 0,
        workloadActive: 0,
        workloadCompleted: 0,
        activeCount: 0,
        completedCount: 0,
        picCount: 0,
        lastTouched: null,
        projects: []
      };
    });

    projects.forEach(project => {
      const members = membersOnProject(project, mode);
      const contractValue = toNumber(project.contract_value);
      const paidValue = toNumber(project.payment_paid);
      const pics = picListOf(project);
      const touched = project.modified_at || project.created_at || null;
      const active = isActiveProject(project);

      Object.entries(members).forEach(([name, amount]) => {
        const member = stats[name];
        if (!member) return;

        const expected = mode === 'workload' ? 0 : contractValue * amount / 100;
        const earned = mode === 'workload' ? 0 : paidValue * amount / 100;

        member.expected += expected;
        member.earned += earned;
        if (mode === 'workload') {
          member.workloadTotal += amount;
          if (active) member.workloadActive += amount; else member.workloadCompleted += amount;
        }
        if (active) member.activeCount++; else member.completedCount++;
        if (pics.includes(name)) member.picCount++;
        if (touched && (!member.lastTouched || new Date(touched) > new Date(member.lastTouched))) {
          member.lastTouched = touched;
        }
        member.projects.push({
          id: project.id,
          title: project.title,
          progress: project.progress,
          share: amount,
          expected,
          earned,
          active
        });
      });
    });

    return Object.values(stats).map(member => {
      member.pending = member.expected - member.earned;
      member.paidRatio = member.expected > 0 ? (member.earned / member.expected) * 100 : 0;
      // Active work first, then the rest by how much is still to come in.
      member.projects.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return b.pending - a.pending;
      });
      return member;
    });
  }

  // The member totals that order the cards and fill the table.
  function orderValue(member, mode) {
    return mode === 'workload' ? member.workloadTotal : member.earned;
  }

  function projectsForFilter(projects, filter) {
    if (filter === 'active') return projects.filter(isActiveProject);
    if (filter === 'completed') return projects.filter(p => !isActiveProject(p));
    return projects;
  }

  // ---- cards ----
  // `format` is the page's formatter for money ("Rp 1,25 M"); workload mode never uses it.
  function renderCards(container, members, mode, format, keepOrder) {
    if (!container) return;
    if (!members.length) {
      container.innerHTML = '<div class="member-projects"><span class="empty">No members to show.</span></div>';
      return;
    }

    // The caller's order (the order the table below is showing) wins: the top card and the
    // top row are then the same person. With no order given, least-on-their-plate first.
    const ordered = keepOrder ? [...members] : [...members].sort((a, b) => orderValue(a, mode) - orderValue(b, mode));

    container.innerHTML = ordered.map(member => {
      const activeProjects = member.projects.filter(p => p.active);
      const shownProjects = activeProjects.length ? activeProjects : member.projects;
      const projectRows = shownProjects.length
        ? shownProjects.map(project => `
                        <div class="mini-project" title="${esc(project.title)}">
                            <span class="title">${esc(project.title || '(untitled)')}</span>
                            <span class="progress-chip" data-progress="${esc(project.progress || '')}">${esc(project.progress || '-')}</span>
                            <span class="share">${mode === 'workload' ? esc(String(project.share)) + ' pts' : esc(String(project.share)) + '%'}</span>
                        </div>
                    `).join('')
        : '<span class="empty">No projects yet — good candidate for the next allocation.</span>';

      const badges = [
        member.picCount > 0 ? `<span class="badge pic">PIC ×${member.picCount}</span>` : '',
        mode === 'workload'
          ? (member.workloadTotal === 0 ? '<span class="badge warn">No workload set</span>' : '')
          : (member.earned === 0 ? '<span class="badge warn">No earnings yet</span>' : '')
      ].join('');

      // Same four boxes in both modes; in workload mode they are points, not rupiah.
      const boxes = mode === 'workload'
        ? [
          { lbl: 'Workload', val: String(member.workloadTotal), cls: 'earned' },
          { lbl: 'Active', val: String(member.workloadActive), cls: 'pending' },
          { lbl: 'Completed', val: String(member.workloadCompleted), cls: '' },
          { lbl: 'Projects', val: String(member.activeCount + member.completedCount), cls: '' }
        ]
        : [
          { lbl: 'Earned', val: format(member.earned), cls: 'earned' },
          { lbl: 'Pending', val: format(member.pending), cls: 'pending' },
          { lbl: 'Expected', val: format(member.expected), cls: '' },
          { lbl: 'Paid so far', val: member.paidRatio.toFixed(0) + '%', cls: '' }
        ];

      // The bar is a percentage in money mode; in workload mode it is the share of the
      // member's points that is on active projects.
      const barPercent = mode === 'workload'
        ? (member.workloadTotal > 0 ? (member.workloadActive / member.workloadTotal) * 100 : 0)
        : Math.min(100, Math.max(0, member.paidRatio));

      return `
                    <div class="member-card${member.picCount > 0 ? ' is-pic' : ''}">
                        <div class="member-head">
                            <div class="member-avatar${orderValue(member, mode) === 0 ? ' low' : ''}">${esc(member.name.slice(0, 3))}</div>
                            <div>
                                <div class="member-name">${esc(member.name)}</div>
                                <div class="member-meta">${member.activeCount} active &middot; ${member.completedCount} completed</div>
                            </div>
                            <div class="member-badges">${badges}</div>
                        </div>

                        <div class="money-grid">
                            ${boxes.map(box => `
                            <div class="money-item">
                                <div class="lbl">${esc(box.lbl)}</div>
                                <div class="val${box.cls ? ' ' + box.cls : ''}">${esc(box.val)}</div>
                            </div>`).join('')}
                        </div>
                        <div class="money-bar"><span style="width: ${barPercent.toFixed(1)}%"></span></div>

                        <div class="member-projects">
                            ${projectRows}
                        </div>
                    </div>
                `;
    }).join('');
  }

  // ---- summary table ----
  // The table's columns are part of this module so the two pages cannot show different ones.
  const TABLE_COLUMNS = {
    money: [
      { key: 'name', label: 'Member' },
      { key: 'activeCount', label: 'Active Projects' },
      { key: 'expected', label: 'Expected' },
      { key: 'earned', label: 'Earned' },
      { key: 'pending', label: 'Pending' },
      { key: 'paidRatio', label: '% of Expected Paid' }
    ],
    workload: [
      { key: 'name', label: 'Member' },
      { key: 'activeCount', label: 'Active Projects' },
      { key: 'workloadTotal', label: 'Workload' },
      { key: 'workloadActive', label: 'Active Workload' },
      { key: 'workloadCompleted', label: 'Completed Workload' },
      { key: 'picCount', label: 'As PIC' }
    ]
  };

  function renderTableHeader(theadRow, mode) {
    if (!theadRow) return;
    theadRow.innerHTML = TABLE_COLUMNS[mode].map(col =>
      `<th data-sort-by="${esc(col.key)}">${esc(col.label)} <span class="sort-indicator"></span></th>`
    ).join('');
  }

  // Puts members in the order the table draws them. Exported so the cards above the table
  // always lead with the same person as the first row.
  function sortMembers(members, sortColumn, sortDirection) {
    return [...members].sort((a, b) => {
      let valA = a[sortColumn];
      let valB = b[sortColumn];
      if (sortColumn === 'lastTouched') {
        valA = valA ? new Date(valA).getTime() : 0;
        valB = valB ? new Date(valB).getTime() : 0;
      } else if (typeof valA === 'string' || typeof valB === 'string') {
        valA = (valA || '').toString().toLowerCase();
        valB = (valB || '').toString().toLowerCase();
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function renderTableBody(tbody, members, mode, sortColumn, sortDirection, format) {
    if (!tbody) return;
    const sorted = sortMembers(members, sortColumn, sortDirection);

    const cell = (member, key) => {
      if (mode === 'workload') {
        if (key === 'name') return esc(member.name);
        if (key === 'workloadTotal') return `<strong>${member.workloadTotal}</strong>`;
        return String(member[key] ?? 0);
      }
      if (key === 'name') return esc(member.name);
      if (key === 'activeCount') return String(member.activeCount);
      if (key === 'paidRatio') return member.paidRatio.toFixed(0) + '%';
      if (key === 'earned') return `<span style="color: var(--success); font-weight: 600;">${esc(format(member.earned))}</span>`;
      if (key === 'pending') return `<span style="color: #f59e0b;">${esc(format(member.pending))}</span>`;
      return esc(format(member[key]));
    };

    tbody.innerHTML = sorted.map(member => `
                <tr>
                    ${TABLE_COLUMNS[mode].map(col => `<td>${cell(member, col.key)}</td>`).join('')}
                </tr>
            `).join('');
  }

  function renderSortIndicators(theadRow, sortColumn, sortDirection) {
    if (!theadRow) return;
    theadRow.querySelectorAll('th').forEach(header => {
      const indicator = header.querySelector('.sort-indicator');
      if (!indicator) return;
      indicator.textContent = header.getAttribute('data-sort-by') === sortColumn
        ? (sortDirection === 'asc' ? '▲' : '▼')
        : '';
    });
  }

  // Everything at once, for a page that just wants the dashboard drawn.
  function render(options) {
    const mode = options.mode === 'workload' ? 'workload' : 'money';
    const scoped = projectsForFilter(options.projects || [], options.filter || 'all');
    const members = computeMemberStats(scoped, options.memberList || [], mode);
    renderCards(options.cardGrid, members, mode, options.format);
    renderTableHeader(options.theadRow, mode);
    renderTableBody(options.tbody, members, mode, options.sortColumn, options.sortDirection || 'asc', options.format);
    renderSortIndicators(options.theadRow, options.sortColumn, options.sortDirection || 'asc');
    return { members, scoped, mode };
  }

  const Dashboard = {
    FILTERS,
    TABLE_COLUMNS,
    esc,
    isActiveProject,
    getMemberShares,
    membersOnProject,
    computeMemberStats,
    orderValue,
    projectsForFilter,
    renderCards,
    renderTableHeader,
    renderTableBody,
    sortMembers,
    renderSortIndicators,
    render
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Dashboard;
  if (typeof window !== 'undefined') window.Dashboard = Dashboard;
})();
