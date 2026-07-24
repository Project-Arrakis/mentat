import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey } from "./writes.js";
import { recordAuditEvent } from "./auditLog.js";

// actorFieldsFromInteraction: local helper, matching writeHandler.js's
// own copy of this shape -- see that file's comment for why it's not
// imported from commands.js (circular import).
function actorFieldsFromInteraction(interaction) {
  return {
    guildId: interaction?.guildId || "",
    discordUserId: interaction?.user?.id || "",
    discordUsername: interaction?.user?.username || "",
    channelId: interaction?.channelId || ""
  };
}

export const BROADCAST_COMMAND = "broadcast";

const IDEMPOTENCY_LOCK = new Map();
const BROADCAST_COOLDOWN_MS = 60000;
const lastBroadcast = new Map();

export function broadcastEnabled(config) {
  return writesEnabled(config);
}

export function canBroadcast(interaction, config) {
  return canWrite(interaction, config);
}

export function checkBroadcastCooldown(userId, cooldownMs = BROADCAST_COOLDOWN_MS) {
  const now = Date.now();
  const last = lastBroadcast.get(userId) || 0;
  if (now - last < cooldownMs) return { allowed: false, remainingMs: cooldownMs - (now - last) };
  return { allowed: true, remainingMs: 0 };
}

export function applyBroadcastCooldown(userId) {
  lastBroadcast.set(userId, Date.now());
}

export function validateBroadcastMessage(message) {
  const raw = String(message || "").trim();
  if (raw.length < 1) throw new Error("Broadcast message is required.");
  if (raw.length > 500) throw new Error("Broadcast message must be 1-500 characters.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) throw new Error("Broadcast message must be printable characters.");
  return raw;
}

export async function executeBroadcast({
  interaction,
  adapterClient,
  config,
  userRequest,
  db = null
} = {}) {
  if (!broadcastEnabled(config)) {
    recordAuditEvent({
      db, ...actorFieldsFromInteraction(interaction),
      command: "admin:broadcast", action: "discord.broadcast", capability: "broadcast:disabled",
      result: "denied", detail: { reason: "writes_disabled" }
    });
    return { ok: false, error: "Broadcast command is disabled. Set DUNE_DISCORD_WRITES_ENABLED=true." };
  }

  if (!canBroadcast(interaction, config)) {
    recordAuditEvent({
      db, ...actorFieldsFromInteraction(interaction),
      command: "admin:broadcast", action: "discord.broadcast", capability: "broadcast:send",
      result: "denied", detail: { reason: "not_authorized" }
    });
    return { ok: false, error: "Not authorized. Broadcast requires moderator or admin role." };
  }

  const message = validateBroadcastMessage(userRequest);
  const idempotencyKey = generateIdempotencyKey();

  if (IDEMPOTENCY_LOCK.has(idempotencyKey)) {
    return { ok: false, error: "Duplicate broadcast request detected." };
  }
  IDEMPOTENCY_LOCK.set(idempotencyKey, true);

  const userId = interaction?.user?.id || "unknown";
  const cooldown = checkBroadcastCooldown(userId);
  if (!cooldown.allowed) {
    const secs = Math.ceil(cooldown.remainingMs / 1000);
    return { ok: false, error: `Broadcast cooldown active. Please wait ${secs}s.` };
  }

  try {
    const confirmation = requireConfirmation({
      action: "broadcast",
      target: `Send "${message}" to all players`,
      risk: "low"
    });

    applyBroadcastCooldown(userId);

    // Logged as "pending" (not "success") because sendBroadcastToAdapter()
    // -- the function that would actually deliver this to the adapter --
    // is never called anywhere in commands.js today (confirmed: it's
    // imported but unused). This function only ever gets as far as a
    // confirmation-required scaffold response, matching write:* commands'
    // own "pending-upstream" status.
    recordAuditEvent({
      db, ...actorFieldsFromInteraction(interaction),
      command: "admin:broadcast", action: "discord.broadcast", capability: "broadcast:send",
      idempotencyKey, result: "pending", detail: { message, confirmed: false }
    });

    return {
      ok: true,
      idempotencyKey,
      message,
      needsConfirmation: confirmation.needsConfirmation,
      confirmationMessage: confirmation.message
    };
  } finally {
    setTimeout(() => {
      IDEMPOTENCY_LOCK.delete(idempotencyKey);
    }, 300000);
  }
}

export async function sendBroadcastToAdapter({
  adapterClient,
  message,
  actor,
  idempotencyKey,
  config
} = {}) {
  if (!broadcastEnabled(config)) throw new Error("Broadcast disabled.");

  try {
    const response = await adapterClient.broadcast(actor, message, idempotencyKey);
    return { ok: true, response, idempotencyKey };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Broadcast failed.",
      idempotencyKey
    };
  }
}
