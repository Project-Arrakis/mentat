// consoleRegistration.js -- POST /api/consoles/register's business logic.
// The single load-bearing security property: never trust the submitted
// guildId/ownership claim without independently re-verifying it against
// Discord using the FORWARDED token, exactly the way this same file's
// setupServer.js sibling (resolveGuildName()) already calls Discord's API
// with a caller-supplied token -- this function is that same pattern,
// applied to the actual authorization decision, not just a display name.
import { upsertGuild } from "./database.js";
import { recordGlobalConsoleRegistrationAttempt, recordUserConsoleRegistrationAttempt } from "./consoleRegistrationRateLimit.js";
import { logInfo, logError } from "./logger.js";

const SNOWFLAKE_PATTERN = /^\d{17,19}$/;

async function fetchOwnedGuildIds(accessToken, fetchImpl) {
  const response = await fetchImpl("https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const guilds = await response.json();
  if (!Array.isArray(guilds)) return null;
  return guilds.filter((g) => g && g.owner === true).map((g) => String(g.id));
}

async function fetchDiscordUserId(accessToken, fetchImpl) {
  const response = await fetchImpl("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return String(user?.id || "") || null;
}

// verifyAndRegisterConsole: the full accept/reject/register decision.
// Returns { ok: true } on success, { ok: false, reason } on any rejection
// -- the route handler translates `reason` into the specific, deliberately-
// vague-on-the-ambiguous-case error copy the design calls for; this
// function itself never needs to know about HTTP status codes.
export async function verifyAndRegisterConsole(db, { guildId, discordAccessToken, consoleUrl, adapterToken }, { fetchImpl = globalThis.fetch } = {}) {
  const globalCheck = recordGlobalConsoleRegistrationAttempt();
  if (!globalCheck.allowed) return { ok: false, reason: "rate_limited" };

  // Cheap, local validation BEFORE any outbound Discord call -- the DoS
  // bound the design's own §3.3 requires. A garbage token/guildId never
  // reaches Discord's API at all.
  if (typeof discordAccessToken !== "string" || discordAccessToken.length === 0 || discordAccessToken.length > 1000) {
    return { ok: false, reason: "malformed_token" };
  }
  if (typeof guildId !== "string" || !SNOWFLAKE_PATTERN.test(guildId)) {
    return { ok: false, reason: "malformed_guild_id" };
  }
  if (typeof consoleUrl !== "string" || consoleUrl.length === 0) {
    return { ok: false, reason: "missing_console_url" };
  }
  if (typeof adapterToken !== "string" || adapterToken.length === 0) {
    return { ok: false, reason: "missing_adapter_token" };
  }

  let ownedGuildIds;
  let discordUserId;
  try {
    [ownedGuildIds, discordUserId] = await Promise.all([
      fetchOwnedGuildIds(discordAccessToken, fetchImpl),
      fetchDiscordUserId(discordAccessToken, fetchImpl)
    ]);
  } catch (err) {
    logError("console_registration.discord_unreachable", err, { guildId });
    return { ok: false, reason: "discord_unreachable" };
  }
  if (!ownedGuildIds || !discordUserId) {
    return { ok: false, reason: "invalid_token" };
  }

  // Per-user bucket is only ever touched AFTER the token has already
  // proven a real Discord identity -- see consoleRegistrationRateLimit.js's
  // own module comment for why touching it any earlier would be a
  // victim-targetable DoS.
  const userCheck = recordUserConsoleRegistrationAttempt(discordUserId);
  if (!userCheck.allowed) return { ok: false, reason: "rate_limited" };

  // THE load-bearing check: the submitted guildId must be one the token's
  // own owner genuinely owns -- never trust the request body's claim alone.
  if (!ownedGuildIds.includes(guildId)) {
    logInfo("console_registration.guild_ownership_mismatch", { guildId, discordUserId });
    return { ok: false, reason: "guild_not_owned" };
  }

  upsertGuild(db, {
    guildId,
    guildName: "Unknown", // resolved lazily elsewhere if needed; not worth a second Discord call here since fetchOwnedGuildIds already confirms membership+ownership
    consoleUrl,
    adapterToken,
    status: "active"
  });
  logInfo("console_registration.registered", { guildId, discordUserId });
  // discordAccessToken deliberately goes out of scope here, never
  // persisted, never logged -- the last reference to it in this function
  // was the two fetch calls above.
  return { ok: true };
}
