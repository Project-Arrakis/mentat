import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";

export const BROADCAST_COMMAND = "broadcast";

const IDEMPOTENCY_LOCK = new Map();
const BROADCAST_COOLDOWN_MS = 60000;
const lastBroadcast = new Map();

export function broadcastEnabled(config) {
  return writesEnabled(config);
}

export function canBroadcast(interaction, config, db = null, guildId = null) {
  return canWrite(interaction, config, null, db, guildId);
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
  guildId = null,
  db = null
} = {}) {
  if (!broadcastEnabled(config)) {
    return { ok: false, error: "Broadcast command is disabled. Set DUNE_DISCORD_WRITES_ENABLED=true." };
  }

  if (!canBroadcast(interaction, config, db, guildId)) {
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

    const auditEvent = writeAuditEvent({
      actor: {
        userId: interaction?.user?.id,
        guildId: interaction?.guildId,
        channelId: interaction?.channelId,
        username: interaction?.user?.username
      },
      action: "discord.broadcast",
      capability: "broadcast:send",
      idempotencyKey,
      result: "pending",
      detail: { message, confirmed: false }
    });

    return {
      ok: true,
      idempotencyKey,
      message,
      needsConfirmation: confirmation.needsConfirmation,
      confirmationMessage: confirmation.message,
      audit: auditEvent
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
  guildId,
  config
} = {}) {
  if (!broadcastEnabled(config)) throw new Error("Broadcast disabled.");

  try {
    // AdapterClient.broadcast(actor, message, guildId) — the "broadcast"
    // route is currently PLANNED upstream (see adapterClient.js LIVE_ROUTES
    // vs PLANNED_ROUTES) and has no idempotency-key parameter yet; the key is
    // still returned to the caller for audit/logging until the adapter
    // contract supports passing it through.
    const response = await adapterClient.broadcast(actor, message, guildId);
    return { ok: true, response, idempotencyKey };
  } catch (error) {
    return {
      ok: false,
      error: error.message || "Broadcast failed.",
      idempotencyKey
    };
  }
}
