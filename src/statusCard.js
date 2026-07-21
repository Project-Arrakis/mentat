import { generateStatusCard } from "../scripts/generate-status-card.js";
import { AttachmentBuilder } from "discord.js";
import { randomQuote } from "./quotes.js";
import { getGuildFaction } from "./database.js";

const CARD_CACHE = new Map();
const CACHE_TTL_MS = 30_000;

function cacheKey(guildId, title, overall) {
  return `${guildId}:${title}:${overall}`;
}

function getCached(key) {
  const entry = CARD_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    CARD_CACHE.delete(key);
    return null;
  }
  return entry.buffer;
}

function setCache(key, buffer) {
  CARD_CACHE.set(key, { buffer, ts: Date.now() });
  if (CARD_CACHE.size > 50) {
    const oldest = CARD_CACHE.keys().next().value;
    CARD_CACHE.delete(oldest);
  }
}

export async function sendStatusCard({ interaction, statusData, title, quote, adapterClient, guildId, db = null } = {}) {
  const r = statusData?.result || statusData || {};
  const maps = (Array.isArray(r.maps) ? r.maps : []).map(m => ({
    name: m.name || "?",
    state: m.state || m.status || "UNKNOWN",
    uptime: m.uptime || ""
  }));

  const isError = statusData?.ok === false || r.overall === "DOWN" || r.overall === "ISSUE";
  const overall = isError ? "ERROR" : (r.overall || "UNKNOWN");

  let latency = 0;
  if (adapterClient) {
    try {
      const start = Date.now();
      await adapterClient.health();
      latency = Date.now() - start;
    } catch { latency = 0; }
  }

  const faction = db && guildId ? getGuildFaction(db, guildId) : "";
  const resolvedQuote = quote || randomQuote(faction || undefined);
  const ck = cacheKey(guildId || "", title || r.title || "Server", overall);
  const cached = getCached(ck);

  let buffer;
  if (cached) {
    buffer = cached;
  } else {
    const canvas = await generateStatusCard({
      title: title || r.title || "Server",
      overall,
      region: r.region || "",
      mode: r.mode || "",
      population: r.population || "—",
      maps,
      services: Array.isArray(r.services) ? r.services.length : 0,
      latency,
      quote: resolvedQuote,
      faction: faction || undefined,
      isError
    });
    buffer = canvas.toBuffer("image/png");
    setCache(ck, buffer);
  }

  const attachment = new AttachmentBuilder(buffer, { name: "status-card.png" });
  await interaction.editReply({ files: [attachment], embeds: [] });
}

export async function sendOpsCard({ interaction, payload, subcommand, adapterClient, guildId, db = null } = {}) {
  const r = payload?.result || payload || {};
  const faction = db && guildId ? getGuildFaction(db, guildId) : "";

  let title, overall, region, mode, population, maps, services, latency, isError;

  switch (subcommand) {
    case "soc": {
      title = "OPS Bridge";
      const healthy = r.bridgeHealth === "healthy" || r.health === "ok";
      isError = !healthy;
      overall = healthy ? "HEALTHY" : "DEGRADED";
      region = "";
      mode = "";
      population = r.totalRequests ? `${r.totalRequests} reqs` : "—";
      maps = [];
      services = r.endpoints ? Object.keys(r.endpoints).length : 0;
      latency = r.avgResponseMs || 0;
      break;
    }
    case "dashboard": {
      title = "OPS Dashboard";
      const ok = r.serverStatus === "healthy" || r.status === "ok";
      isError = !ok;
      overall = ok ? "NOMINAL" : "ISSUE";
      region = "";
      mode = "";
      population = r.onlinePlayers ? `${r.onlinePlayers}` : "—";
      maps = [];
      services = (r.combatEvents24h || 0) + (r.itemsTraded24h || 0);
      latency = 0;
      break;
    }
    case "prometheus": {
      title = "Infrastructure";
      const containers = Array.isArray(r.containers) ? r.containers : [];
      const down = containers.filter(c => c.status !== "running");
      isError = down.length > 0;
      overall = down.length === 0 ? "HEALTHY" : `${down.length} DOWN`;
      region = "";
      mode = r.cpuAvg != null ? `CPU ${r.cpuAvg}%` : "";
      population = r.memAvg != null ? `${r.memAvg}MB` : "—";
      maps = containers.slice(0, 4).map(c => ({
        name: c.name || "?",
        state: c.status === "running" ? "RUNNING" : "DOWN",
        uptime: c.cpuPercent != null ? `CPU ${c.cpuPercent}%` : ""
      }));
      services = containers.length;
      latency = 0;
      break;
    }
    case "activity": {
      title = "Player Activity";
      const active = r.activeLast1h ?? r.activeLastHour ?? 0;
      isError = active === 0;
      overall = active > 0 ? "ACTIVE" : "IDLE";
      region = "";
      mode = "";
      population = active > 0 ? `${active} online` : "—";
      maps = [];
      services = r.totalSessions || 0;
      latency = r.avgSessionMinutes ? `${r.avgSessionMinutes}m avg` : 0;
      break;
    }
    case "combat": {
      title = "Combat Stats";
      const deaths = r.deaths ?? r.totalDeaths ?? 0;
      isError = false;
      overall = deaths > 0 ? `${deaths} deaths` : "PEACEFUL";
      region = "";
      mode = r.kdRatio ? `K/D ${r.kdRatio}` : "";
      population = r.pvpDeaths ? `${r.pvpDeaths} PvP` : "—";
      maps = [];
      services = r.topKiller ? 1 : 0;
      latency = 0;
      break;
    }
    case "resources": {
      title = "Resources";
      const fields = (r.spiceFields || 0) + (r.waterWells || 0) + (r.mineralNodes || 0);
      isError = fields === 0;
      overall = fields > 0 ? "ACTIVE" : "EMPTY";
      region = "";
      mode = "";
      population = r.spiceFields ? `${r.spiceFields} spice` : "—";
      maps = [];
      services = fields;
      latency = 0;
      break;
    }
    case "economy": {
      title = "Economy";
      const currency = r.totalCurrency ?? r.totalSolari ?? 0;
      isError = currency === 0;
      overall = currency > 0 ? "ACTIVE" : "IDLE";
      region = "";
      mode = "";
      population = currency > 0 ? `\u{A0}\u{A0}${currency}` : "—";
      maps = [];
      services = r.activeOrders || 0;
      latency = 0;
      break;
    }
    case "location": {
      title = "Locations";
      const markers = r.totalMarkers || 0;
      isError = markers === 0;
      overall = markers > 0 ? "MAPPED" : "EMPTY";
      region = "";
      mode = r.territories ? `${r.territories} territories` : "";
      population = r.activeMaps ? `${r.activeMaps} maps` : "—";
      maps = (r.hotspots || []).slice(0, 4).map(h => ({
        name: h.name || h.location || "?",
        state: "HOTSPOT",
        uptime: h.players || h.count ? `${h.players || h.count} players` : ""
      }));
      services = markers;
      latency = 0;
      break;
    }
    case "inventory": {
      title = "OPS Inventory";
      const items = r.totalItems || 0;
      isError = items === 0;
      overall = items > 0 ? "TRACKED" : "EMPTY";
      region = "";
      mode = "";
      population = r.uniqueTemplates ? `${r.uniqueTemplates} unique` : "—";
      maps = [];
      services = items;
      latency = 0;
      break;
    }
    case "announcements": {
      const announcements = payload?.announcements || r.announcements || [];
      title = "Announcements";
      isError = announcements.length === 0;
      overall = announcements.length > 0 ? `${announcements.length} new` : "NONE";
      region = "";
      mode = "";
      population = "—";
      maps = [];
      services = announcements.length;
      latency = 0;
      break;
    }
    default:
      return null;
  }

  const resolvedQuote = randomQuote(faction || undefined);
  const ck = cacheKey(guildId || "", title, overall);
  const cached = getCached(ck);

  let buffer;
  if (cached) {
    buffer = cached;
  } else {
    const canvas = await generateStatusCard({
      title,
      overall,
      region,
      mode: typeof mode === "number" ? String(mode) : mode,
      population: typeof population === "number" ? String(population) : population,
      maps,
      services: typeof services === "number" ? services : 0,
      latency: typeof latency === "number" ? latency : 0,
      quote: resolvedQuote,
      faction: faction || undefined,
      isError
    });
    buffer = canvas.toBuffer("image/png");
    setCache(ck, buffer);
  }

  const attachment = new AttachmentBuilder(buffer, { name: "status-card.png" });
  await interaction.editReply({ files: [attachment], embeds: [] });
}
