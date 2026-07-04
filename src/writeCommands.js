import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";

export const NOTIFICATION_COMMANDS = Object.freeze({
  SET_ALERT_CHANNEL: "notifications:set-alert-channel",
  SET_ALERT_THRESHOLD: "notifications:set-threshold",
  SET_DIGEST_SCHEDULE: "notifications:set-digest-schedule"
});

export function notificationCommandDefinitions(config) {
  if (!writesEnabled(config)) return [];
  return [
    { name: "set-alert-channel", action: NOTIFICATION_COMMANDS.SET_ALERT_CHANNEL, risk: "low" },
    { name: "set-alert-threshold", action: NOTIFICATION_COMMANDS.SET_ALERT_THRESHOLD, risk: "medium" },
    { name: "set-digest-schedule", action: NOTIFICATION_COMMANDS.SET_DIGEST_SCHEDULE, risk: "low" }
  ];
}

const IDEMPOTENCY_LOCK = new Map();

export async function executeNotificationCommand({ action, interaction, config }) {
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
      audit: writeAuditEvent({ actor: { userId: interaction.user?.id }, action, capability: action, idempotencyKey, result: "pending" })
    };
  } finally {
    setTimeout(() => IDEMPOTENCY_LOCK.delete(idempotencyKey), 300000);
  }
}
