import { randomUUID } from "node:crypto";
import { tierAtLeast, multiTenantActorTier, isInteractionGuildOwner, resolveGuildOwnerId } from "./rbac.js";

const WRITES_ENABLED_ENV = "DUNE_DISCORD_WRITES_ENABLED";
const WRITE_ADMIN_ROLE_ENV = "DISCORD_WRITE_ADMIN_ROLE_IDS";
// Deprecated for granting owner-tier access (issue #238) -- owner is now
// derived exclusively from real Discord guild ownership, matching Core's
// tier1-upstream design. Still parsed (see writeRoleIds()) so canWrite() can
// fold it into the ADMIN-equivalent set for single-tenant back-compat,
// exactly like isAdminActor() already does in commands.js -- never used to
// reach the "owner" tier itself anymore.
const WRITE_OWNER_ROLE_ENV = "DISCORD_WRITE_OWNER_ROLE_IDS";

export function writesEnabled(config) {
  if (process.env[WRITES_ENABLED_ENV] === "true") return true;
  if (config?.discord?.writes?.enabled === true) return true;
  return false;
}

export function writeRoleIds(env = process.env) {
  return {
    admin: parseCsv(env[WRITE_ADMIN_ROLE_ENV]),
    // Kept as "owner" key for back-compat with existing callers/tests that
    // read this shape, but see the WRITE_OWNER_ROLE_ENV comment above --
    // canWrite() no longer treats membership in this list as owner-tier.
    owner: parseCsv(env[WRITE_OWNER_ROLE_ENV])
  };
}

// requiredTier is optional for backward compatibility with callers that have
// no per-command tier concept (e.g. broadcast.js). When provided as "admin"
// or "owner", enforces tier separation: an "admin" role may only perform
// "admin"-tier actions, never "owner"-tier ones. Without requiredTier, any
// admin-tier (or above) role passes (legacy/union behavior).
//
// Owner-tier access is ALWAYS decided by real Discord guild ownership
// (rbac.js's isGuildOwner), in every mode, never by a role -- matching
// Core's tier1-upstream design (issue #238). This runs before the
// multiTenant/single-tenant branch below because it's a live Discord fact,
// not per-guild or per-deployment config.
//
// Authorization source for admin/moderator/observer follows the deployment
// mode:
//   - multiTenant (db + guildId provided): the actor's tier is resolved
//     from that guild's guild_roles rows (legacy "owner" rows are ignored --
//     see rbac.js's multiTenantActorTier/resolveActorAuthTier).
//   - single-tenant: the existing DISCORD_WRITE_ADMIN_ROLE_IDS env var
//     (DISCORD_WRITE_OWNER_ROLE_IDS folds into the same admin-equivalent
//     set, not owner -- see the const's comment above).
// resolveGuildOwnerId/isInteractionGuildOwner now live in rbac.js (issue
// #238/#240 code-review finding) -- this file used to keep its own private
// duplicate of resolveGuildOwnerId because commands.js already imports FROM
// this file (a reverse import would have been circular), but rbac.js is a
// module both files already import from, so it's the one shared home for
// this logic instead of two independently-maintainable copies.
export function canWrite(interaction, config, requiredTier = null, db = null, guildId = null) {
  if (!writesEnabled(config)) return false;

  // Real guild ownership must be checked before ANY role-shaped guard below
  // (including the member.roles presence check) -- a code review caught
  // this running AFTER that guard in an earlier revision, which would have
  // denied the real owner whenever member.roles was falsy/missing, directly
  // contradicting this function's own "never by a role" guarantee.
  const threshold = requiredTier || "admin";
  if (isInteractionGuildOwner(interaction)) {
    return tierAtLeast("owner", threshold);
  }

  if (!interaction?.member?.roles) return false;
  const roleIds = extractRoleIds(interaction);

  if (config.multiTenant && db && guildId) {
    return tierAtLeast(multiTenantActorTier(interaction?.user?.id, resolveGuildOwnerId(interaction), db, guildId, roleIds), threshold);
  }

  const writeRoles = writeRoleIds();
  const isAdmin = roleIds.some((r) => writeRoles.admin.includes(r) || writeRoles.owner.includes(r));
  const actorTier = isAdmin ? "admin" : null;

  return tierAtLeast(actorTier, threshold);
}

export function generateIdempotencyKey() {
  return `dune-idem-${randomUUID()}`;
}

export function requireConfirmation({ action, target, risk = "low" }) {
  const message = [
    `**Confirm write action:** ${action}`,
    `Target: ${target}`,
    `Risk: ${risk}`,
    "",
    "Reply with `confirm` to execute, or `cancel` to abort."
  ].join("\n");
  return { message, needsConfirmation: true, action, target, risk };
}

export function isConfirmationResponse(content) {
  return String(content || "").toLowerCase().trim() === "confirm";
}

export function writeAuditEvent({ actor, action, capability, idempotencyKey, result, detail = {} }) {
  return {
    source: "discord-write",
    timestamp: new Date().toISOString(),
    actor: actor || {},
    action: String(action || ""),
    capability: String(capability || ""),
    idempotencyKey: String(idempotencyKey || ""),
    result: String(result || "unknown"),
    detail: { ...detail, writeEnabled: writesEnabled() }
  };
}

export function parseCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function extractRoleIds(interaction) {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles.map(String);
  if (roles.cache?.keys) return [...roles.cache.keys()];
  if (roles instanceof Set) return [...roles].map(String);
  return [];
}
