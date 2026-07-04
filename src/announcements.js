import { redactSecrets } from "./format.js";
import { logInfo, logError } from "./logger.js";

const DEFAULT_POLL_MS = 30000;
const MAX_MESSAGE_LENGTH = 1800;
const SEEN_MAX = 100;

const seenIds = new Set();

export function createAnnouncementBridge({
  adapterClient,
  client,
  channelId,
  onError = () => {}
} = {}) {
  if (!client || !adapterClient || !channelId) {
    return { active: false, reason: "missing client, adapter, or channel" };
  }

  let polling = false;
  let timer;

  const fetchAndPost = async () => {
    if (polling) return;
    polling = true;
    try {
      const response = await adapterClient.announcements();
      const announcements = Array.isArray(response?.result?.announcements)
        ? response.result.announcements
        : [];
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.()) return;

      for (const ann of announcements.slice(0, 10)) {
        const id = ann.id || ann.messageId || `${ann.timestamp || ""}-${ann.message || ""}`;
        if (seenIds.has(id)) continue;
        seenIds.add(id);
        if (seenIds.size > SEEN_MAX) {
          const iter = seenIds.values();
          for (let i = 0; i < 20; i++) seenIds.delete(iter.next().value);
        }

        const content = formatAnnouncement(ann);
        await channel.send(redactSecrets(content));
      }
    } catch (error) {
      if (error?.status !== 404) onError(error);
    } finally {
      polling = false;
    }
  };

  const start = (intervalMs = DEFAULT_POLL_MS) => {
    fetchAndPost();
    timer = setInterval(fetchAndPost, intervalMs);
    timer.unref?.();
    return true;
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    polling = false;
  };

  return {
    active: true,
    channelId,
    start,
    stop,
    resetSeen() { seenIds.clear(); }
  };
}

export function formatAnnouncement(ann) {
  const type = ann.type || "Broadcast";
  const title = ann.title || ann.BroadcastTitle || "";
  const message = ann.message || ann.Body || ann.body || "";
  const timestamp = ann.timestamp || ann.createdAt || "";

  const lines = [];
  lines.push(`**${type}**`);
  if (title) lines.push(`*${String(title).slice(0, 200)}*`);
  if (message) lines.push(String(message).slice(0, MAX_MESSAGE_LENGTH));
  if (timestamp) lines.push(`_${String(timestamp).slice(0, 80)}_`);

  return redactSecrets(lines.join("\n"));
}

export function announcementConfig(env = process.env) {
  return {
    enabled: env.DUNE_ANNOUNCEMENTS_ENABLED === "true",
    channelId: (env.DUNE_ANNOUNCEMENTS_CHANNEL || "").trim(),
    pollIntervalMs: parsePositiveInt(env.DUNE_ANNOUNCEMENTS_POLL_MS, DEFAULT_POLL_MS)
  };
}

function parsePositiveInt(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
