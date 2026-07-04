import { TextChannel } from "discord.js";
import { formatPayload, formatError, redactSecrets } from "./format.js";

export const DEFAULT_SCHEDULER_INTERVAL_MS = 300000;
export const DEFAULT_RATE_LIMIT_MS = 600000;

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
          const summary = status?.result?.summary || {};
          content = `**Scheduled Status Summary**\nServices: ${summary.overall || "UNKNOWN"} | Region: ${summary.region || "unknown"} | Mode: ${summary.mode || "unknown"}`;
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
  return { userId: "scheduler", guildId: "scheduler", channelId: "scheduler", roleIds: [] };
}
