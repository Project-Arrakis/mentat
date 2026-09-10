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
//   - applyGuildRoleMapping(): the write side. Callers wrapping this in a
//     transaction (the new POST /api/consoles/:guildId/roles endpoint, a
//     later phase) are responsible for that -- this function itself does
//     not open one, matching database.js's own convention of leaving
//     transaction scope to the caller.
import { addGuildRole, removeGuildRole } from "./database.js";

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
export function findRoleTierConflict({ adminRoleIds = [], moderatorRoleIds = [], observerRoleIds = [], existingRoles = [] }) {
  const submitted = flattenSubmission({ adminRoleIds, moderatorRoleIds, observerRoleIds });
  const submittedRoleIds = new Set(submitted.map(([, roleId]) => String(roleId)));

  const mapped = [
    ...submitted,
    ...existingRoles
      .filter((row) => row.role_type !== "owner" && !submittedRoleIds.has(String(row.role_id)))
      .map((row) => [row.role_type, row.role_id])
  ];

  for (let i = 0; i < mapped.length; i++) {
    for (let j = i + 1; j < mapped.length; j++) {
      const [tierA, roleIdA] = mapped[i];
      const [tierB, roleIdB] = mapped[j];
      if (tierA !== tierB && String(roleIdA) === String(roleIdB)) {
        return { roleId: roleIdA, tierA, tierB };
      }
    }
  }
  return null;
}

// applyGuildRoleMapping: the write side. Reassigns each submitted role to
// its new tier -- removes any OTHER tier's row for that same role_id
// FIRST (a role being resubmitted under a new tier must have its old
// tier's row removed, or it ends up mapped to both at once -- exactly
// what findRoleTierConflict() exists to prevent, and would be rejected on
// the operator's NEXT submission even though this one created the
// violation), then adds every submitted (tier, roleId) pair. Callers must
// call findRoleTierConflict() first and reject on conflict -- this
// function assumes that's already been done and applies the mapping
// unconditionally.
export function applyGuildRoleMapping(db, guildId, { adminRoleIds = [], moderatorRoleIds = [], observerRoleIds = [] }) {
  const submitted = flattenSubmission({ adminRoleIds, moderatorRoleIds, observerRoleIds });

  for (const [tier, roleId] of submitted) {
    for (const otherTier of TIERS) {
      if (otherTier !== tier) removeGuildRole(db, guildId, otherTier, roleId);
    }
  }
  for (const [tier, roleId] of submitted) {
    addGuildRole(db, guildId, tier, roleId);
  }
}
