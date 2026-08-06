// rbac.js — unified, cross-surface, tiered role model.
//
// Single source of truth for the four role tiers the bot and (eventually)
// the Core console both enforce:
//
//   player (DB value: "observer") < moderator < admin < owner
//
//   player/observer: read-only command access (equivalence decided
//     with the console RBAC planning session — "player role == observer").
//   moderator: between read-only player and full admin; reserved for
//     commands that are more than read-only but less than administrative.
//   admin: administrative commands (doctor, cooldowns, roles viewer, ...).
//   owner: owner-tier write actions (backups, restarts, updates) via
//     canWrite(requiredTier="owner").
//
// The database's guild_roles.role_type values are "observer", "moderator",
// "admin", "owner" (CHECK-constrained — see database.js). "player" is a
// user-facing label mapped 1:1 onto "observer" (see ROLE_TYPE_LABELS), so
// no schema change or data migration is required to speak the unified model.
//
// This module deliberately contains only pure logic and imports only
// database.js's role lookup. It must NOT import commands.js or writes.js —
// those modules import helpers from here, so importing them in return
// would create a circular dependency.

import { getGuildRoles } from "./database.js";

export const TIERS = Object.freeze(["observer", "moderator", "admin", "owner"]);
export const TIER_RANK = Object.freeze({ observer: 0, moderator: 1, admin: 2, owner: 3 });

// User-facing labels for the raw DB role_type values. "player" is the
// accepted name for the "observer" tier (see module header).
export const ROLE_TYPE_LABELS = Object.freeze({
  observer: "player",
  moderator: "moderator",
  admin: "admin",
  owner: "owner"
});

// true if the actor's resolved tier meets or exceeds the required tier.
// A null/unknown tier never satisfies any requirement (fail closed).
export function tierAtLeast(tier, requiredTier) {
  if (tier == null || !(tier in TIER_RANK) || !(requiredTier in TIER_RANK)) return false;
  return TIER_RANK[tier] >= TIER_RANK[requiredTier];
}

// Highest DB tier among the guild_roles rows whose role_id the actor holds.
// roles are the { role_type, role_id } rows getGuildRoles(db, guildId)
// returns. Returns null when the actor matches no configured role.
export function dbActorTier(roleIds, roles) {
  let best = null;
  for (const row of roles || []) {
    if (!(row.role_type in TIER_RANK)) continue;
    if (roleIds.includes(row.role_id) && (best == null || TIER_RANK[row.role_type] > TIER_RANK[best])) {
      best = row.role_type;
    }
  }
  return best;
}

// Convenience: resolve an actor's tier straight from the DB for a given
// guild. Returns null when the guild has no configured roles matching the
// actor, or when db/guildId are absent (callers that need env-only
// behavior should not call this — see writes.js's canWrite()).
export function resolveDbActorTier(roleIds, db, guildId) {
  if (!db || !guildId) return null;
  return dbActorTier(roleIds, getGuildRoles(db, guildId));
}
