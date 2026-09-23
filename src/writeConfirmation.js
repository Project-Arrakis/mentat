// Write Confirmation UI — builds the Discord button-based confirmation
// prompt and routes the resulting button interactions to Core's real
// write/execute (see docs/design/write-command-reconciliation-l1-design-2026-09-22.md).
// Two exceptions never call Core at all: a LEGACY stub entry (the
// isLegacyStub branch below, still 9 live WRITE_COMMANDS entries) just
// returns buildScaffoldedEmbed()'s "awaiting upstream contract" response,
// and bot.self-update (see writeSelfUpdate.js), which is gated by a
// dedicated host-operator identity check, not the generic per-guild tier
// system every other command uses.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { duneEmbed } from "./embedFormat.js";
import { writeAuditEvent } from "./writes.js";
import { buildWriteErrorEmbed, mapWriteError } from "./writeErrorMapping.js";
import { actorFromInteraction } from "./rbac.js";

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

// [Audit fix: UI/UX, HIGH] the design promised a rendered expiry countdown;
// the real function never accepted or rendered `expiresAt` at all.
export function buildConfirmationEmbed({ action, tier, risk, target, expiresAt, confirmPhrase, extraWarning }) {
  const fields = [
    { name: "Action", value: `\`${action}\``, inline: true },
    { name: "Tier", value: `\`${tier}\``, inline: true },
    { name: "Risk", value: `\`${risk}\``, inline: true },
    ...(target ? [{ name: "Target", value: String(target).slice(0, 1024) }] : []),
    ...(expiresAt ? [{ name: "Expires", value: `<t:${Math.floor(expiresAt / 1000)}:R>` }] : []),
    ...(confirmPhrase ? [{ name: "Type to confirm", value: `\`${confirmPhrase}\`` }] : []),
    ...(extraWarning ? [{ name: "⚠️ Warning", value: extraWarning }] : [])
  ];
  return duneEmbed({
    title: "⚠️ Confirm Write Action",
    color: "warning",
    description: "This will be visible to operators. Nothing has been executed yet.",
    fields
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

// [Audit fix: Architect, HIGH] Real and self-update confirmations, unlike
// the legacy stub flow, previously had no expiry timer at all -- an
// unclicked one sat in the shared Map forever. Every kind now gets a
// scheduled cleanup, matching the legacy flow's own existing pattern.
//
// [Audit fix: UI/UX, CRITICAL round 3] This signature previously did NOT
// destructure or store `secondConfirmationPending` at all -- Task 5 Step 3
// calls this SAME function with `secondConfirmationPending: true` when
// re-registering after Core's 202, but a plain object-destructuring
// parameter silently drops any property not named here. The stored entry
// never actually carried the flag, `entry.secondConfirmationPending` read
// `undefined` forever, and the entire ownership-gate exception in Task 5
// Step 3 (which branches on exactly that field) could never fire -- a
// FOURTH structural reason a second admin could never complete a dual
// confirmation, on top of the three Round 2 already found and fixed.
export function registerRealPendingConfirmation({ nonce, action, tier, userId, expiresAt, confirmPhrase, kind, secondConfirmationPending = false }) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("registerRealPendingConfirmation: userId is required.");
  }
  const timer = setTimeout(() => { pendingConfirmations.delete(nonce); }, Math.max(0, expiresAt - Date.now()));
  timer.unref?.();
  pendingConfirmations.set(nonce, { action, tier, userId, expiresAt, confirmPhrase, kind, timer, isReal: true, secondConfirmationPending });
  return nonce;
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
export async function handleWriteButtonInteraction(interaction, adapterClient) {
  if (!interaction?.isButton?.()) return false;
  const raw = String(interaction.customId || "");
  const firstColon = raw.indexOf(":");
  const secondColon = firstColon === -1 ? -1 : raw.indexOf(":", firstColon + 1);
  if (firstColon === -1 || secondColon === -1) return false;
  const prefix = raw.slice(0, firstColon);
  const action = raw.slice(firstColon + 1, secondColon);
  const idempotencyKey = raw.slice(secondColon + 1); // everything after the second colon, verbatim -- may itself contain colons
  if (prefix !== CUSTOM_ID_PREFIX) return false;
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
  //
  // [Audit fix: UI/UX, CRITICAL, round 2] a dual-confirmation action's
  // SECOND step is expected to be clicked by a genuinely different admin
  // than the one who registered the pending entry -- the plain "not yours"
  // rejection below must not fire for that specific case.
  const isDualConfirmSecondStep = entry.secondConfirmationPending === true;
  if (interaction.user?.id !== entry.userId) {
    if (!isDualConfirmSecondStep) {
      // Normal case: a nonce belongs to exactly the actor who requested it.
      await interaction.reply({ embeds: [buildNotYoursEmbed()], ephemeral: true });
      return true;
    }
    // A genuinely different admin clicking a dual-confirmation's SECOND
    // step is exactly the expected, correct case -- fall through. Every
    // reference to "the actor" from this point on must use THIS
    // interaction's own real, current identity (actorFromInteraction),
    // never entry.userId (the FIRST admin) -- see the confirm branch below.
  } else if (isDualConfirmSecondStep) {
    // The SAME admin who gave the first confirmation cannot also give the
    // second -- reject client-side, mirroring Core's own
    // second_confirmation_same_actor check, per the design's own stated
    // requirement (never actually implemented until this fix).
    await interaction.reply({
      embeds: [duneEmbed({ title: "🔒 A Different Administrator Is Required", color: "error", description: "You already provided the first confirmation. A different, owner-tier administrator must provide the second one by clicking this same button." })],
      ephemeral: true
    });
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
    const isSelfUpdate = entry.action === "bot.self-update";
    // [Audit fix: Security/Architect, MEDIUM round 3] entries created by
    // the OLD, untouched createPendingConfirmation() (writeHandler.js's
    // restored LEGACY_WRITE_STUBS branch, Task 4 Step 7) carry no `kind`
    // field at all -- only registerRealPendingConfirmation() (real/
    // self-update paths) sets one. Without this check, a legacy stub's
    // confirm click would fall through to the "real" branch below and
    // call adapterClient.writeExecute() with a bogus, never-registered
    // Core action name (e.g. "maintenance:set-note"), producing a
    // confusing Core-side error instead of the intended, harmless
    // scaffolded response this subcommand has always returned.
    const isLegacyStub = !entry.kind;
    clearPendingConfirmation(idempotencyKey);

    if (isLegacyStub) {
      await interaction.update({ embeds: [buildScaffoldedEmbed({ action: entry.action })], components: [] });
      return true;
    }

    if (isSelfUpdate) {
      const { runSelfUpdate } = await import("./writeSelfUpdate.js");
      console.log(JSON.stringify(writeAuditEvent({ actor: actorFromInteraction(interaction), action: entry.action, capability: entry.action, idempotencyKey, result: "confirmed" })));
      await interaction.update({ embeds: [duneEmbed({ title: "🔄 Self-Update Starting", color: "warning", description: "Restarting on the latest deployed code. I'll post the result here once it's done." })], components: [] });
      runSelfUpdate({ interactionToken: interaction.token, applicationId: interaction.applicationId, channelId: interaction.channelId });
      return true;
    }

    // [Audit fix: UI/UX, CRITICAL, round 2] the actual, current clicker's
    // real actor payload -- roleIds/guildId/channelId/username, everything
    // actorSignature.js's real HMAC signing needs -- built via the bot's
    // own existing, already-correct helper. Using entry.userId (the
    // ORIGINAL admin, captured at registration) here was the second of
    // three structural reasons dual-confirmation could never complete:
    // Core would see the same actor identity on both calls regardless of
    // who physically clicked, and reject the second one itself.
    const actor = actorFromInteraction(interaction);
    try {
      const result = await adapterClient.writeExecute(actor, { nonce: idempotencyKey, action: entry.action });
      if (result?.code === "second_confirmation_required") {
        // Re-register the SAME nonce, marking it pending a second,
        // different confirmer -- entry.userId stays the FIRST admin's ID
        // (needed so the ownership-gate logic above can tell them apart
        // from whoever clicks next), and secondConfirmationPending is what
        // actually enables that gate's exception. Previously referenced
        // but never set anywhere -- dead code, closed here.
        registerRealPendingConfirmation({ nonce: idempotencyKey, action: entry.action, tier: entry.tier, userId: entry.userId, expiresAt: result.expiresAt, kind: "real", secondConfirmationPending: true });
        await interaction.update({
          embeds: [duneEmbed({ title: "⏳ Waiting on a Second Administrator", color: "warning", description: "Your confirmation was accepted. A second, different owner-tier admin must click **Confirm** on this same message to complete it." })],
          components: [buildConfirmationRow(idempotencyKey)],
          ephemeral: false
        });
        return true;
      }
      console.log(JSON.stringify(writeAuditEvent({ actor, action: entry.action, capability: entry.action, idempotencyKey, result: "executed" })));
      await interaction.update({
        embeds: [duneEmbed({ title: "✅ Write Executed", color: "success", description: `\`${entry.action}\` completed.` })],
        components: []
      });
    } catch (error) {
      console.log(JSON.stringify(writeAuditEvent({ actor, action: entry.action, capability: entry.action, idempotencyKey, result: "execute-failed", detail: { error: mapWriteError(error).description } })));
      await interaction.update({ embeds: [buildWriteErrorEmbed(error)], components: [] });
    }
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
