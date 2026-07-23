import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { logError, logInfo } from "./logger.js";
import { getCommandCount, getAllGuilds, getActiveGuilds } from "./database.js";

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const PUSH_INTERVAL_MS = Number.parseInt(process.env.STATS_PUSH_INTERVAL_MS || "300000", 10) || 300000;
// Pin this per deployment (see .env.example) so the per-instance KV key
// (acp-stats-{instanceId}) stays stable across restarts. If unset, a
// fresh random ID is generated every process restart, which is fine for
// the aggregate key (all instances overwrite the same acp-stats-aggregate
// key) but means the per-instance key accumulates a new orphaned KV entry
// on every restart -- see KV-2/KV-3, tracked as a separate follow-up
// (Phase 3 of docs/remediation-prompt-cross-repo.md in
// dune-awakening-selfhost-docker), not fixed in this change.
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

async function pushStats(client, db, adapterClient) {
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

    const instanceUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/acp-stats-${INSTANCE_ID}`;
    const aggregateUrl = `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/acp-stats-aggregate`;

    const [instanceOk, aggregateOk] = await Promise.all([
      pushToKV(instanceUrl, stats, "instance"),
      pushToKV(aggregateUrl, stats, "aggregate"),
    ]);

    if (!instanceOk || !aggregateOk) {
      return false;
    }

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
    logError("stats_push.error", err);
    return false;
  }
}

export function startStatsPusher({ client, db, adapterClient }) {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !KV_NAMESPACE_ID) {
    logInfo("stats_pusher.skipped", { reason: "missing_cloudflare_env" });
    return { active: false, stop() {} };
  }

  logInfo("stats_pusher.instance", { instance_id: INSTANCE_ID });

  pushStats(client, db, adapterClient);

  const timer = setInterval(() => pushStats(client, db, adapterClient), PUSH_INTERVAL_MS);
  timer.unref?.();

  logInfo("stats_pusher.started", { intervalMs: PUSH_INTERVAL_MS });

  return {
    active: true,
    stop() {
      clearInterval(timer);
    },
  };
}
