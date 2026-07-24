// Write Command Handler — validates, confirms, audits write operations.
// All commands return "disabled" until DUNE_DISCORD_WRITES_ENABLED=true
// AND the upstream write-adapter contract is implemented.

import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey } from "./writes.js";
import { recordAuditEvent } from "./auditLog.js";

export const WRITE_COMMANDS = Object.freeze([
  // Maintenance (admin tier)
  { group: "write", name: "maintenance-note", action: "maintenance:set-note", risk: "low", tier: "admin",
    desc: "Set a maintenance note for operators.", params: [{ name: "note", type: "string", desc: "Maintenance note text", required: true, maxLength: 500 }] },
  { group: "write", name: "maintenance-window", action: "maintenance:set-window", risk: "low", tier: "admin",
    desc: "Set a maintenance window.", params: [
      { name: "start", type: "string", desc: "Start time (ISO 8601)", required: true },
      { name: "duration", type: "integer", desc: "Duration in minutes", required: true, min: 1, max: 1440 }] },

  // Notifications (admin tier)
  { group: "write", name: "alert-channel", action: "notifications:set-alert-channel", risk: "low", tier: "admin",
    desc: "Set the alert channel for readiness/service notifications.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "alert-threshold", action: "notifications:set-threshold", risk: "medium", tier: "admin",
    desc: "Set alert thresholds.", params: [
      { name: "metric", type: "string", desc: "Metric (readiness/services/population)", required: true },
      { name: "condition", type: "string", desc: "Condition (lt/gt/eq)", required: true },
      { name: "value", type: "integer", desc: "Threshold value", required: true }] },
  { group: "write", name: "digest-schedule", action: "notifications:set-digest-schedule", risk: "low", tier: "admin",
    desc: "Set the digest schedule interval.", params: [{ name: "minutes", type: "integer", desc: "Interval in minutes", required: true, min: 5, max: 1440 }] },

  // Schedule (admin tier)
  { group: "write", name: "post-schedule", action: "schedule:set-post-schedule", risk: "low", tier: "admin",
    desc: "Set the scheduled post type.", params: [{ name: "type", type: "string", desc: "status/status-summary/readiness/services/none", required: true }] },
  { group: "write", name: "add-channel", action: "schedule:add-channel", risk: "medium", tier: "admin",
    desc: "Add a channel for scheduled posts.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "remove-channel", action: "schedule:remove-channel", risk: "medium", tier: "admin",
    desc: "Remove a channel from scheduled posts.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },

  // Operational (owner tier)
  { group: "write", name: "backup", action: "operations:create-backup", risk: "medium", tier: "owner",
    desc: "Create a database backup.", params: [{ name: "label", type: "string", desc: "Backup label", required: true, maxLength: 100 }] },
  { group: "write", name: "restart", action: "operations:restart-service", risk: "high", tier: "owner",
    desc: "Restart a game service.", params: [
      { name: "service", type: "string", desc: "Service name (gateway/survival-1/overmap)", required: true },
      { name: "reason", type: "string", desc: "Reason for restart", required: true, maxLength: 200 }] },
  { group: "write", name: "update", action: "operations:trigger-update", risk: "high", tier: "owner",
    desc: "Trigger a game or server update.", params: [{ name: "type", type: "string", desc: "Update type (game/steamcmd/self)", required: true }] },
  { group: "write", name: "cache", action: "operations:clear-cache", risk: "medium", tier: "owner",
    desc: "Clear server caches.", params: [{ name: "type", type: "string", desc: "Cache type (steam/maps/derived)", required: true }] },
]);

// actorFieldsFromInteraction: local helper so this file doesn't need to
// import commands.js's actorFromInteraction() (which would create a
// circular import -- commands.js imports handleWriteCommand FROM this
// file). Field names deliberately match writes.js's writeAuditEvent()
// actor shape / recordAuditEvent()'s expected fields.
function actorFieldsFromInteraction(interaction) {
  return {
    guildId: interaction?.guildId || "",
    discordUserId: interaction?.user?.id || "",
    discordUsername: interaction?.user?.username || "",
    channelId: interaction?.channelId || ""
  };
}

export async function handleWriteCommand({ subcommand, interaction, adapterClient, config, db = null }) {
  const key = `write:${subcommand}`;

  if (!writesEnabled(config)) {
    recordAuditEvent({
      db, ...actorFieldsFromInteraction(interaction),
      command: key, action: `write:${subcommand}`, capability: "write:disabled",
      result: "denied", detail: { reason: "writes_disabled" }
    });
    return { ok: false, error: "Write commands are disabled. Set DUNE_DISCORD_WRITES_ENABLED=true.", disabled: true };
  }

  const def = WRITE_COMMANDS.find(c => c.name === subcommand);
  if (!def) {
    recordAuditEvent({
      db, ...actorFieldsFromInteraction(interaction),
      command: key, action: `write:${subcommand}`, capability: "write:unknown",
      result: "failed", detail: { reason: "unknown_command" }
    });
    return { ok: false, error: `Unknown write command: ${subcommand}` };
  }

  if (!canWrite(interaction, config)) {
    recordAuditEvent({
      db, ...actorFieldsFromInteraction(interaction),
      command: key, action: def.action, capability: def.tier,
      result: "denied", detail: { reason: "not_authorized", tier: def.tier }
    });
    return { ok: false, error: "Not authorized for write operations. Requires write-admin or write-owner role." };
  }

  const idempotencyKey = generateIdempotencyKey();
  const confirmation = requireConfirmation({ action: def.action, target: def.tier, risk: def.risk });

  // Logged as "pending" (not "success") because handleWriteCommand()
  // never actually executes the underlying action yet -- it returns a
  // scaffolded confirmation-required response and stops there, awaiting
  // upstream write-adapter contract implementation (see this file's
  // module comment). This is intentional per
  // docs/additional-features-roadmap.md's R2.x-FEAT-8 Note: audit the
  // ATTEMPT now so this is already correct once these commands start
  // actually executing.
  recordAuditEvent({
    db, ...actorFieldsFromInteraction(interaction),
    command: key, action: def.action, capability: def.tier, idempotencyKey,
    result: "pending", detail: { risk: def.risk, tier: def.tier, status: "pending-upstream" }
  });

  return {
    ok: true,
    action: def.action,
    tier: def.tier,
    risk: def.risk,
    idempotencyKey,
    needsConfirmation: true,
    confirmationMessage: confirmation.message,
    status: "pending-upstream",
    message: "Write command scaffolded. Awaiting upstream write-adapter contract implementation."
  };
}
