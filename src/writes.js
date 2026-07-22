import { randomUUID } from "node:crypto";

const WRITES_ENABLED_ENV = "DUNE_DISCORD_WRITES_ENABLED";
const WRITE_ADMIN_ROLE_ENV = "DISCORD_WRITE_ADMIN_ROLE_IDS";
const WRITE_OWNER_ROLE_ENV = "DISCORD_WRITE_OWNER_ROLE_IDS";

export function writesEnabled(config) {
  if (process.env[WRITES_ENABLED_ENV] === "true") return true;
  if (config?.discord?.writes?.enabled === true) return true;
  return false;
}

export function writeRoleIds(env = process.env) {
  return {
    admin: parseCsv(env[WRITE_ADMIN_ROLE_ENV]),
    owner: parseCsv(env[WRITE_OWNER_ROLE_ENV])
  };
}

// requiredTier is optional for backward compatibility with callers that have
// no per-command tier concept (e.g. broadcast.js). When provided as "admin"
// or "owner", enforces tier separation: an "admin" role may only perform
// "admin"-tier actions, never "owner"-tier ones. Without requiredTier, any
// write-admin or write-owner role passes (legacy/union behavior).
export function canWrite(interaction, config, requiredTier = null) {
  if (!writesEnabled(config)) return false;
  if (!interaction?.member?.roles) return false;

  const roleIds = extractRoleIds(interaction);
  const writeRoles = writeRoleIds();
  const isOwner = roleIds.some((r) => writeRoles.owner.includes(r));
  const isAdmin = roleIds.some((r) => writeRoles.admin.includes(r));

  if (requiredTier === "owner") return isOwner;
  if (requiredTier === "admin") return isAdmin || isOwner;

  return isAdmin || isOwner;
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
