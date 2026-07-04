import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";

export const OPERATIONAL_COMMANDS = Object.freeze({
  CREATE_BACKUP: "operations:create-backup",
  RESTART_SERVICE: "operations:restart-service",
  TRIGGER_UPDATE: "operations:trigger-update",
  CLEAR_CACHE: "operations:clear-cache"
});

export function operationalCommandDefinitions(config) {
  if (!writesEnabled(config)) return [];
  return [
    { name: "create-backup", action: OPERATIONAL_COMMANDS.CREATE_BACKUP, risk: "medium", requiresOwner: false },
    { name: "restart-service", action: OPERATIONAL_COMMANDS.RESTART_SERVICE, risk: "high", requiresOwner: false },
    { name: "trigger-update", action: OPERATIONAL_COMMANDS.TRIGGER_UPDATE, risk: "high", requiresOwner: true },
    { name: "clear-cache", action: OPERATIONAL_COMMANDS.CLEAR_CACHE, risk: "medium", requiresOwner: false }
  ];
}

const IDEMPOTENCY_LOCK = new Map();

export async function executeOperationalCommand({ action, interaction, config }) {
  if (!writesEnabled(config)) throw new Error("Write commands are disabled.");
  if (!canWrite(interaction, config)) throw new Error("Not authorized for write operations.");
  const idempotencyKey = generateIdempotencyKey();
  if (IDEMPOTENCY_LOCK.has(idempotencyKey)) throw new Error("Duplicate request detected.");
  IDEMPOTENCY_LOCK.set(idempotencyKey, true);
  try {
    const confirmation = requireConfirmation({ action, target: interaction.channelId || "unknown", risk: "high" });
    return { ok: true, idempotencyKey, action, needsConfirmation: confirmation.needsConfirmation };
  } finally {
    setTimeout(() => IDEMPOTENCY_LOCK.delete(idempotencyKey), 600000);
  }
}
