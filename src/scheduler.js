import { redactSecrets } from "./format.js";
import { sendChannelAlert } from "./notifications.js";

export const DEFAULT_SCHEDULER_INTERVAL_MS = 1800000;
export const DEFAULT_RATE_LIMIT_MS = 600000;

const INCIDENT_RING = [];
const MAX_INCIDENTS = 30;

export function recordIncident(type, detail) {
  INCIDENT_RING.push({ type, detail, time: new Date().toISOString() });
  if (INCIDENT_RING.length > MAX_INCIDENTS) INCIDENT_RING.shift();
}

export function getIncidentHistory() {
  return [...INCIDENT_RING].reverse();
}

export function startScheduler({
  client,
  adapterClient,
  config,
  intervalMs = parsePositiveInt(process.env.DUNE_SCHEDULER_INTERVAL_MS, DEFAULT_SCHEDULER_INTERVAL_MS),
  onError = () => {}
} = {}) {
  const allowedChannels = parseCsv(process.env.DUNE_POST_ALLOWED_CHANNELS);
  const scheduleType = (process.env.DUNE_POST_SCHEDULE_TYPE || "none").toLowerCase();
  const rateLimitMs = parsePositiveInt(process.env.DUNE_POST_RATE_LIMIT_MS, DEFAULT_RATE_LIMIT_MS);
  const lastPost = new Map();

  if (scheduleType === "none" || allowedChannels.length === 0) {
    return { active: false, reason: scheduleType === "none" ? "disabled" : "no channels configured" };
  }

  let timer;

  const postStatus = async () => {
    const now = Date.now();
    for (const channelId of allowedChannels) {
      try {
        const last = lastPost.get(channelId) || 0;
        if (now - last < rateLimitMs) continue;

        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased?.()) continue;

        let content;
        if (scheduleType === "status") {
          const status = await adapterClient.status(defaultActor());
          content = formatPayload("Scheduled Server Status", status);
        } else if (scheduleType === "status-summary") {
          const status = await adapterClient.status(defaultActor());
          const r = status?.result || status || {};
          const overall = r.overall || "UNKNOWN";
          if (overall !== "READY" && overall !== "UNKNOWN") {
            recordIncident("status-degraded", `Server status: ${overall}`);
          }
          content = `**Scheduled Status Summary**\nOverall: ${overall} | Title: ${r.title || "unknown"} | Region: ${r.region || "unknown"} | Mode: ${r.mode || "unknown"} | Population: ${r.population || "?"}`;
        } else if (scheduleType === "readiness") {
          const readiness = await adapterClient.readiness(defaultActor());
          content = formatPayload("Scheduled Readiness", readiness);
        } else if (scheduleType === "services") {
          const services = await adapterClient.services(defaultActor());
          content = formatPayload("Scheduled Services", services);
        } else {
          continue;
        }

        await channel.send(redactSecrets(content));
        lastPost.set(channelId, now);
      } catch (error) {
        onError(error);
      }
    }
  };

  timer = setInterval(postStatus, intervalMs);
  timer.unref?.();
  postStatus();

  return {
    active: true,
    scheduleType,
    allowedChannels,
    intervalMs,
    rateLimitMs,
    stop() { clearInterval(timer); }
  };
}

export function parseCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function defaultActor() {
  return { userId: "scheduler", username: "ACP", guildId: "scheduler", channelId: "scheduler", roleIds: [] };
}

export function startDailyDigest({ adapterClient, client, channelId, hour = 8, onError = () => {} } = {}) {
  if (!channelId) return { active: false, reason: "no channel configured" };

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  };

  let timer;

  const runDigest = async () => {
    try {
      const [status, activity, combat, economy, prometheus] = await Promise.allSettled([
        adapterClient.status(defaultActor()).catch(() => null),
        adapterClient.opsActivity(defaultActor()).catch(() => null),
        adapterClient.opsCombat(defaultActor()).catch(() => null),
        adapterClient.opsEconomy(defaultActor()).catch(() => null),
        adapterClient.opsPrometheus(defaultActor()).catch(() => null)
      ]);

      const getResult = (settled) => settled.status === "fulfilled" && settled.value ? (settled.value.result || settled.value) : {};

      const statusData = getResult(status);
      const activityData = getResult(activity);
      const combatData = getResult(combat);
      const economyData = getResult(economy);
      const promData = getResult(prometheus);
      const summary = statusData.summary || {};

      const lines = [];
      lines.push(`**Daily Server Digest — ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}**`);
      lines.push("");
      lines.push(`**Population:** ${summary.population || "?"} total — ${activityData.onlinePlayers ?? summary.online ?? "?"} online`);
      if (activityData.activeLast24h !== undefined) lines.push(`**Active (24h):** ${activityData.activeLast24h} | **New (7d):** ${activityData.newPlayers ?? "?"} | **Returning:** ${activityData.returningPlayers ?? "?"}`);
      lines.push("");
      lines.push(`**Combat:** ${combatData.totalDeaths ?? "?"} deaths in 24h`);
      if (combatData.deathsByCause?.length) {
        lines.push(`  Top causes: ${combatData.deathsByCause.slice(0, 3).map(c => `${c.cause}: ${c.count}`).join(", ")}`);
      }
      lines.push("");
      lines.push(`**Economy:** ${economyData.totalSupply !== undefined ? `${economyData.totalSupply.toLocaleString()} Solaris` : "?"} (${economyData.totalCurrencyHolders ?? "?"} holders)`);
      if (economyData.activeOrders !== undefined) lines.push(`  Active orders: ${economyData.activeOrders} | Tax/fees: ${economyData.totalTaxFees?.toLocaleString() ?? "?"}`);
      lines.push("");
      const services = promData.services || {};
      const serviceStatus = Object.entries(services).map(([k, v]) => `${k.replace("dune-", "")}:${v}`).join("  ");
      lines.push(`**Infrastructure:** CPU: ${promData.summary?.avgCpuPercent ?? "?"}% | Memory: ${promData.summary?.avgMemoryMb ?? "?"} MB${serviceStatus ? ` | ${serviceStatus}` : ""}`);
      lines.push("");
      lines.push(`Full dashboard: https://console.darkdante.org`);
      lines.push(`Grafana: https://grafana.darkdante.org`);

      await sendChannelAlert(client, channelId, redactSecrets(lines.join("\n")));

      // Reschedule for next day
      timer = setTimeout(runDigest, scheduleNext());
      timer.unref?.();
    } catch (error) {
      onError(error);
      timer = setTimeout(runDigest, scheduleNext());
      timer.unref?.();
    }
  };

  timer = setTimeout(runDigest, scheduleNext());
  timer.unref?.();

  return {
    active: true,
    hour,
    stop() { clearTimeout(timer); }
  };
}
