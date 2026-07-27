import { getGuild, upsertGuild } from "./database.js";
import { logInfo, logError } from "./logger.js";
import { AuditLogEvent } from "discord.js";

const SETUP_URL = process.env.ACP_SETUP_URL || process.env.ACP_BASE_URL || "http://localhost:3100";

function setupMessageFor(guild, setupLink) {
  return [
    `🐛 **Welcome to ACP!**`,
    ``,
    `I've been added to **${guild.name}**. To get started, you need to connect this server to your Arrakis Control Panel.`,
    ``,
    `**Setup takes 2 minutes:**`,
    `1. Click the setup link below`,
    `2. Sign in with Discord`,
    `3. Enter your console URL and adapter token`,
    `4. Configure your roles`,
    ``,
    `🔗 **Setup Link:** ${setupLink}`,
    ``,
    `Once configured, commands like \`/dune server status\` and \`/dune player inventory\` will work immediately.`
  ].join("\n");
}

function ownerNoticeFor(guild, inviter) {
  const inviterLabel = inviter.tag || inviter.username || inviter.id;
  return [
    `🐛 **ACP was added to ${guild.name}**`,
    ``,
    `**${inviterLabel}** added the Arrakis Control Panel bot to your server and has been sent the setup instructions.`,
    ``,
    `You don't need to do anything unless setup isn't completed -- if it looks stuck, you (as server owner) can also run \`/dune core setup\` for the setup link.`
  ].join("\n");
}

// findInviter: looks up the guild's BOT_ADD audit log entry to identify
// the real Discord user who completed the bot-invite OAuth flow --
// distinct from guild.fetchOwner() (the guild's owner, who may not be
// the person who actually added the bot; Discord's bot-invite OAuth
// flow only requires "Manage Server" permission, not ownership).
//
// Requires the bot to hold VIEW_AUDIT_LOG on the guild. The documented
// invite link (docs/discord-setup.md) requests permissions=0, so most
// existing installs will NOT have this permission yet -- this is
// expected and handled as a normal, silent fallback (not an error): any
// failure here (missing permission, no matching entry yet due to
// Discord's own audit-log propagation delay, etc.) returns null, and
// the caller falls back to owner-only behavior, unchanged from before
// this feature existed.
async function findInviter(guild) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
    const entry = logs.entries.find((e) => e.target?.id === guild.client.user.id);
    return entry?.executor || null;
  } catch (err) {
    logInfo("onboarding.audit_log_unavailable", {
      guildId: guild.id,
      guildName: guild.name,
      reason: err.message
    });
    return null;
  }
}

// FIX (2026-07-27, found via a real live report: bot added to a new
// guild, owner received no setup DM, and there was ZERO trace of this
// in the logs at all -- not even a warning). Root cause: both
// guild.fetchOwner() and dm.send() below were wrapped in
// .catch(() => null) / a try/catch with only a console.warn (never
// wired to this project's own structured logger), so any real failure
// -- Discord API error, rate limit, owner has DMs disabled, guild
// owner not cacheable, etc. -- was completely invisible. This made the
// exact failure this user hit undiagnosable without a code change.
// Both failure points now log via this project's own logInfo/logError
// (matching every other module's convention, see logger.js), so the
// next occurrence is actually traceable in bot.log instead of silent.
//
// SCOPE ADDITION (same session, same live report): the original design
// only ever DMed guild.fetchOwner() -- but Discord's bot-invite OAuth
// flow only requires "Manage Server" permission, not ownership, so on
// any server where a non-owner admin does the actual inviting (the
// exact case that surfaced this report), the person who did the real
// work got nothing, and the setup DM went to a potentially inactive or
// unaware owner instead. Now identifies the real inviter via the
// guild's BOT_ADD audit log entry (findInviter() above) and sends them
// the full setup instructions; if the inviter is a different person
// than the owner, the owner instead gets a short informational notice
// (who added the bot, that setup is already in progress) rather than a
// second, redundant full setup DM. Falls back to the original
// owner-only behavior whenever the inviter can't be determined (no
// VIEW_AUDIT_LOG permission -- true for most existing installs using
// the current documented permissions=0 invite link -- or any other
// audit-log lookup failure), so this is purely additive, not a
// breaking change to any existing deployment.
export async function handleGuildCreate(bot, guild, db) {
  const existing = getGuild(db, guild.id);
  if (existing && existing.status === "active") {
    logInfo("onboarding.skipped_already_active", { guildId: guild.id, guildName: guild.name });
    return;
  }

  let owner = null;
  try {
    owner = await guild.fetchOwner();
  } catch (err) {
    logError("onboarding.fetch_owner_failed", err, { guildId: guild.id, guildName: guild.name });
    return;
  }
  if (!owner) {
    logInfo("onboarding.fetch_owner_returned_null", { guildId: guild.id, guildName: guild.name });
    return;
  }

  const inviter = await findInviter(guild);
  const setupLink = `${SETUP_URL}/setup?guildId=${guild.id}`;
  const inviterIsOwner = !inviter || inviter.id === owner.id;

  const primaryRecipient = inviterIsOwner ? owner : inviter;
  try {
    const dm = await primaryRecipient.createDM();
    await dm.send({ content: setupMessageFor(guild, setupLink) });
    logInfo("onboarding.setup_dm_sent", {
      guildId: guild.id,
      guildName: guild.name,
      recipient: inviterIsOwner ? "owner" : "inviter"
    });
  } catch (err) {
    logError("onboarding.setup_dm_failed", err, {
      guildId: guild.id,
      guildName: guild.name,
      recipient: inviterIsOwner ? "owner" : "inviter"
    });
  }

  if (!inviterIsOwner) {
    try {
      const ownerDm = await owner.createDM();
      await ownerDm.send({ content: ownerNoticeFor(guild, inviter) });
      logInfo("onboarding.owner_notice_sent", { guildId: guild.id, guildName: guild.name });
    } catch (err) {
      logError("onboarding.owner_notice_failed", err, { guildId: guild.id, guildName: guild.name });
    }
  }
}

export async function handleGuildDelete(bot, guild, db) {
  const existing = getGuild(db, guild.id);
  if (!existing) return;

  upsertGuild(db, {
    guildId: guild.id,
    guildName: guild.name,
    consoleUrl: existing.console_url,
    adapterToken: existing.adapter_token,
    status: "suspended"
  });
}
