import { getGuild, upsertGuild } from "./database.js";
import { logInfo, logError } from "./logger.js";
import { AuditLogEvent } from "discord.js";
import { resolveCompatEnv } from "./compatEnv.js";

const SETUP_URL = resolveCompatEnv(process.env, "SETUP_URL", { urlShaped: true }) || resolveCompatEnv(process.env, "BASE_URL", { urlShaped: true }) || "http://localhost:3100";

// PROCLAMATION_HEADER/PROCLAMATION_SETUP_STEPS/PROCLAMATION_FOOTER: shared
// between setupMessageFor and fallbackNoticeFor, which differ only in their
// opening line (whether the reader is confirmed as the one who invited
// Sahir Venn, or merely presumed to be, per findInviter()'s own comment
// below) -- kept as one source of truth so the two variants cannot drift
// out of voice with each other the way separately-hand-maintained copy
// tends to (the exact bug class this project's own doc-remediation work
// keeps finding elsewhere).
function proclamationHeader(guild, acceptanceLine) {
  return [
    `◈ **PROCLAMATION OF THE MENTAT** ◈`,
    ``,
    `> **To the retainers, operators, and sworn servants of ${guild.name}:**`,
    ``,
    acceptanceLine,
    ``,
    `🧠 **I am Sahir Venn, Mentat to this House.**`,
    ``,
    `**My service has begun.**`,
    ``,
    `The machines beneath your holdings speak constantly—in readiness, population, maps, backups, resources, infrastructure, failures, and the small deviations that precede disorder.`,
    ``,
    `Most hear noise.`,
    ``,
    `**A Mentat hears pattern.**`,
    ``,
    `---`,
    ``,
    `## 🜂 **THE MENTAT IS NOW IN SERVICE**`,
    ``,
    `At launch, I serve as the **read-only Discord intelligence and observability interface for Dune: Awakening Docker**.`,
    ``,
    `⚙️ Server health, status, and readiness`,
    `👥 Population and selected player information`,
    `🗺️ Maps, backups, maintenance, and world state`,
    `📊 Operational and infrastructure telemetry`,
    `⚠️ Degraded-service and anomaly detection`,
    `📜 Scheduled reports, alerts, and announcements`,
    ``,
    `🔐 **My present authority is observation only.** Sahir Venn does not restart servers, modify game state, alter Docker services, execute shell commands, or write directly to the game database.`,
    ``,
    `> **No Mentat commands the House he serves.**`,
    `> **He ensures that those who command do so with knowledge.**`,
    ``,
    `---`
  ];
}

function proclamationSetupSteps(setupLink) {
  return [
    ``,
    `## 🔗 **COMPLETE THE BINDING**`,
    ``,
    `I have entered your House, but I am not yet bound to it.`,
    ``,
    `**To establish the link** (a few minutes; a bit longer the first time, since it includes a one-time console configuration):`,
    `1. Click the setup link below and sign in with Discord`,
    `2. Enable the Discord adapter in your console's \`.env\`, create the adapter token file, and recreate the console container (the portal shows the exact commands)`,
    `3. Enter your console URL and adapter token`,
    `4. Map Discord roles to the four tiers (Player, Moderator, Admin, Owner)`,
    ``,
    `🔗 **Setup Link:** ${setupLink}`,
    ``,
    `**Establish the link. Let calculation precede action.**`,
    ``,
    `Once bound, commands like \`/dune server status\` and \`/dune player inventory\` will answer immediately.`,
    ``,
    `> *The spice must flow.*`,
    `> *The servers must endure.*`,
    ``,
    `— **Sahir Venn**`,
    `*Mentat to the Great House of Dune: Awakening Docker*`
  ];
}

function setupMessageFor(guild, setupLink) {
  return [
    ...proclamationHeader(guild, `You have accepted the counsel of a Mentat.`),
    ...proclamationSetupSteps(setupLink)
  ].join("\n");
}

function ownerNoticeFor(guild, inviter) {
  const inviterLabel = inviter.tag || inviter.username || inviter.id;
  return [
    `◈ **A MENTAT HAS ENTERED YOUR HOUSE** ◈`,
    ``,
    `🧠 **Sahir Venn was added to ${guild.name}.**`,
    ``,
    `**${inviterLabel}** added Sahir Venn to your service, and the setup instructions have been sent to them.`,
    ``,
    `You need do nothing further, unless the binding stalls — should it seem stuck, you may invoke \`/dune core setup\` yourself, as this House's Owner, to receive the setup link directly.`,
    ``,
    `— **Sahir Venn**`,
    `*Mentat to the Great House of Dune: Awakening Docker*`
  ].join("\n");
}

// fallbackNoticeFor: used only when the inviter genuinely could not be
// identified (audit log permission truly missing, or a real, non-timing
// error) -- as opposed to the retry-exhausted case, which is a
// different, more specific message (see findInviter()'s own comment).
// Explicitly addresses "if you're the person who just invited me" since
// in a single-owner install (the common case today, before operators
// have re-invited with the recommended permissions=128) the inviter and
// the owner are almost always the same person anyway -- this message
// should make sense whether the reader is the owner, the inviter, or
// both.
function fallbackNoticeFor(guild, setupLink) {
  return [
    ...proclamationHeader(guild, `If you're the one who just invited me, you have accepted the counsel of a Mentat.`),
    ...proclamationSetupSteps(setupLink),
    ``,
    `(You're getting this as the server owner. If someone else invited me, ask them to run \`/dune core setup\` for their own copy of this link.)`
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
// expected and handled as a normal, silent fallback (not an error): a
// genuinely missing permission returns null immediately, no retry.
//
// FIX (2026-07-27, found via a live test immediately after this
// function was first added): even WITH the permission correctly
// granted (confirmed directly via the Discord API -- the bot's own
// guild role really did have the View Audit Log bit set), the very
// first fetchAuditLogs() call made from inside the guildCreate handler
// itself failed with "Missing Permissions" -- while the exact same call
// made about a minute later, from a separate one-off script, succeeded
// and returned the real BOT_ADD entry. This is a real timing race:
// guildCreate fires the instant the bot's membership is created, but
// Discord's own permission-grant propagation for that brand new guild
// membership had not yet finished at that exact moment. Retries up to
// 3 times with a short, fixed backoff (errors specifically matching
// "Missing Permissions" only -- any other error, e.g. a genuinely
// missing permission grant, still fails fast with no retry, since
// retrying that would just waste time before falling back).
// retryDelayMs is injectable (defaults to a real 1500ms) specifically so
// tests can pass 0 and exercise the full 3-attempt retry path without
// each test actually taking 3+ real seconds -- found necessary when the
// very first version of this retry logic made this file's own test
// suite noticeably slower for no real benefit; a real delay is only
// meaningful in production, never in a test asserting the retry logic
// itself runs.
async function findInviter(guild, retryDelayMs = 1500) {
  const MAX_ATTEMPTS = 3;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 5 });
      const entry = logs.entries.find((e) => e.target?.id === guild.client.user.id);
      return entry?.executor || null;
    } catch (err) {
      const isPermissionPropagationRace = /missing permissions/i.test(err.message || "");
      if (!isPermissionPropagationRace || attempt === MAX_ATTEMPTS) {
        logInfo("onboarding.audit_log_unavailable", {
          guildId: guild.id,
          guildName: guild.name,
          reason: err.message,
          attempts: attempt
        });
        return null;
      }
      logInfo("onboarding.audit_log_retry", {
        guildId: guild.id,
        guildName: guild.name,
        attempt,
        reason: err.message
      });
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  return null;
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
// second, redundant full setup DM. When the inviter genuinely can't be
// determined (no VIEW_AUDIT_LOG permission, or every retry attempt
// failed -- see findInviter()'s own comment), the owner gets
// fallbackNoticeFor()'s message instead of setupMessageFor()'s: worded
// to make sense whether the reader is the owner, the actual inviter, or
// both, since a real live test (2026-07-27) confirmed a non-owner
// inviter genuinely receives nothing in this fallback case -- an
// intentional, documented limitation (there is no way to identify a
// non-owner inviter without VIEW_AUDIT_LOG), not a silent gap.
//
// LIVE VERIFICATION (2026-07-27): confirmed end-to-end in production
// against a real guild-join event (a non-owner account inviting the
// bot to a real guild) after two additional, unrelated Discord
// Developer Portal issues were found and fixed the same session: (1)
// this site's own "Add to Discord" links (acp-landing repo) requested
// permissions=0, so the audit-log lookup could never succeed for any
// real user until fixed; (2) the application's Default Install
// Settings (used by Discord's own "Add App" button, a separate entry
// point from any custom link) was missing the bot scope entirely
// (would install slash commands without ever adding the bot to the
// guild) and had Permissions briefly over-corrected to Administrator
// before being scoped down to the actual minimum, View Audit Log. With
// both fixed, the real log trace showed: guild.joined ->
// onboarding.setup_dm_sent (recipient: "inviter") ->
// onboarding.owner_notice_sent -- no audit_log_unavailable/retry
// entries at all, confirming the fast path works correctly end-to-end,
// not just in unit tests.
export async function handleGuildCreate(bot, guild, db, { auditLogRetryDelayMs = 1500 } = {}) {
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

  const inviter = await findInviter(guild, auditLogRetryDelayMs);
  const setupLink = `${SETUP_URL}/setup?guildId=${guild.id}`;
  // Three distinct outcomes, each with its own message copy:
  // 1. inviter identified AND is a different person than the owner ->
  //    full setup DM to the inviter, short notice to the owner.
  // 2. inviter identified AND is the same person as the owner -> one
  //    full setup DM to the owner (identical to the pre-inviter-detection
  //    behavior, just now confirmed rather than assumed).
  // 3. inviter could NOT be identified at all (no permission, retries
  //    exhausted, etc.) -> fallbackNoticeFor() to the owner, explicitly
  //    written to make sense whether the reader is the owner, the real
  //    inviter, or both -- see that function's own comment for why this
  //    is a different message than case 2, not just a copy-paste.
  const inviterKnown = Boolean(inviter);
  const inviterIsOwner = inviterKnown && inviter.id === owner.id;
  const primaryRecipient = inviterKnown && !inviterIsOwner ? inviter : owner;
  const primaryMessage = inviterKnown
    ? setupMessageFor(guild, setupLink)
    : fallbackNoticeFor(guild, setupLink);
  const primaryRecipientLabel = inviterKnown ? (inviterIsOwner ? "owner" : "inviter") : "owner-fallback";

  try {
    const dm = await primaryRecipient.createDM();
    await dm.send({ content: primaryMessage });
    logInfo("onboarding.setup_dm_sent", {
      guildId: guild.id,
      guildName: guild.name,
      recipient: primaryRecipientLabel
    });
  } catch (err) {
    logError("onboarding.setup_dm_failed", err, {
      guildId: guild.id,
      guildName: guild.name,
      recipient: primaryRecipientLabel
    });
  }

  if (inviterKnown && !inviterIsOwner) {
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
