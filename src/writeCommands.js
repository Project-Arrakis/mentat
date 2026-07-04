import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";

export const MAINTENANCE_COMMANDS = Object.freeze({
  SET_NOTE: "maintenance:set-note",
  SET_WINDOW: "maintenance:set-window"
});

export function maintenanceCommandDefinitions(config) {
  if (!writesEnabled(config)) return [];
  return [
    {
      name: "maintenance-note",
      action: MAINTENANCE_COMMANDS.SET_NOTE,
      description: "Set a maintenance note (write). Disabled by default.",
      risk: "low"
    },
    {
      name: "maintenance-window",
      action: MAINTENANCE_COMMANDS.SET_WINDOW,
      description: "Set a maintenance window (write). Disabled by default.",
      risk: "low"
    }
  ];
}

const IDEMPOTENCY_LOCK = new Map();

export async function executeMaintenanceCommand({ action, interaction, adapterClient, config }) {
  if (!writesEnabled(config)) throw new Error("Write commands are disabled.");
  if (!canWrite(interaction, config)) throw new Error("Not authorized for write operations.");

  const idempotencyKey = generateIdempotencyKey();
  if (IDEMPOTENCY_LOCK.has(idempotencyKey)) throw new Error("Duplicate request detected.");
  IDEMPOTENCY_LOCK.set(idempotencyKey, true);

  try {
    const confirmation = requireConfirmation({ action, target: interaction.channelId || "unknown", risk: "low" });
    return {
      ok: true,
      idempotencyKey,
      action,
      needsConfirmation: confirmation.needsConfirmation,
      audit: writeAuditEvent({
        actor: { userId: interaction.user?.id, guildId: interaction.guildId, channelId: interaction.channelId },
        action,
        capability: action,
        idempotencyKey,
        result: "pending"
      })
    };
  } finally {
    setTimeout(() => IDEMPOTENCY_LOCK.delete(idempotencyKey), 300000);
  }
}
