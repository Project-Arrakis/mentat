// guildRoles.js -- shared role-tier-conflict detection + write logic
// (mentat#343+, Phase 4 of dune-awakening-selfhost-docker#832's design,
// §4.7). Extracted out of setupServer.js's old /setup portal handler
// (design doc issues #835/#847) and REWRITTEN to accept an ARRAY of role
// IDs per tier, not just one -- the old portal's own single-role usage
// becomes the degenerate one-element-array case of the same functions,
// so it keeps working unchanged. The new role-picker's multi-select UI
// (a later phase) needs N roles per tier; `guild_roles`' schema already
// supports this (one row per role-per-tier mapping), only this logic
// didn't.
//
// Two responsibilities, kept separate so a caller can conflict-check
// before deciding whether to write at all:
//   - findRoleTierConflict(): read-only, no DB writes.
//   - applyGuildRoleMapping(): the write side.
import { addGuildRole, removeGuildRole, getGuildRoles } from "./database.js";

const TIERS = ["admin", "moderator", "observer"];

function flattenSubmission({ adminRoleIds = [], moderatorRoleIds = [], observerRoleIds = [] }) {
  return [
    ...adminRoleIds.map((roleId) => ["admin", roleId]),
    ...moderatorRoleIds.map((roleId) => ["moderator", roleId]),
    ...observerRoleIds.map((roleId) => ["observer", roleId])
  ].filter(([, roleId]) => roleId);
}

// findRoleTierConflict: separation of duties (issue #238, matching Core's
// tier1-upstream design) -- a single Discord role ID may never be mapped
// to two different tiers *at once*. Owner is deliberately excluded from
// this check: it has no role concept at all, so it can never conflict
// with anything. Returns the first conflict found (role ID + both tier
// names) or null when the combined mapping is conflict-free.
//
// `existingRoles` (the shape database.js's getGuildRoles() returns) is
// checked ALONGSIDE the current submission's roles, not just against each
// other -- addGuildRole() is purely additive (INSERT OR IGNORE), so a
// first registration with adminRoleIds=[X] followed by a later, unrelated
// re-registration with moderatorRoleIds=[X] would otherwise pass this
// check (nothing in THAT request conflicted with itself) while silently
// creating exactly the one-role-two-tiers violation this function exists
// to prevent.
//
// Existing rows whose role_id is ALSO present in the current submission
// are excluded from that comparison, not treated as a conflict -- an
// operator resubmitting an already-mapped role under a *new* tier (e.g.
// promoting a role from moderator to admin) is a deliberate reassignment,
// not two simultaneous tiers for the same role; applyGuildRoleMapping()
// below removes the role's old-tier row before re-adding it under the new
// one, so by the time this combined mapping is actually persisted, no
// real conflict exists.
//
// Layer 2 audit finding (mentat#350): rewritten from an O(n²) all-pairs
// scan to a single-pass Map<roleId, tier> lookup -- this phase exists
// specifically to support N roles per tier (was 1), so a guild with
// several dozen roles mapped now pays that quadratic cost on every
// submission for no correctness benefit over the linear form.
export function findRoleTierConflict({ adminRoleIds = [], moderatorRoleIds = [], observerRoleIds = [], existingRoles = [] }) {
  const submitted = flattenSubmission({ adminRoleIds, moderatorRoleIds, observerRoleIds });
  const submittedRoleIds = new Set(submitted.map(([, roleId]) => String(roleId)));

  const mapped = [
    ...submitted,
    ...existingRoles
      .filter((row) => row.role_type !== "owner" && !submittedRoleIds.has(String(row.role_id)))
      .map((row) => [row.role_type, row.role_id])
  ];

  const seenTierByRoleId = new Map();
  for (const [tier, roleId] of mapped) {
    const key = String(roleId);
    const priorTier = seenTierByRoleId.get(key);
    if (priorTier !== undefined && priorTier !== tier) {
      return { roleId, tierA: priorTier, tierB: tier };
    }
    if (priorTier === undefined) seenTierByRoleId.set(key, tier);
  }
  return null;
}

// applyGuildRoleMapping: the write side. Reassigns each submitted role to
// its new tier -- removes any OTHER tier's row for that same role_id
// FIRST (a role being resubmitted under a new tier must have its old
// tier's row removed, or it ends up mapped to both at once), then adds
// every submitted (tier, roleId) pair.
//
// Layer 2 audit findings (mentat#350), both fixed here:
//   - This function now SELF-ENFORCES the separation-of-duties invariant
//     by re-running findRoleTierConflict() internally against the guild's
//     current DB state and throwing if a conflict exists, rather than
//     only documenting "callers must check first." Once this module has
//     a second real caller (the new POST /api/consoles/:guildId/roles
//     endpoint, a later phase), a caller that forgets the check would
//     otherwise silently write a one-role-two-tiers violation -- issue
//     #238's whole point -- with no error anywhere. Redundant with an
//     already-correct caller (the existing /setup/register handler
//     already calls findRoleTierConflict() itself before this), but that
//     redundancy is the point: this invariant is now impossible to
//     violate via this function regardless of caller discipline.
//   - The remove-then-add sequence now runs inside a single
//     db.transaction() -- previously undocumented-but-assumed atomicity
//     that didn't actually exist anywhere in this codebase (confirmed:
//     zero `.transaction(` calls existed before this fix). A mid-sequence
//     DB error (SQLITE_BUSY, disk full) could otherwise leave a guild
//     with some roles stripped of access and never re-added.
export function applyGuildRoleMapping(db, guildId, { adminRoleIds = [], moderatorRoleIds = [], observerRoleIds = [] }) {
  const submitted = flattenSubmission({ adminRoleIds, moderatorRoleIds, observerRoleIds });

  const conflict = findRoleTierConflict({
    adminRoleIds,
    moderatorRoleIds,
    observerRoleIds,
    existingRoles: getGuildRoles(db, guildId)
  });
  if (conflict) {
    throw new Error(`applyGuildRoleMapping: refusing to write a one-role-two-tiers violation -- role ${conflict.roleId} would be mapped to both ${conflict.tierA} and ${conflict.tierB}. Callers must call findRoleTierConflict() first and reject on conflict before ever reaching this function.`);
  }

  const applyInTransaction = db.transaction(() => {
    for (const [tier, roleId] of submitted) {
      for (const otherTier of TIERS) {
        if (otherTier !== tier) removeGuildRole(db, guildId, otherTier, roleId);
      }
    }
    for (const [tier, roleId] of submitted) {
      addGuildRole(db, guildId, tier, roleId);
    }
  });
  applyInTransaction();
}

// replaceGuildRoleMapping: the write path for the NEW multi-select role
// picker (Phase 5, mentat#353) -- deliberately a DIFFERENT function from
// applyGuildRoleMapping() above, not a shared code path, because it has a
// genuinely different semantic: the submitted arrays are the FULL DESIRED
// STATE per tier, not just additions/reassignments. A role that was
// previously mapped but is simply ABSENT from this submission is REMOVED
// -- matching what a picker's "Save" button actually means to an operator
// (mentat#352, filed during Phase 4's own audit specifically to direct
// this function's design rather than silently changing the OLD portal's
// already-shipped, additive-only behavior). applyGuildRoleMapping() stays
// exactly as it was for the old /setup portal's single-role fields, which
// intentionally do NOT support clearing a mapping by blanking a field.
//
// Layer 2 audit findings (mentat#353), both fixed by this function's
// design, not worked around:
//   - The old two-step "route calls findRoleTierConflict() itself, THEN
//     calls applyGuildRoleMapping() (which re-checks internally)" pattern
//     had a real TOCTOU race: two concurrent requests for the same guild
//     could each pass their own pre-check before either write landed,
//     and paid for guild_roles to be read twice per request. This
//     function does the read, the conflict check, and the write all
//     inside ONE transaction, against ONE read of current state -- no
//     redundant query, no window for a concurrent write to invalidate an
//     already-passed check.
//   - Returns {ok: false, conflict} on a tier conflict rather than
//     throwing -- a conflict is a routine, expected outcome for this
//     endpoint (an operator can legitimately submit an invalid picker
//     state), not an exceptional one a caller should have prevented
//     up front the way applyGuildRoleMapping()'s callers are expected
//     to. The route handler surfaces this directly as its 409 response,
//     with no separate pre-check of its own to fall out of sync.
export function replaceGuildRoleMapping(db, guildId, { adminRoleIds = [], moderatorRoleIds = [], observerRoleIds = [] }) {
  let result;
  const run = db.transaction(() => {
    const existingRoles = getGuildRoles(db, guildId);
    const conflict = findRoleTierConflict({ adminRoleIds, moderatorRoleIds, observerRoleIds, existingRoles });
    if (conflict) {
      result = { ok: false, conflict };
      return;
    }

    const submittedByTier = {
      admin: new Set(adminRoleIds),
      moderator: new Set(moderatorRoleIds),
      observer: new Set(observerRoleIds)
    };
    for (const row of existingRoles) {
      if (row.role_type === "owner") continue;
      if (!submittedByTier[row.role_type]?.has(row.role_id)) {
        removeGuildRole(db, guildId, row.role_type, row.role_id);
      }
    }
    for (const [tier, roleId] of flattenSubmission({ adminRoleIds, moderatorRoleIds, observerRoleIds })) {
      addGuildRole(db, guildId, tier, roleId);
    }
    result = { ok: true };
  });
  run();
  return result;
}
