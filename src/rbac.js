// rbac.js — unified, cross-surface, tiered role model.
//
// Single source of truth for the four role tiers the bot and the Core
// console both enforce, using the SAME derivation method for each
// (unified 2026-09-05, issue #238 — see resolveActorAuthTier below;
// previously this comment said "eventually" because the two surfaces
// disagreed on how "owner" was decided):
//
//   player (DB value: "observer") < moderator < admin < owner
//
//   player/observer: read-only command access (equivalence decided
//     with the console RBAC planning session — "player role == observer").
//   moderator: between read-only player and full admin; reserved for
//     commands that are more than read-only but less than administrative.
//   admin: administrative commands (doctor, cooldowns, roles viewer, ...).
//   owner: owner-tier write actions (backups, restarts, updates) via
//     canWrite(requiredTier="owner"). Derived EXCLUSIVELY from real Discord
//     guild ownership (isGuildOwner below) — never from a role mapping,
//     matching Core's tier1-upstream design (rfc-console-auth.md sec2.1.1).
//
// The database's guild_roles.role_type values are "observer", "moderator",
// "admin", "owner" (CHECK-constrained — see database.js) for HISTORICAL
// reasons only: "owner" rows can still exist (pre-unification installs)
// but are never consulted for authorization — see resolveActorAuthTier.
// "player" is a user-facing label mapped 1:1 onto "observer" (see
// ROLE_TYPE_LABELS), so no schema change or data migration was required
// to speak the unified model.
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

// true when actorId is the real Discord guild owner. This is the ONLY path
// that may ever produce the "owner" tier — see resolveActorAuthTier below.
// Mirrors Core's tier1-upstream design (rfc-console-auth.md sec 2.1.1:
// owner "never from a role") so the bot and Core console cannot disagree
// about who holds owner-tier access for the same Discord member. Unlike
// Core (a website with no bot presence in the guild, so it must ask
// Discord's OAuth API for `guild.owner`), this bot already has a live
// gateway connection (GatewayIntentBits.Guilds) and receives `guildOwnerId`
// as part of every interaction's guild object — no extra API call needed.
export function isGuildOwner(actorId, guildOwnerId) {
  return actorId != null && guildOwnerId != null && String(actorId) === String(guildOwnerId);
}

// resolveGuildOwnerId: single source of truth for "who does Discord say owns
// this guild" from an interaction (issue #238 code-review finding). Prefers
// the live, already-cached interaction.guild.ownerId, but falls back to the
// bot's own client-wide guild cache (interaction.client.guilds.cache) via
// guildId when interaction.guild is null/uncached -- a real, reachable gap
// during a gateway reconnect or a guild-unavailable window, where
// interaction.guildId is still populated but interaction.guild is not.
// Lives here, not commands.js, so writes.js can import it directly instead
// of keeping its own private duplicate (a second code-review finding on
// issue #238/#240 -- commands.js already imports FROM writes.js, so writes.js
// importing a commands.js-owned copy back would be circular; this module is
// the one place both already import from).
export function resolveGuildOwnerId(interaction) {
  if (interaction?.guild?.ownerId) return interaction.guild.ownerId;
  const guildId = interaction?.guildId;
  if (!guildId) return undefined;
  return interaction?.client?.guilds?.cache?.get(guildId)?.ownerId;
}

// isInteractionGuildOwner: every gating call site (isCommandAllowed,
// isAdminActor in commands.js, canWrite in writes.js, executeDuneCommand's
// zero-role gate) uses this ONE function rather than re-deriving
// isGuildOwner(interaction.user?.id, interaction.guild?.ownerId) inline --
// centralizing both the ownership check and the reconnect-window fallback
// above, per issue #238's own code-review finding that duplicated copies of
// this exact check had already drifted once (a role-shaped guard running
// ahead of it in one of three copies).
export function isInteractionGuildOwner(interaction) {
  return isGuildOwner(interaction?.user?.id, resolveGuildOwnerId(interaction));
}

// The actual authorization-facing tier resolver — every RBAC/write call site
// should use this, not dbActorTier directly, so "owner" can never be reached
// via a role mapping. `roles` may still contain legacy role_type="owner"
// rows (pre-unification installs that used the old, now-removed "Owner
// Role" setup field) — those rows are deliberately excluded from the
// role-tier fallback below; they're inert, not deleted. The one-time
// operator-facing notice about a stale row lives inline in commands.js's
// rolesConfigPayload() (a plain `.filter(r => r.role_type === "owner")`),
// not as a named export here.
export function resolveActorAuthTier({ actorId, guildOwnerId, roleIds, roles }) {
  if (isGuildOwner(actorId, guildOwnerId)) return "owner";
  const nonOwnerRoles = (roles || []).filter((row) => row.role_type !== "owner");
  return dbActorTier(roleIds, nonOwnerRoles);
}

// Multi-tenant convenience wrapper: every multi-tenant call site
// (isCommandAllowed/isAdminActor in commands.js, canWrite in writes.js) was
// hand-building the same { actorId, guildOwnerId, roleIds, roles } object
// for resolveActorAuthTier — a code review flagged that duplication as the
// root cause of a real ordering bug (canWrite checking a role-shaped guard
// before guild ownership in one of the three copies). Centralizing the
// DB/guild lookup here doesn't eliminate every call site (each still has
// its own single-tenant branch that never reaches this function at all),
// but it removes the one part that was actually copy-pasted three times.
//
// Takes actorId/guildOwnerId as already-resolved values, not a raw
// `interaction`, on purpose: a second code-review finding showed that
// deriving guildOwnerId from a bare `interaction.guild?.ownerId` here (or
// anywhere) misses the real, reachable case where interaction.guild is
// null/uncached (a gateway reconnect or guild-unavailable window) but
// interaction.guildId is still populated — every caller already resolves
// guildOwnerId once, with that fallback, via commands.js's/writes.js's own
// resolveGuildOwnerId(interaction); this function must not silently
// re-derive a weaker value that bypasses it.
export function multiTenantActorTier(actorId, guildOwnerId, db, guildId, roleIds) {
  return resolveActorAuthTier({
    actorId,
    guildOwnerId,
    roleIds,
    roles: getGuildRoles(db, guildId)
  });
}
