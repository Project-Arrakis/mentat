import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";

export const WRITE_COMMAND_FAMILIES = Object.freeze({
  MAINTENANCE: {
    SET_NOTE: "maintenance:set-note",
    SET_WINDOW: "maintenance:set-window"
  },
  NOTIFICATIONS: {
    SET_ALERT_CHANNEL: "notifications:set-alert-channel",
    SET_ALERT_THRESHOLD: "notifications:set-threshold",
    SET_DIGEST_SCHEDULE: "notifications:set-digest-schedule"
  },
  SCHEDULE: {
    SET_POST_SCHEDULE: "schedule:set-post-schedule",
    ADD_POST_CHANNEL: "schedule:add-channel",
    REMOVE_POST_CHANNEL: "schedule:remove-channel"
  },
  OPERATIONAL: {
    CREATE_BACKUP: "operations:create-backup",
    RESTART_SERVICE: "operations:restart-service",
    TRIGGER_UPDATE: "operations:trigger-update",
    CLEAR_CACHE: "operations:clear-cache"
  }
});

export const WRITE_COMMAND_DEFINITIONS = [
  { name: "set-maintenance-note", family: "maintenance", action: "maintenance:set-note", risk: "low", tier: "admin" },
  { name: "set-maintenance-window", family: "maintenance", action: "maintenance:set-window", risk: "low", tier: "admin" },
  { name: "set-alert-channel", family: "notifications", action: "notifications:set-alert-channel", risk: "low", tier: "admin" },
  { name: "set-alert-threshold", family: "notifications", action: "notifications:set-threshold", risk: "medium", tier: "admin" },
  { name: "set-digest-schedule", family: "notifications", action: "notifications:set-digest-schedule", risk: "low", tier: "admin" },
  { name: "set-post-schedule", family: "schedule", action: "schedule:set-post-schedule", risk: "low", tier: "admin" },
  { name: "add-post-channel", family: "schedule", action: "schedule:add-channel", risk: "medium", tier: "admin" },
  { name: "remove-post-channel", family: "schedule", action: "schedule:remove-channel", risk: "medium", tier: "admin" },
  { name: "create-backup", family: "operational", action: "operations:create-backup", risk: "medium", tier: "owner" },
  { name: "restart-service", family: "operational", action: "operations:restart-service", risk: "high", tier: "owner" },
  { name: "trigger-update", family: "operational", action: "operations:trigger-update", risk: "high", tier: "owner" },
  { name: "clear-cache", family: "operational", action: "operations:clear-cache", risk: "medium", tier: "owner" }
];

const IDEMPOTENCY_LOCK = new Map();

export function activeWriteCommands(config) {
  if (!writesEnabled(config)) return [];
  return WRITE_COMMAND_DEFINITIONS.map((def) => ({
    ...def,
    disabled: false,
    available: true
  }));
}

export async function executeWriteCommand({ action, interaction, adapterClient, config, payload = {} }) {
  if (!writesEnabled(config)) throw new Error("Write commands are disabled. Set DUNE_DISCORD_WRITES_ENABLED=true.");
  if (!canWrite(interaction, config)) throw new Error("Not authorized for write operations.");

  const def = WRITE_COMMAND_DEFINITIONS.find((d) => d.action === action);
  if (!def) throw new Error(`Unknown write action: ${action}`);

  const idempotencyKey = generateIdempotencyKey();
  if (IDEMPOTENCY_LOCK.has(idempotencyKey)) throw new Error("Duplicate request detected.");
  IDEMPOTENCY_LOCK.set(idempotencyKey, true);

  try {
    const confirmation = requireConfirmation({
      action,
      target: String(interaction?.channelId || "unknown"),
      risk: def.risk
    });

    return {
      ok: true,
      idempotencyKey,
      action,
      needsConfirmation: confirmation.needsConfirmation,
      confirmationMessage: confirmation.message,
      family: def.family,
      risk: def.risk,
      tier: def.tier,
      audit: writeAuditEvent({
        actor: writeActorFromInteraction(interaction),
        action,
        capability: action,
        idempotencyKey,
        result: "pending",
        detail: { ...payload, family: def.family }
      })
    };
  } finally {
    setTimeout(() => IDEMPOTENCY_LOCK.delete(idempotencyKey), 300000);
  }
}

function writeActorFromInteraction(interaction) {
  return {
    userId: interaction?.user?.id,
    guildId: interaction?.guildId,
    channelId: interaction?.channelId,
    username: interaction?.user?.username
  };
}
