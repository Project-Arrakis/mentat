// ownerConfirmation.js -- the owner-confirmation gate for the hosted-bot
// auto-invite flow (mentat#343+, Phase 2 of dune-awakening-selfhost-docker#832's
// design, §4.1 issue #844). This is the layer that actually closes the
// session-fixation/guild-hijack attack -- NOT authentication on
// /auto-invite/start (see autoInvite.js's own header comment and the design
// doc's §4.5 correction: this document was wrong about "what actually stops
// this attack" twice before landing on this mechanism).
//
// upsertGuild() is called from exactly one place in this whole feature:
// resolveConfirmation()'s "confirm" branch below, and only after re-
// verifying the guild's live ownership (not just trusting the original
// OAuth-verification snapshot from up to 15 minutes earlier -- issue #864's
// TOCTOU fix).
//
// Pattern reused deliberately from writeConfirmation.js (customId-prefixed
// pending-map, timeout-with-callback) -- see that file's own header comment,
// which already anticipated this exact reuse. The DATA store itself
// (pendingOwnerConfirmations) lives in database.js, matching
// autoInviteSessions/oauthSessions' convention (lazy-expiry, no active
// timer) -- this module layers an ACTIVE per-entry setTimeout on top, since
// Path F (design doc §4.2) needs a real side effect on timeout (log + best-
// effort leave-guild), not just silent lazy expiry the next time something
// happens to read the entry.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from "discord.js";
import { getPendingOwnerConfirmation, deletePendingOwnerConfirmation, findPendingOwnerConfirmationByGuildId, upsertGuild } from "./database.js";
import { duneEmbed } from "./embedFormat.js";
import { logInfo, logError } from "./logger.js";

const CUSTOM_ID_PREFIX = "autoinvite";
const DEFAULT_OWNER_CONFIRMATION_TIMEOUT_MS = 15 * 60 * 1000;

export function ownerConfirmationTimeoutMs() {
  const parsed = Number.parseInt(process.env.AUTO_INVITE_OWNER_CONFIRMATION_TIMEOUT_MS || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_OWNER_CONFIRMATION_TIMEOUT_MS;
}

// Active timers, keyed by confirmationId. Module-level, matching
// writeConfirmation.js's own pendingConfirmations Map precedent.
let activeTimers = new Map();

export function resetOwnerConfirmationTimersForTests() {
  for (const timer of activeTimers.values()) clearTimeout(timer);
  activeTimers = new Map();
}

function clearActiveTimer(confirmationId) {
  const timer = activeTimers.get(confirmationId);
  if (timer) clearTimeout(timer);
  activeTimers.delete(confirmationId);
}

export function buildConfirmationRow(confirmationId) {
  const confirm = new ButtonBuilder()
    .setCustomId(`${CUSTOM_ID_PREFIX}:confirm:${confirmationId}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);
  const deny = new ButtonBuilder()
    .setCustomId(`${CUSTOM_ID_PREFIX}:deny:${confirmationId}`)
    .setLabel("Deny")
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(confirm, deny);
}

// mentat#343 round-3 comprehensive audit finding (issue #864): the DM
// copy includes a one-line privacy notice, since this DM is mentat's own
// operator soliciting consent from a Discord user who has no prior
// relationship with this specific registration -- a materially different
// data-processing context than every other DM this bot sends.
export function buildConfirmationEmbed({ consoleUrl, guildName }) {
  return duneEmbed({
    title: "🔗 Connect This Server to Mentat?",
    color: "warning",
    description: [
      `A console at \`${consoleUrl}\` wants to manage **${guildName}** through Mentat.`,
      "",
      "If you did not just do this yourself, click Deny.",
      "",
      "_By confirming, you agree that Mentat may process your Discord user ID and this server's ID to complete the connection. See the privacy policy: https://mentat-link.darkdante.org/privacy_"
    ].join("\n")
  });
}

export function buildConfirmedEmbed({ guildName }) {
  return duneEmbed({ title: "✅ Connected", color: "success", description: `**${guildName}** is now connected to Mentat.` });
}

export function buildDeniedEmbed() {
  return duneEmbed({ title: "🚫 Denied", color: "error", description: "This connection request was denied. No server state was changed." });
}

export function buildExpiredEmbed() {
  return duneEmbed({ title: "⌛ Expired", color: "error", description: "This connection request is no longer valid. Start again from your console." });
}

export function buildNotYoursEmbed() {
  return duneEmbed({ title: "🔒 Not Your Confirmation", color: "error", description: "Only the verified server owner can respond to this request." });
}

export function buildOwnerChangedEmbed() {
  return duneEmbed({ title: "🔒 Ownership Changed", color: "error", description: "This server's ownership changed since this request was made. Start again from your console." });
}

export function buildConfirmConnectionCommand() {
  return new SlashCommandBuilder()
    .setName("confirm-connection")
    .setDescription("Confirm a pending hosted-bot connection request for this server (server owner only).");
}

async function tryLeaveGuild(client, guildId) {
  try {
    const guild = client.guilds?.cache?.get(guildId);
    if (guild) await guild.leave();
  } catch (err) {
    logError("auto_invite.leave_guild_failed", err, { guildId });
  }
}

async function handleOwnerConfirmationTimeout(client, confirmationId) {
  activeTimers.delete(confirmationId);
  const entry = getPendingOwnerConfirmation(confirmationId);
  if (!entry) return; // already confirmed/denied -- nothing to do
  deletePendingOwnerConfirmation(confirmationId);
  logInfo("auto_invite.owner_confirmation_timeout", { guildId: entry.guild_id, ownerId: entry.owner_id, confirmationId });
  await tryLeaveGuild(client, entry.guild_id);
}

// notifyOwnerOfPendingConfirmation: called by autoInvite.js immediately
// after staging a pendingOwnerConfirmation record. DMs the verified owner
// with Confirm/Deny buttons; on DM-send failure (Discord privacy settings
// commonly block bot DMs from non-friends), logs the fallback path is
// available via /confirm-connection rather than treating it as a hard
// failure -- the pending record itself doesn't care how the owner responds.
// Always schedules the active timeout regardless of DM outcome.
export async function notifyOwnerOfPendingConfirmation(client, { confirmationId, guildId, guildName, consoleUrl, ownerId, supersededConfirmationId }) {
  // mentat#346 Layer 2 audit finding: createPendingOwnerConfirmation()
  // now supersedes any existing pending DB entry for this guildId, but
  // that alone doesn't stop the OLD entry's already-scheduled timer (a
  // separate, module-local setTimeout keyed by the OLD confirmationId) --
  // left running, it would still fire later, find its own (now-deleted)
  // DB entry gone, and -- worse, if the guild had meanwhile been
  // legitimately confirmed via THIS new flow -- have no way to know that
  // and would previously have needed no explicit cancellation to cause
  // real harm via a Deny click on the stale DM. Cancelling it here,
  // synchronously, before scheduling the new one, closes that window.
  if (supersededConfirmationId) {
    clearActiveTimer(supersededConfirmationId);
    logInfo("auto_invite.superseded_pending_confirmation", { guildId, supersededConfirmationId, newConfirmationId: confirmationId });
  }

  const embed = buildConfirmationEmbed({ consoleUrl, guildName });
  const row = buildConfirmationRow(confirmationId);

  let dmSent = false;
  try {
    const user = await client.users.fetch(ownerId);
    await user.send({ embeds: [embed], components: [row] });
    dmSent = true;
  } catch (err) {
    logError("auto_invite.owner_dm_failed", err, { guildId, ownerId, confirmationId });
  }

  const timeoutMs = ownerConfirmationTimeoutMs();
  const timer = setTimeout(() => {
    handleOwnerConfirmationTimeout(client, confirmationId).catch((err) => {
      logError("auto_invite.owner_confirmation_timeout_handler_failed", err, { confirmationId });
    });
  }, timeoutMs);
  timer.unref?.();
  activeTimers.set(confirmationId, timer);

  logInfo("auto_invite.owner_notified", { guildId, ownerId, confirmationId, dmSent });
  return { dmSent };
}

// resolveConfirmation: the shared accept/reject decision behind both the
// DM button click and the /confirm-connection slash-command fallback.
// `requestingUserId` is whoever actually triggered the interaction --
// checked against the verified ownerId captured at OAuth-verification
// time (Phase 1). On "confirm", ALSO re-verifies live ownership via the
// bot's own gateway cache before committing (issue #864's TOCTOU fix) --
// no new OAuth round trip, matching rbac.js's existing
// resolveGuildOwnerId() precedent for reading guild-level state.
export async function resolveConfirmation(client, db, confirmationId, { requestingUserId, action }) {
  const entry = getPendingOwnerConfirmation(confirmationId);
  if (!entry) return { outcome: "expired" };

  if (requestingUserId !== entry.owner_id) {
    return { outcome: "not_yours" };
  }

  if (action === "deny") {
    clearActiveTimer(confirmationId);
    deletePendingOwnerConfirmation(confirmationId);
    logInfo("auto_invite.owner_denied", { guildId: entry.guild_id, ownerId: entry.owner_id, confirmationId });
    await tryLeaveGuild(client, entry.guild_id);
    return { outcome: "denied" };
  }

  // Layer 2 audit finding (mentat#346): explicit allowlist, not "anything
  // that isn't deny." Both current callers only ever pass "confirm" or
  // "deny" -- this isn't reachable today -- but an inverted-logic trap
  // (a future caller, or a malformed customId segment, silently treated
  // as a confirm instead of being rejected) is exactly the class of bug
  // this org's Requirement 20 exists to catch before it ships, not after.
  if (action !== "confirm") {
    logError("auto_invite.unexpected_confirmation_action", new Error(`Unexpected action: ${String(action)}`), { guildId: entry.guild_id, confirmationId });
    return { outcome: "invalid_action" };
  }

  const liveOwnerId = client.guilds?.cache?.get(entry.guild_id)?.ownerId;
  if (liveOwnerId !== entry.owner_id) {
    clearActiveTimer(confirmationId);
    deletePendingOwnerConfirmation(confirmationId);
    logInfo("auto_invite.owner_mismatch_at_confirm", {
      guildId: entry.guild_id,
      originalOwnerId: entry.owner_id,
      liveOwnerId: liveOwnerId || null,
      confirmationId
    });
    return { outcome: "owner_changed" };
  }

  clearActiveTimer(confirmationId);
  deletePendingOwnerConfirmation(confirmationId);
  upsertGuild(db, {
    guildId: entry.guild_id,
    guildName: entry.guild_name,
    consoleUrl: entry.console_url,
    adapterToken: entry.adapter_token,
    status: "active"
  });
  logInfo("auto_invite.confirmed", { guildId: entry.guild_id, ownerId: entry.owner_id, confirmationId });
  return { outcome: "confirmed", guildName: entry.guild_name };
}

// handleOwnerConfirmationButtonInteraction: routes a button interaction for
// this flow. Returns false if the customId doesn't belong to this flow
// (caller should fall through, matching handleWriteButtonInteraction()'s
// own return-value convention in writeConfirmation.js).
export async function handleOwnerConfirmationButtonInteraction(interaction, db) {
  if (!interaction?.isButton?.()) return false;
  const parts = String(interaction.customId || "").split(":");
  if (parts[0] !== CUSTOM_ID_PREFIX) return false;

  const [, action, confirmationId] = parts;
  const result = await resolveConfirmation(interaction.client, db, confirmationId, {
    requestingUserId: interaction.user?.id,
    action
  });

  const embedFor = {
    expired: buildExpiredEmbed(),
    not_yours: buildNotYoursEmbed(),
    owner_changed: buildOwnerChangedEmbed(),
    denied: buildDeniedEmbed(),
    confirmed: result.outcome === "confirmed" ? buildConfirmedEmbed({ guildName: result.guildName }) : undefined
  }[result.outcome] || buildExpiredEmbed();

  if (result.outcome === "not_yours") {
    await interaction.reply({ embeds: [embedFor], ephemeral: true });
  } else {
    await interaction.update({ embeds: [embedFor], components: [] });
  }
  return true;
}

// handleConfirmConnectionCommand: the /confirm-connection slash-command
// fallback for when the owner's DMs are closed to non-friends. Runnable by
// any guild member, but only actionable by the verified owner -- checked
// server-side against interaction.user.id, matching the button path's own
// check. Since there's no explicit confirmationId on this command (the
// owner just runs it in the guild the pending request is for), it looks up
// the pending confirmation by guildId rather than by confirmationId.
export async function handleConfirmConnectionCommand(interaction, db) {
  if (!interaction?.isChatInputCommand?.() || interaction.commandName !== "confirm-connection") return false;

  const guildId = interaction.guildId;
  const pending = guildId ? findPendingOwnerConfirmationByGuildId(guildId) : undefined;
  if (!pending) {
    await interaction.reply({ embeds: [buildExpiredEmbed()], ephemeral: true });
    return true;
  }

  const result = await resolveConfirmation(interaction.client, db, pending.confirmation_id, {
    requestingUserId: interaction.user?.id,
    action: "confirm"
  });

  const embedFor = {
    expired: buildExpiredEmbed(),
    not_yours: buildNotYoursEmbed(),
    owner_changed: buildOwnerChangedEmbed(),
    confirmed: result.outcome === "confirmed" ? buildConfirmedEmbed({ guildName: result.guildName }) : undefined
  }[result.outcome] || buildExpiredEmbed();

  await interaction.reply({ embeds: [embedFor], ephemeral: result.outcome !== "confirmed" });
  return true;
}
