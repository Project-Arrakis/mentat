import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { logError, logInfo } from "./logger.js";
import { getCommandCount, getAllGuilds, getActiveGuilds, saveStatsSnapshot } from "./database.js";
import { sendChannelAlert } from "./notifications.js";

const PUSH_INTERVAL_MS = Number.parseInt(process.env.STATS_PUSH_INTERVAL_MS || "300000", 10) || 300000;
// Identifies this bot process/deployment for log correlation and for the
// instance_id field in the served stats payload. Previously this ID also
// named a dedicated per-instance Cloudflare KV key (acp-stats-{instanceId});
// that write was removed (see pushStats() below) after confirming via a
// search across all three repositories in this effort
// (dune-awakening-selfhost-docker, Arrakis-Control-Panel, acp-landing)
// that nothing anywhere ever reads an acp-stats-{id} key back -- only the
// shared acp-stats-aggregate key was ever read (acp-landing's
// functions/api/stats.js). The per-instance write was pure dead weight: a
// new orphaned KV entry created on every process restart, accumulating
// without bound, for a key nothing consumes. As of issue #83.2 / KV
// removal, no KV key is written at all anymore -- the payload is stored
// in the local stats_snapshot table instead.
const INSTANCE_ID = process.env.ACP_INSTANCE_ID || randomUUID();

function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

// Strict numeric check mirroring acp-landing's own isValidNumber() —
// never let a wrong-typed or non-finite value pass through as if it were
// real data (see docs/kv-stats-schema.md in yacketrj/acp-landing).
function isValidNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// Builds the acp-stats-aggregate KV contract fields
// (players_online, sietches, battlegroups, spice_fields) from the four
// real OPS routes wired in dune-awakening-selfhost-docker's Phase 1
// (docs/remediation-prompt-cross-repo.md). Field names below match the
// ACTUAL response shapes confirmed live against a running Core instance
// during that phase — NOT the field names this function previously read
// (r.deepDesert/r.haggaBasin/r.spiceFields/r.summary.battlegroups etc.),
// none of which the real opsResourcesProvider/opsDashboardProvider ever
// produced. That mismatch is why every one of these fields silently
// evaluated to its `|| 0` fallback in production before this fix — not a
// missing feature, a field-name bug on this side.
//
// Real shapes (console/api/src/integrations/discord/opsProvider.js +
// console/api/src/duneDb.js, dune-awakening-selfhost-docker):
//   opsActivity   -> { ok, result: { onlinePlayers, activeLast1h, activeLast24h, ... } }
//   opsResources  -> { ok, result: { totalFields, totalValueRemaining, resourcesByMap, spiceFieldsBySize } }
//   opsCombat     -> { ok, result: { totalDeaths, pvpDeaths, pveDeaths, ... } }
//   opsEconomy    -> { ok, result: { totalCurrencyHolders, totalSupply, ... } }
const SYSTEM_ACTOR = Object.freeze({ userId: "stats-pusher", username: "ACP", guildId: "stats", channelId: "stats", roleIds: [] });

// Aggregate game-level stats across all active guilds. Each guild has its
// own console URL and adapter token (stored in the guilds table). We call
// each guild's ops routes and sum up the results to produce the cross-
// installation totals shown on the landing page stats bar.
//
// Single-server deployments: one iteration, same result as before.
// Multi-tenant: N parallel calls → aggregate sum.
async function fetchAggregate(adapterClient, activeGuilds = []) {
  const aggregates = {};
  let totalPlayers = 0, totalSpice = 0, sietchCount = 0, battleCount = 0;
  let successCount = 0, failCount = 0;

  // Filter to guilds that have a console URL configured
  const configuredGuilds = activeGuilds.filter(g => g.console_url && g.guild_id);
  if (!configuredGuilds.length) {
    logInfo("stats_push.no_console_guilds", { total: activeGuilds.length });
    // Fall back to default config for single-server deployments
    configuredGuilds.push({ guild_id: null });
  }

  for (const guild of configuredGuilds) {
    const guildId = guild.guild_id; // null = default config
    const tag = guildId || "default";
    let guildReachable = false;

    try {
      const activity = await adapterClient.opsActivity(SYSTEM_ACTOR, guildId).catch(() => null);
      const ar = activity?.ok ? (activity.result || activity) : null;
      if (ar && isValidNumber(ar.onlinePlayers)) {
        totalPlayers += ar.onlinePlayers;
        guildReachable = true;
      }
    } catch { /* tunnel-only or offline console — expected, not an error */ }

    try {
      const status = await adapterClient.status(SYSTEM_ACTOR, false, guildId).catch(() => null);
      const sr = status?.ok ? (status.result || status) : null;
      if (sr) {
        guildReachable = true;
        const summary = sr.summary || sr;
        if (summary.overall === "READY") battleCount += 1;
        if (summary.battlegroup) aggregates.battlegroup = aggregates.battlegroup || summary.battlegroup;
        if (summary.title && !aggregates.battlegroup) aggregates.battlegroup = summary.title;
      }
    } catch { }

    try {
      const resources = await adapterClient.opsResources(SYSTEM_ACTOR, guildId).catch(() => null);
      const rr = resources?.ok ? (resources.result || resources) : null;
      if (rr) {
        guildReachable = true;
        const dd = rr.deepDesert?.summary?.totalActiveFields;
        const hb = rr.haggaBasin?.summary?.totalActiveFields;
        if (isValidNumber(dd)) totalSpice += dd;
        if (isValidNumber(hb)) totalSpice += hb;
        const hbInstances = rr.haggaBasin?.instances;
        if (Array.isArray(hbInstances)) sietchCount += hbInstances.length;
      }
    } catch { }

    if (guildReachable) {
      successCount++;
    } else {
      failCount++;
    }
  }

  if (totalPlayers > 0 || configuredGuilds.length > 0) aggregates.players_online = totalPlayers;
  if (totalSpice > 0 || configuredGuilds.length > 0) aggregates.spice_fields = totalSpice;
  if (sietchCount > 0) aggregates.sietches = sietchCount;
  if (battleCount > 0) aggregates.battlegroups = battleCount;

  logInfo("stats_push.aggregation", { guilds: configuredGuilds.length, succeeded: successCount, failed: failCount, total_players: totalPlayers, total_spice: totalSpice, sietches: sietchCount, battlegroups: battleCount });

  return aggregates;
}

// Builds the exact acp-stats-aggregate payload shape documented in
// yacketrj/acp-landing:docs/kv-stats-schema.md. Every field the reader
// validates (players_online, sietches, battlegroups, spice_fields,
// installations, commands_total, version, updated_at) is either a real,
// sourced value or genuinely absent -- never a placeholder 0. Exported
// for direct unit testing (see test/statsPusher.test.js) without needing
// a live Discord client/db/adapter.
export function buildStatsPayload({ guildCount, allGuilds, activeGuilds, commandsTotal, aggregates = {} }) {
  return {
    instance_id: INSTANCE_ID,
    guilds: guildCount,
    // "installations" resolution (docs/kv-stats-schema.md's own "Open
    // questions" section + docs/remediation-prompt-cross-repo.md's
    // "Semantic findings"): aliased to guilds_active, not guilds_total.
    // Chose "active" over "total" because a guild the bot was removed
    // from (status: 'suspended', set by handleGuildDelete() in
    // onboarding.js) or that never completed setup (status: 'pending',
    // the default in upsertGuild()) is not a real, currently-live
    // installation from the product's perspective -- "installations"
    // should mean "servers actively using this right now," which
    // guilds_active's `WHERE status = 'active'` filter (getActiveGuilds()
    // in database.js) captures exactly, and guilds_total does not.
    // guilds_total (every guild ever onboarded, including suspended/
    // pending ones) remains available in this payload under its own
    // existing field name for anyone who wants the other number too --
    // this does not remove that field, only adds the contract's
    // "installations" alias pointing at the more accurate one of the two.
    installations: activeGuilds.length,
    guilds_total: allGuilds.length,
    guilds_active: activeGuilds.length,
    commands_total: commandsTotal,
    uptime_seconds: Math.floor(process.uptime()),
    version: getVersion(),
    updated_at: new Date().toISOString(),
    // players_online, spice_fields: real values from fetchAggregate() when
    // available, otherwise genuinely absent (not defaulted to 0) so
    // acp-landing's reader correctly reports them as unavailable rather
    // than rendering a fabricated zero.
    //
    // sietches, battlegroups: deliberately never set here -- see
    // fetchAggregate()'s comments for why neither has a real, reachable
    // source today. Absent, not zero.
    ...aggregates,
  };
}

// Consecutive stats-push failures before an alert is sent to the
// configured Discord channel (KV-4). Alerting only after repeated
// failures, not the first one, avoids paging on a single transient
// Cloudflare API blip while still catching a genuinely broken push path.
// Exported as a plain constant (not module-level mutable state) so the
// decision of "should this failure count trigger an alert" is a pure,
// directly-testable function (shouldAlertOnFailure() below) rather than
// hidden counter state that would leak between test cases.
export const ALERT_AFTER_CONSECUTIVE_FAILURES = 3;

// Pure decision function: given how many consecutive failures have
// occurred so far (including this one), should an alert fire now? Only
// fires exactly once per failure streak (at the threshold), not on every
// failure past it, so a channel doesn't get spammed with one alert per
// push interval for as long as Cloudflare stays down.
export function shouldAlertOnFailure(consecutiveFailureCount) {
  return consecutiveFailureCount === ALERT_AFTER_CONSECUTIVE_FAILURES;
}

// KV-4: basic write-failure alerting. Reuses the existing
// sendChannelAlert() mechanism (notifications.js) that alertSubscriber()
// already uses for readiness/services alerts, rather than adding a
// second, parallel notification path (e.g. a webhook) -- this bot has no
// webhook-based alerting anywhere to reuse instead. Posts to the same
// DUNE_ALERT_CHANNEL_ID configured for readiness/services alerts, if
// one is configured; silently no-ops otherwise (stats pushing remains
// best-effort and optional, same as before this change -- an unconfigured
// alert channel must not become a hard requirement for stats pushing to
// keep working).
async function maybeAlertOnFailure(client, alertChannelId, consecutiveFailureCount, err) {
  if (!alertChannelId) return;
  if (!shouldAlertOnFailure(consecutiveFailureCount)) return;
  try {
    const detail = err?.message ? ` (${String(err.message).slice(0, 200)})` : "";
    await sendChannelAlert(
      client,
      alertChannelId,
      `**Stats Push Alert**\nFailed to refresh live stats locally ${ALERT_AFTER_CONSECUTIVE_FAILURES} times in a row${detail}. The public live-stats widget may be showing stale data.`
    );
  } catch (alertErr) {
    // Alerting itself must never crash the stats pusher or mask the
    // original failure -- log and move on.
    logError("stats_push.alert_failed", alertErr);
  }
}

let consecutiveFailures = 0;

// Refreshes the local live-stats snapshot (src/database.js's
// stats_snapshot table, served by setupServer.js's GET /api/live-stats).
// This is the post-KV replacement: the acp-stats-aggregate payload the
// web reader consumes is now stored here and served directly by the bot,
// instead of being written to Cloudflare KV (removed per #83.2 /
// docs/kv-replacement-evaluation.md -- the account is over Cloudflare's
// free tier for KV specifically; Pages + Tunnel stay free).
async function pushStats(client, db, adapterClient, { alertChannelId } = {}) {
  if (!db) {
    return;
  }

  try {
    const allGuilds = db ? getAllGuilds(db) : [];
    const activeGuilds = db ? getActiveGuilds(db) : [];
    const commandsTotal = db ? getCommandCount(db) : 0;
    const aggregates = adapterClient ? await fetchAggregate(adapterClient, activeGuilds) : {};

    const stats = buildStatsPayload({
      guildCount: client.guilds.cache.size,
      allGuilds,
      activeGuilds,
      commandsTotal,
      aggregates
    });

    saveStatsSnapshot(db, stats);

    consecutiveFailures = 0;
    logInfo("stats_pushed", {
      instance_id: INSTANCE_ID,
      guilds: stats.guilds,
      installations: stats.installations,
      commands_total: stats.commands_total,
      uptime_seconds: stats.uptime_seconds,
      version: stats.version,
      players_online: stats.players_online,
      spice_fields: stats.spice_fields,
    });
    return true;
  } catch (err) {
    consecutiveFailures += 1;
    logError("stats_push.error", err);
    await maybeAlertOnFailure(client, alertChannelId, consecutiveFailures, err);
    return false;
  }
}

export function startStatsPusher({ client, db, adapterClient, alertChannelId = process.env.DUNE_ALERT_CHANNEL_ID }) {
  // Stats collection is now gated on ACP_STATS_ENABLED (default: on).
  // Previously it required Cloudflare KV credentials; with KV removed
  // (#83.2) there is no cloud dependency anymore, so the feature is
  // simply opt-out. Operators who never wanted the Core ops polls can
  // set ACP_STATS_ENABLED=false.
  if (String(process.env.ACP_STATS_ENABLED ?? "true").toLowerCase() === "false") {
    logInfo("stats_pusher.skipped", { reason: "disabled_by_env" });
    return { active: false, stop() {} };
  }

  logInfo("stats_pusher.instance", { instance_id: INSTANCE_ID });

  pushStats(client, db, adapterClient, { alertChannelId });

  const timer = setInterval(() => pushStats(client, db, adapterClient, { alertChannelId }), PUSH_INTERVAL_MS);
  timer.unref?.();

  logInfo("stats_pusher.started", { intervalMs: PUSH_INTERVAL_MS });

  return {
    active: true,
    stop() {
      clearInterval(timer);
    },
  };
}
