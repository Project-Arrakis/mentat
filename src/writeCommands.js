import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";

export const SCHEDULE_COMMANDS = Object.freeze({
  SET_POST_SCHEDULE: "schedule:set-post-schedule",
  ADD_POST_CHANNEL: "schedule:add-channel",
  REMOVE_POST_CHANNEL: "schedule:remove-channel"
});

export function scheduleCommandDefinitions(config) {
  if (!writesEnabled(config)) return [];
  return [
    { name: "set-post-schedule", action: SCHEDULE_COMMANDS.SET_POST_SCHEDULE, risk: "low" },
    { name: "add-post-channel", action: SCHEDULE_COMMANDS.ADD_POST_CHANNEL, risk: "medium" },
    { name: "remove-post-channel", action: SCHEDULE_COMMANDS.REMOVE_POST_CHANNEL, risk: "medium" }
  ];
}

const IDEMPOTENCY_LOCK = new Map();

export async function executeScheduleCommand({ action, interaction, config }) {
  if (!writesEnabled(config)) throw new Error("Write commands are disabled.");
  if (!canWrite(interaction, config)) throw new Error("Not authorized for write operations.");
  const idempotencyKey = generateIdempotencyKey();
  if (IDEMPOTENCY_LOCK.has(idempotencyKey)) throw new Error("Duplicate request detected.");
  IDEMPOTENCY_LOCK.set(idempotencyKey, true);
  try {
    const confirmation = requireConfirmation({ action, target: interaction.channelId || "unknown", risk: "low" });
    return { ok: true, idempotencyKey, action, needsConfirmation: confirmation.needsConfirmation };
  } finally {
    setTimeout(() => IDEMPOTENCY_LOCK.delete(idempotencyKey), 300000);
  }
}
