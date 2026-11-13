// The team_members / workload columns: who may set them, and what actually gets stored.
// Kept beside server.js's routes so the rule lives in one readable place.

const roles = require('./roles');
const workloadRules = require('./workload');

const TEAM_MEMBERS_FIELD = 'team_members';
const WORKLOAD_FIELD = 'workload';

// Team member % shares are admin-only. On a PIC's write, the stored value is kept.
async function teamMembersForWrite(supabase, role, projectId, requested) {
  if (role !== roles.ROLE_PIC) return { [TEAM_MEMBERS_FIELD]: requested };

  if (!projectId) {
    // New project: a PIC has nothing to keep, so the column starts empty (not null).
    return { [TEAM_MEMBERS_FIELD]: {} };
  }

  const { data: existing, error } = await supabase
    .from('projects')
    .select('*')
    .match({ id: projectId });
  if (error) throw error;
  const project = (existing || [])[0];
  if (!project) return { notFound: true };
  return { [TEAM_MEMBERS_FIELD]: project[TEAM_MEMBERS_FIELD] };
}

// The workload a request may store, always cleaned to whole numbers 1–5 on known initials.
//   - omitted from the body (undefined): keep whatever is stored, so an older client that
//     does not know the field cannot wipe it
//   - present (even {}): the request's values, cleaned; anything outside 1–5 is dropped
function workloadForWrite(requested) {
  if (requested === undefined) return null; // "leave it alone"
  return workloadRules.sanitiseWorkload(requested, roles.PIC_CODES);
}

module.exports = {
  TEAM_MEMBERS_FIELD,
  WORKLOAD_FIELD,
  teamMembersForWrite,
  workloadForWrite,
};
