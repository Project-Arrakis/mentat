// Write Confirmation UI — builds the Discord button-based confirmation prompt
// described in docs/rw-confirmation-flow.md and routes the resulting button
// interactions.
//
// IMPORTANT SAFETY BOUNDARY: confirming a write action here NEVER calls
// adapterClient.writePreview() or adapterClient.writeExecute(). Those routes
// are listed in MISSING_ROUTES (src/adapterClient.js) because no upstream
// write-capable adapter contract has been published or approved yet
// (see docs/upstream-write-adapter-rfc.md and docs/r1-r2-release-roadmap.md,
// which explicitly blocks "write adapter execution calls" until that happens).
// Clicking Confirm here only reports the same "scaffolded, awaiting upstream
// contract" status that src/writeHandler.js already returns for the initial
// command — it makes the confirmation step real without making the write
// real. Do not wire writePreview()/writeExecute() into this module until the
// project's R2 entry criteria are met.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { duneEmbed } from "./embedFormat.js";
import { writeAuditEvent } from "./writes.js";

const DEFAULT_CONFIRMATION_TIMEOUT_MS = 60000;
const CUSTOM_ID_PREFIX = "write";

export function confirmationTimeoutMs() {
  const parsed = Number.parseInt(process.env.DUNE_WRITE_CONFIRMATION_TIMEOUT_MS || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CONFIRMATION_TIMEOUT_MS;
}

// Kept for backward-compat/documentation reference (docs/rw-confirmation-flow.md
// describes a 60s window); prefer confirmationTimeoutMs() for the effective value.
export const CONFIRMATION_TIMEOUT_MS = DEFAULT_CONFIRMATION_TIMEOUT_MS;

// idempotencyKey -> { action, tier, risk, userId, expiresAt, timer }
const pendingConfirmations = new Map();

export function buildConfirmationRow(idempotencyKey) {
  const confirm = new ButtonBuilder()
    .setCustomId(`${CUSTOM_ID_PREFIX}:confirm:${idempotencyKey}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);

  const cancel = new ButtonBuilder()
    .setCustomId(`${CUSTOM_ID_PREFIX}:cancel:${idempotencyKey}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(confirm, cancel);
}

export function buildConfirmationEmbed({ action, tier, risk, target }) {
  return duneEmbed({
    title: "⚠️ Confirm Write Action",
    color: "warning",
    description: "This will be visible to operators. Nothing has been executed yet.",
    fields: [
      { name: "Action", value: `\`${action}\``, inline: true },
      { name: "Tier", value: `\`${tier}\``, inline: true },
      { name: "Risk", value: `\`${risk}\``, inline: true },
      ...(target ? [{ name: "Target", value: String(target).slice(0, 1024) }] : [])
    ]
  });
}

export function buildCancelledEmbed(reason = "cancelled") {
  const label = reason === "timeout" ? "Cancelled (timeout)" : "Cancelled";
  return duneEmbed({ title: `🚫 ${label}`, color: "error", description: "No write action was executed." });
}

export function buildScaffoldedEmbed({ action }) {
  return duneEmbed({
    title: "🛑 Write Not Executed",
    color: "warning",
    description: [
      `Action \`${action}\` was confirmed, but write execution is not implemented.`,
      "",
      "This bot has no upstream write-capable adapter contract yet. See " +
        "`docs/upstream-write-adapter-rfc.md` and `docs/r1-r2-release-roadmap.md`. " +
        "No server state was changed."
    ].join("\n")
  });
}

export function buildUnauthorizedEmbed() {
  return duneEmbed({ title: "🔒 Not Authorized", color: "error", description: "You are no longer authorized to confirm this action." });
}

export function buildNotYoursEmbed() {
  return duneEmbed({ title: "🔒 Not Your Confirmation", color: "error", description: "This confirmation prompt belongs to another user." });
}

export function buildExpiredEmbed() {
  return duneEmbed({ title: "⌛ Confirmation Expired", color: "error", description: "Re-run the command to try again." });
}

// Registers a pending confirmation and schedules its timeout. Returns the
// row/embed pair the caller should send alongside the initial write reply.
//
// mentat#331: userId is now REQUIRED, not optional. handleWriteButtonInteraction()
// below only enforces "this button belongs to you" when entry.userId is
// truthy (`if (entry.userId && interaction.user?.id !== entry.userId)`) --
// a caller that omitted it would silently let ANY guild member who can see
// a non-ephemeral confirmation button confirm someone else's pending write.
// Today's sole caller always passes it correctly, but dune-awakening-selfhost-docker's
// hosted-bot auto-invite design (issue #844 on that repo) proposes reusing
// this exact pattern as its load-bearing, "unforgeable" owner-confirmation
// gate -- failing closed here, structurally, removes the possibility of
// that reuse silently losing this property.
export function createPendingConfirmation({ idempotencyKey, action, tier, risk, target, userId, onTimeout }) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("createPendingConfirmation: userId is required -- a confirmation with no bound owner would be confirmable by anyone.");
  }
  const timeoutMs = confirmationTimeoutMs();
  const expiresAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => {
    const entry = pendingConfirmations.get(idempotencyKey);
    pendingConfirmations.delete(idempotencyKey);
    if (entry && typeof onTimeout === "function") onTimeout(entry);
  }, timeoutMs);
  timer.unref?.();

  pendingConfirmations.set(idempotencyKey, { action, tier, risk, target, userId, expiresAt, timer });

  return {
    embed: buildConfirmationEmbed({ action, tier, risk, target }),
    row: buildConfirmationRow(idempotencyKey)
  };
}

export function getPendingConfirmation(idempotencyKey) {
  return pendingConfirmations.get(idempotencyKey);
}

export function clearPendingConfirmation(idempotencyKey) {
  const entry = pendingConfirmations.get(idempotencyKey);
  if (entry?.timer) clearTimeout(entry.timer);
  pendingConfirmations.delete(idempotencyKey);
  return entry;
}

export function pendingConfirmationCount() {
  return pendingConfirmations.size;
}

// Test-only reset hook (mirrors resetCooldowns()/resetAlerts() elsewhere).
export function resetPendingConfirmations() {
  for (const entry of pendingConfirmations.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pendingConfirmations.clear();
}

// Routes a button interaction for the write confirmation flow. Returns false
// if the interaction does not belong to this flow (caller should ignore it).
export async function handleWriteButtonInteraction(interaction) {
  if (!interaction?.isButton?.()) return false;
  const parts = String(interaction.customId || "").split(":");
  if (parts[0] !== CUSTOM_ID_PREFIX) return false;

  const [, action, idempotencyKey] = parts;
  const entry = getPendingConfirmation(idempotencyKey);

  if (!entry) {
    await interaction.update({ embeds: [buildExpiredEmbed()], components: [] });
    return true;
  }

  // mentat#331: fail closed unconditionally, not just "if entry.userId is
  // set" -- an entry with no bound owner must never be treated as
  // confirmable by whoever happens to click it. createPendingConfirmation()
  // now refuses to create such an entry at all, but this check stays
  // unconditional as defense in depth against any future caller that
  // bypasses it.
  if (interaction.user?.id !== entry.userId) {
    await interaction.reply({ embeds: [buildNotYoursEmbed()], ephemeral: true });
    return true;
  }

  if (action === "cancel") {
    clearPendingConfirmation(idempotencyKey);
    await interaction.update({
      embeds: [buildCancelledEmbed("cancelled")],
      components: []
    });
    return true;
  }

  if (action === "confirm") {
    clearPendingConfirmation(idempotencyKey);
    // See module header: confirming never calls writePreview()/writeExecute().
    await interaction.update({
      embeds: [buildScaffoldedEmbed({ action: entry.action })],
      components: []
    });
    return true;
  }

  return false;
}

export function writeTimeoutAuditEvent(entry, idempotencyKey) {
  return writeAuditEvent({
    actor: { userId: entry.userId },
    action: entry.action,
    capability: entry.action,
    idempotencyKey,
    result: "timeout",
    detail: { tier: entry.tier, risk: entry.risk }
  });
}
