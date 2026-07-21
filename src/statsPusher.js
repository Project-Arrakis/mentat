import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { logError, logInfo } from "./logger.js";
import { getCommandCount, getAllGuilds, getActiveGuilds } from "./database.js";

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const PUSH_INTERVAL_MS = Number.parseInt(process.env.STATS_PUSH_INTERVAL_MS || "300000", 10) || 300000;
const INSTANCE_ID = process.env.ACP_INSTANCE_ID || randomUUID();

function getVersion() {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return pkg.version;
  } catch {
    return "unknown";
  }
}

function extract(r, ...keys) {
  for (const k of keys) {
    if (r[k] != null) return r[k];
  }
  return null;
}

async function fetchAggregate(adapterClient, db) {
  const aggregates = {};

  try {
    const activity = await adapterClient.opsActivity("system", undefined).catch(() => null);
    if (activity?.ok) {
      const r = activity.result || activity;
      aggregates.players_online_1h = extract(r, "activeLast1h", "activeLastHour") || 0;
      aggregates.players_online_24h = extract(r, "activeLast24h", "activeLastDay") || 0;
      aggregates.players_peak = extract(r, "peakConcurrent", "peakOnline") || 0;
    }
  } catch (err) {
    logError("stats_push.activity_failed", err);
  }

  try {
    const resources = await adapterClient.opsResources("system", undefined).catch(() => null);
    if (resources?.ok) {
      const r = resources.result || resources;
      aggregates.spice_fields = extract(r, "spiceFields") || 0;
      aggregates.water_wells = extract(r, "waterWells") || 0;
      aggregates.mineral_nodes = extract(r, "mineralNodes") || 0;
    }
  } catch (err) {
    logError("stats_push.resources_failed", err);
  }

  try {
    const location = await adapterClient.opsLocation("system", undefined).catch(() => null);
    if (location?.ok) {
      const r = location.result || location;
      aggregates.territories = extract(r, "territories") || 0;
      aggregates.total_markers = extract(r, "totalMarkers") || 0;
      aggregates.active_maps = extract(r, "activeMaps") || 0;
    }
  } catch (err) {
    logError("stats_push.location_failed", err);
  }

  try {
    const dashboard = await adapterClient.opsDashboard("system", undefined).catch(() => null);
    if (dashboard?.ok) {
      const r = dashboard.result || dashboard;
      aggregates.online_players = extract(r, "onlinePlayers") || aggregates.players_online_1h || 0;
      aggregates.combat_events_24h = extract(r, "combatEvents24h") || 0;
      aggregates.items_traded_24h = extract(r, "itemsTraded24h") || 0;
      if (r.summary) {
        aggregates.battlegroups = extract(r.summary, "battlegroups", "factions", "guilds") || 0;
        aggregates.sietches = extract(r.summary, "sietches", "settlements", "outposts") || 0;
      }
    }
  } catch (err) {
    logError("stats_push.dashboard_failed", err);
  }

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

async function pushStats(client, db, adapterClient) {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN || !KV_NAMESPACE_ID) {
    return;
  }

  try {
    const allGuilds = db ? getAllGuilds(db) : [];
    const activeGuilds = db ? getActiveGuilds(db) : [];
    const commandsTotal = db ? getCommandCount(db) : 0;
    const aggregates = adapterClient ? await fetchAggregate(adapterClient, db) : {};

    const stats = {
      instance_id: INSTANCE_ID,
      guilds: client.guilds.cache.size,
      guilds_total: allGuilds.length,
      guilds_active: activeGuilds.length,
      commands_total: commandsTotal,
      uptime_seconds: Math.floor(process.uptime()),
      version: getVersion(),
      updated_at: new Date().toISOString(),
      ...aggregates,
    };

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
      commands_total: stats.commands_total,
      uptime_seconds: stats.uptime_seconds,
      version: stats.version,
      players_online: stats.players_online_1h,
      spice_fields: stats.spice_fields,
      territories: stats.territories,
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
