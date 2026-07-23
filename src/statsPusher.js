import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { logError, logInfo } from "./logger.js";
import { getCommandCount, getAllGuilds, getActiveGuilds } from "./database.js";
import { sendChannelAlert } from "./notifications.js";

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const PUSH_INTERVAL_MS = Number.parseInt(process.env.STATS_PUSH_INTERVAL_MS || "300000", 10) || 300000;
// Cloudflare KV requires expiration_ttl to be at least 60 seconds. 3600s
// (1 hour) is comfortably longer than the default 300000ms/5min push
// interval, so a single missed push cycle (a transient Cloudflare API
// error, a brief network blip, etc.) never causes the key to expire
// before the next successful push refreshes it -- see KV-2/KV-3,
// docs/remediation-prompt-cross-repo.md Phase 3 (dune-awakening-selfhost-docker).
const KV_EXPIRATION_TTL_SECONDS = Number.parseInt(process.env.ACP_STATS_KV_TTL_SECONDS || "3600", 10) || 3600;
// Identifies this bot process/deployment for log correlation
// (stats_pusher.instance / stats_push.error), independent of any KV key.
// Previously this ID also named a dedicated per-instance KV key
// (acp-stats-{instanceId}); that write has been removed (see
// pushStats() below) after confirming via a search across all three
// repositories in this effort (dune-awakening-selfhost-docker,
// Arrakis-Control-Panel, acp-landing) that nothing anywhere ever reads
// an acp-stats-{id} key back -- only the shared acp-stats-aggregate key
// is ever read (acp-landing's functions/api/stats.js). The per-instance
// write was pure dead weight: a new orphaned KV entry created on every
// process restart, accumulating without bound (KV-2/KV-3), for a key
// nothing consumes.
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
async function fetchAggregate(adapterClient) {
  const aggregates = {};

  try {
    const activity = await adapterClient.opsActivity("system", undefined).catch(() => null);
    const r = activity?.ok ? activity.result : null;
    // "players_online" per docs/kv-stats-schema.md is "Current online
    // player count" — onlinePlayers is the exact real field for that
    // (a live snapshot), not activeLast1h/24h (rolling activity windows,
    // a different metric entirely that the previous version conflated
    // with "online now").
    if (r && isValidNumber(r.onlinePlayers)) {
      aggregates.players_online = r.onlinePlayers;
    }
  } catch (err) {
    logError("stats_push.activity_failed", err);
  }

  try {
    const resources = await adapterClient.opsResources("system", undefined).catch(() => null);
    const r = resources?.ok ? resources.result : null;
    // "spice_fields" per docs/kv-stats-schema.md is "Aggregate remaining
    // spice across active fields" — totalValueRemaining is exactly that
    // (already filtered to field_kind_id = 1 / spice server-side in
    // addonOpsResourcesSummary()). totalFields would be a field *count*,
    // a different metric; do not conflate the two.
    if (r && isValidNumber(r.totalValueRemaining)) {
      aggregates.spice_fields = r.totalValueRemaining;
    }
  } catch (err) {
    logError("stats_push.resources_failed", err);
  }

  // "sietches" per docs/kv-stats-schema.md is "Count of active Hagga
  // Basin sietches." Investigated directly against a live Core instance:
  // dune.world_partition rows for map = 'Survival_1' ARE the Sietches
  // (confirmed via the partition's own `label` field, e.g. "Sietch
  // Abbir") — a real, countable concept exists. However, NO route
  // reachable from this bot exposes that count: it is only queryable via
  // duneDb.mapCombatPartitionRows(), which is wired exclusively to the
  // web-console-only GET /api/maps/combat-state route (server.js), not
  // to any Discord-adapter or addon-bridge ops.* action this bot can
  // call. Neither opsActivityProvider, opsCombatProvider,
  // opsResourcesProvider, nor opsEconomyProvider include a Sietch/
  // partition count anywhere in their real response shapes. Correctly
  // left unset (reported as unavailable, never fabricated) until Core
  // exposes this via a reachable route — tracked as a follow-up, not
  // fixed here.

  // "battlegroups" — per docs/kv-stats-schema.md's own "Open questions"
  // section (backed by direct investigation in
  // dune-awakening-selfhost-docker's docs/remediation-prompt-cross-repo.md):
  // "battlegroup" is a real, defined concept there
  // (services/publicDirectory.js's isBattlegroupRunning()), but it is a
  // PER-SERVER BOOLEAN ("is this deployment's core stack running"), not
  // a fleet-wide countable number. No route anywhere produces a
  // meaningful count for it. Deliberately left unset here — see the
  // resolution recorded in this PR's description — rather than reviving
  // the previous extract(r.summary, "battlegroups", "factions", "guilds")
  // fallback chain, which aliased three different, none-of-them-real
  // fields from a dashboard `summary: {}` object that opsDashboardProvider
  // has never actually populated.

  return aggregates;
}

// Builds the acp-stats-aggregate KV write URL with expiration_ttl set as
// a query parameter, per Cloudflare's REST API for KV writes (this is
// the `PUT .../values/{key}?expiration_ttl=N` REST call, not the
// wrangler/Workers KV binding API, which takes an `expirationTtl` option
// on a different call shape entirely -- do not confuse the two).
// Exported for direct unit testing without needing a live fetch.
export function buildAggregateKvUrl({ accountId = CLOUDFLARE_ACCOUNT_ID, namespaceId = KV_NAMESPACE_ID, ttlSeconds = KV_EXPIRATION_TTL_SECONDS } = {}) {
  const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/acp-stats-aggregate`);
  url.searchParams.set("expiration_ttl", String(ttlSeconds));
  return url.toString();
}

async function pushToKV(url, stats, label) {
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(stats),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    logError(`stats_push.${label}_failed`, { status: res.status, body });
    return false;
  }
  return true;
}

// Builds the exact acp-stats-aggregate KV payload shape documented in
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
      `**Stats Push Alert**\nFailed to write live stats to Cloudflare KV ${ALERT_AFTER_CONSECUTIVE_FAILURES} times in a row${detail}. The public live-stats widget may be showing stale data.`
    );
  } catch (alertErr) {
    // Alerting itself must never crash the stats pusher or mask the
    // original failure -- log and move on.
    logError("stats_push.alert_failed", alertErr);
  }
}

let consecutiveFailures = 0;

async function pushStats(client, db, adapterClient, { alertChannelId } = {}) {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !KV_NAMESPACE_ID) {
    return;
  }

  try {
    const allGuilds = db ? getAllGuilds(db) : [];
    const activeGuilds = db ? getActiveGuilds(db) : [];
    const commandsTotal = db ? getCommandCount(db) : 0;
    const aggregates = adapterClient ? await fetchAggregate(adapterClient) : {};

    const stats = buildStatsPayload({
      guildCount: client.guilds.cache.size,
      allGuilds,
      activeGuilds,
      commandsTotal,
      aggregates
    });

    // Only the shared acp-stats-aggregate key is written. The previous
    // per-instance acp-stats-{instanceId} write was removed -- see
    // INSTANCE_ID's comment above for why (confirmed unread anywhere
    // across all three repositories in this effort).
    const aggregateUrl = buildAggregateKvUrl();
    const aggregateOk = await pushToKV(aggregateUrl, stats, "aggregate");

    if (!aggregateOk) {
      consecutiveFailures += 1;
      await maybeAlertOnFailure(client, alertChannelId, consecutiveFailures);
      return false;
    }

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
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !KV_NAMESPACE_ID) {
    logInfo("stats_pusher.skipped", { reason: "missing_cloudflare_env" });
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
