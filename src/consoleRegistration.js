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

// Fix-round-1 Important #3: a degraded/hung Discord would otherwise pin
// this handler open indefinitely -- combined with the 120/min global
// ceiling, new hung requests get admitted every minute with no bound on
// how many stay open concurrently. Matches src/adapterClient.js's own
// AbortController + setTimeout pattern (its `request()` method).
const DISCORD_FETCH_TIMEOUT_MS = 10000;

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// fetchOwnedGuilds: returns { id, name } pairs, not bare ids -- Fix-round-1
// should-fix finding: the previous bare-id version forced this file to
// hardcode guildName: "Unknown" on every registration, unconditionally
// clobbering a real name /setup/register may have already resolved for
// the same guild. Discord's own /users/@me/guilds response already
// includes each guild's real name, so no second API call is needed to
// get it right.
async function fetchOwnedGuilds(accessToken, fetchImpl, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, "https://discord.com/api/v10/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, timeoutMs);
  if (!response.ok) return null;
  const guilds = await response.json();
  if (!Array.isArray(guilds)) return null;
  return guilds
    .filter((g) => g && g.owner === true)
    .map((g) => ({ id: String(g.id), name: (typeof g.name === "string" && g.name.trim()) || "Unknown" }));
}

async function fetchDiscordUserId(accessToken, fetchImpl, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, "https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` }
  }, timeoutMs);
  if (!response.ok) return null;
  const user = await response.json();
  return String(user?.id || "") || null;
}

// verifyAndRegisterConsole: the full accept/reject/register decision.
// Returns { ok: true } on success, { ok: false, reason } on any rejection
// -- the route handler translates `reason` into the specific, deliberately-
// vague-on-the-ambiguous-case error copy the design calls for; this
// function itself never needs to know about HTTP status codes.
export async function verifyAndRegisterConsole(db, { guildId, discordAccessToken, consoleUrl, adapterToken }, { fetchImpl = globalThis.fetch, timeoutMs = DISCORD_FETCH_TIMEOUT_MS } = {}) {
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

  let ownedGuilds;
  let discordUserId;
  try {
    [ownedGuilds, discordUserId] = await Promise.all([
      fetchOwnedGuilds(discordAccessToken, fetchImpl, timeoutMs),
      fetchDiscordUserId(discordAccessToken, fetchImpl, timeoutMs)
    ]);
  } catch (err) {
    logError("console_registration.discord_unreachable", err, { guildId });
    return { ok: false, reason: "discord_unreachable" };
  }
  if (!ownedGuilds || !discordUserId) {
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
  const matchedGuild = ownedGuilds.find((g) => g.id === guildId);
  if (!matchedGuild) {
    logInfo("console_registration.guild_ownership_mismatch", { guildId, discordUserId });
    return { ok: false, reason: "guild_not_owned" };
  }

  upsertGuild(db, {
    guildId,
    // Fix-round-1 should-fix: use the real name Discord's own
    // /users/@me/guilds response already carries for this guild, rather
    // than unconditionally hardcoding "Unknown" -- the previous version
    // clobbered a real name /setup/register may have already resolved
    // for this same guild on an earlier registration.
    guildName: matchedGuild.name,
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
