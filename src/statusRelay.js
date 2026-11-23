import { readFileSync } from "node:fs";
import { duneEmbed } from "./embedFormat.js";
import { randomComputationOpener } from "./quotes.js";
import { postOrEditLiveMessage } from "./liveMessage.js";
import { constantTimeStringsEqual } from "./secretsCrypto.js";
import { logError, logInfo } from "./logger.js";

// statusRelay.js (mentat#469): monitoring posts that come FROM Mentat, in
// Sahir Venn's voice, instead of from a webhook with a generic name.
//
//  * POST /api/status/relay -- a monitoring job on the game server pushes
//    structured data ({state, headline, fields[]}); the bot renders it with
//    duneEmbed() (persona footer, Mentat-voiced description, random quote)
//    and keeps ONE message up to date via postOrEditLiveMessage (key "status").
//  * alertEmbeds() -- the same voice for Alertmanager firing/resolved posts,
//    used by /api/alerts/relay when DUNE_ALERT_RELAY_CHANNEL_ID is set.
//
// Data is pushed to the bot, never pulled from the monitoring host, so the
// bot needs no network path to Prometheus. Everything here is off by
// default (no token and channel configured, no behaviour), so an existing
// deployment is unaffected (Requirement 0).

export const STATUS_MESSAGE_KEY = "status";
const MIN_SECONDS_BETWEEN_UPDATES = 10;
const LIMITS = { headline: 80, note: 300, fieldName: 40, fieldValue: 300, fields: 20, body: 32 * 1024, fieldsText: 4000 };

const STATES = {
  ok: { emoji: "🟢", color: "success" },
  degraded: { emoji: "🟡", color: "warning" },
  down: { emoji: "🔴", color: "error" },
  unknown: { emoji: "⚪", color: "warning" }
};

// Mentat voice per state. Computational and calm; never alarmist or taunting.
const STATE_PHRASES = {
  ok: [
    "The sands are calm. I have run the numbers and the realm is sound.",
    "Every measure agrees: the server stands ready.",
    "Computation complete. Nothing in the data warrants concern.",
    "The figures are in order. The realm holds."
  ],
  degraded: [
    "The numbers show strain. I am watching them closely.",
    "Something in the data has shifted. It is not yet a crisis.",
    "The realm holds, though not without effort.",
    "A deviation from the expected. I will report as it develops."
  ],
  down: [
    "The realm does not answer. I am attending to it.",
    "The data is grim: the server is not serving.",
    "A disturbance in the sands. The pattern is being traced.",
    "The instruments show no life where there should be."
  ],
  unknown: [
    "I cannot reach the instruments. I will not guess at what I cannot measure.",
    "The data has gone silent. I do not guess.",
    "My view of the realm is incomplete; I will say no more than I know."
  ]
};

const ALERT_VOICE = {
  firing: [
    "A disturbance in the figures.",
    "The data has crossed a threshold I was told to watch.",
    "I have observed something that merits attention."
  ],
  resolved: [
    "The figures have returned to their course.",
    "The disturbance has passed; the data is in order again.",
    "Computation complete: the measure is back within bounds."
  ]
};

function pick(list, random = Math.random) {
  return list[Math.floor(random() * list.length)];
}

// multiline keeps line breaks (a field value may be several short lines) but
// still collapses runs of spaces and blank lines; single-line text (names,
// headlines) is flattened.
function clip(value, max, { multiline = false } = {}) {
  const raw = String(value ?? "");
  const text = (multiline
    ? raw.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n")
    : raw.replace(/\s+/g, " ")).trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

let warnedUnreadableTokenFile = "";

export function statusRelayToken(env = process.env) {
  const direct = (env.DUNE_STATUS_RELAY_TOKEN || "").trim();
  if (direct) return direct;
  const file = env.DUNE_STATUS_RELAY_TOKEN_FILE || "";
  if (!file) return "";
  try {
    return readFileSync(file, "utf8").trim();
  } catch (error) {
    // A mis-set secret path must not look the same as the feature being off.
    if (warnedUnreadableTokenFile !== file) {
      warnedUnreadableTokenFile = file;
      logError("status_relay.token_file_unreadable", error, { file });
    }
    return "";
  }
}

// Returns {ok:true, value} or {ok:false, error}. The embed is built only from
// what this returns, never from the raw body.
export function validateStatusPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Body must be a JSON object." };
  if (!Object.hasOwn(STATES, body.state)) return { ok: false, error: `state must be one of: ${Object.keys(STATES).join(", ")}.` };
  const headline = clip(body.headline, LIMITS.headline);
  if (!headline) return { ok: false, error: "headline is required." };
  const rawFields = body.fields === undefined ? [] : body.fields;
  if (!Array.isArray(rawFields) || rawFields.length > LIMITS.fields) {
    return { ok: false, error: `fields must be an array of at most ${LIMITS.fields}.` };
  }
  const fields = [];
  for (const f of rawFields) {
    if (!f || typeof f !== "object") return { ok: false, error: "each field must be an object." };
    const name = clip(f.name, LIMITS.fieldName);
    const value = clip(f.value, LIMITS.fieldValue, { multiline: true });
    if (!name || !value) return { ok: false, error: "each field needs a name and a value." };
    fields.push({ name, value, inline: f.inline !== false });
  }
  // Discord caps one embed's total text at 6000 characters; the voice, quote and footer need about 1000 of that.
  if (fields.reduce((n, f) => n + f.name.length + f.value.length, 0) > LIMITS.fieldsText) {
    return { ok: false, error: `fields hold more than ${LIMITS.fieldsText} characters of text in total.` };
  }
  const note = body.note === undefined ? "" : clip(body.note, LIMITS.note);
  return { ok: true, value: { state: body.state, headline, fields, note } };
}

export function formatStatusEmbed(value, { nowMs = Date.now(), random = Math.random } = {}) {
  const state = STATES[value.state];
  const epoch = Math.floor(nowMs / 1000);
  const lines = [
    `*${randomComputationOpener()}*`,
    `### ${state.emoji} ${value.headline}`,
    pick(STATE_PHRASES[value.state], random)
  ];
  if (value.note) lines.push(`*${value.note}*`);
  lines.push(`Last updated <t:${epoch}:R>`);
  return duneEmbed({
    title: "Server status",
    color: state.color,
    description: lines.join("\n"),
    fields: value.fields,
    timestamp: true,
    // The repo withholds the quote on error-coloured embeds (#218) because a
    // faction quote under a failure can read as taunting. These are the
    // generic computational asides, so the Mentat signs a down state too.
    quote: true
  });
}

function parseTime(text) {
  const ms = Date.parse(text || "");
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// Alertmanager firing/resolved alerts -> Mentat-voiced embeds (one per alert).
export function alertEmbeds(alerts, { random = Math.random } = {}) {
  return alerts.map((alert) => {
    const firing = alert?.status === "firing";
    const labels = alert?.labels || {};
    const notes = alert?.annotations || {};
    const severity = labels.severity || "unknown";
    const color = !firing ? "success" : severity === "critical" ? "error" : "warning";
    const name = clip(labels.alertname || "Unnamed alert", 100);
    const lines = [`*${pick(firing ? ALERT_VOICE.firing : ALERT_VOICE.resolved, random)}*`];
    if (notes.summary) lines.push(`**${clip(notes.summary, 200)}**`);
    if (notes.description) lines.push(clip(notes.description, 600));
    const when = parseTime(firing ? alert?.startsAt : alert?.endsAt) ?? parseTime(alert?.startsAt);
    const fields = [{ name: "Severity", value: clip(severity, 40), inline: true }];
    if (labels.instance) fields.push({ name: "Source", value: clip(labels.instance, 100), inline: true });
    if (when) fields.push({ name: firing ? "Since" : "Resolved", value: `<t:${when}:R>`, inline: true });
    return duneEmbed({
      title: `${firing ? "🔥 Disturbance" : "✅ Restored"} — ${name}`,
      color,
      description: lines.join("\n"),
      fields,
      timestamp: false,
      quote: true
    });
  });
}

// Discord caps the combined text of all embeds in ONE message at 6000 characters (and 10 embeds), so a fixed
// batch of 10 can be rejected. Chunk by cumulative size instead.
function embedChars(embed) {
  const e = embed.toJSON ? embed.toJSON() : embed;
  return (e.title?.length || 0) + (e.description?.length || 0) + (e.footer?.text?.length || 0) + (e.author?.name?.length || 0) +
    (e.fields || []).reduce((n, f) => n + (f.name?.length || 0) + (f.value?.length || 0), 0);
}

export function chunkEmbedsBySize(embeds, { maxChars = 5500, maxCount = 10 } = {}) {
  const chunks = [];
  let current = [];
  let size = 0;
  for (const embed of embeds) {
    const n = embedChars(embed);
    if (current.length && (current.length >= maxCount || size + n > maxChars)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(embed);
    size += n;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

// Posts alerts as the bot, one message per size-safe chunk. Never throws; reports what did and did not go out so the
// caller can fall back for the rest instead of re-sending what already posted (Alertmanager retries on a non-2xx).
export async function postAlertsAsBot({ client, channelId, alerts }) {
  const unposted = [];
  let posted = 0;
  let channel = null;
  try {
    channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased?.()) throw new Error(`Channel ${channelId} is not text-based.`);
  } catch (error) {
    logError("alerts_relay.channel_unavailable", error, {});
    return { posted: 0, unposted: alerts.slice() };
  }
  const embeds = alertEmbeds(alerts);
  let offset = 0;
  for (const chunk of chunkEmbedsBySize(embeds)) {
    const slice = alerts.slice(offset, offset + chunk.length);
    offset += chunk.length;
    try {
      await channel.send({ embeds: chunk, allowedMentions: { parse: [] } });
      posted += chunk.length;
    } catch (error) {
      logError("alerts_relay.bot_post_failed", error, { alerts: chunk.length });
      unposted.push(...slice);
    }
  }
  return { posted, unposted };
}

// POST /api/status/relay handler. Fails closed: with no token or no channel
// configured it does nothing (503), and a wrong or missing bearer is a 401
// before the body is looked at.
export function createStatusRelayHandler({ client, db, env = process.env, now = Date.now }) {
  let lastAcceptedMs = 0;
  let lastState = null;
  let seq = 0; // identifies the latest reservation so an older failure cannot undo a newer one
  let chain = Promise.resolve(); // updates are applied one at a time, in arrival order
  let lastUnauthorizedLogMs = 0;
  let suppressedUnauthorized = 0;

  async function apply(channelId, value, nowMs) {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased?.() || !channel.guildId) throw new Error(`Channel ${channelId} is not a guild text channel.`);
    return postOrEditLiveMessage({
      client,
      db,
      guildId: channel.guildId,
      channelId,
      messageKey: STATUS_MESSAGE_KEY,
      strictChannel: true,
      rethrowTransient: true,
      content: { embeds: [formatStatusEmbed(value, { nowMs })], allowedMentions: { parse: [] } }
    });
  }

  return async function statusRelay(req, res) {
    const token = statusRelayToken(env);
    const channelId = env.DUNE_STATUS_CHANNEL_ID || "";
    if (!token || !channelId || !client) {
      return res.status(503).json({ error: "Status relay is not configured." });
    }
    const header = req.get("authorization") || "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!constantTimeStringsEqual(provided, token)) {
      // An internet scanner must not be able to flood the log: one line a minute, with a count of what was skipped.
      const t = now();
      if (t - lastUnauthorizedLogMs >= 60_000) {
        logError("status_relay.unauthorized", new Error("Missing or invalid bearer token"), { remote: req.ip, hasAuthHeader: Boolean(header), suppressed: suppressedUnauthorized });
        lastUnauthorizedLogMs = t;
        suppressedUnauthorized = 0;
      } else {
        suppressedUnauthorized += 1;
      }
      return res.status(401).json({ error: "Unauthorized." });
    }
    // The global JSON parser has already run (default 100 kb), so enforce this route's own, smaller limit here.
    // (Content-Length can be absent on a chunked request, so measure the parsed body as well.)
    if (Number(req.get("content-length") || 0) > LIMITS.body || JSON.stringify(req.body ?? null).length > LIMITS.body) {
      return res.status(413).json({ error: `Body too large (limit ${LIMITS.body} bytes).` });
    }
    const checked = validateStatusPayload(req.body);
    if (!checked.ok) return res.status(400).json({ error: checked.error });

    const nowMs = now();
    // Flood protection, but never at the cost of a real change: a different state always goes through.
    if (checked.value.state === lastState && nowMs - lastAcceptedMs < MIN_SECONDS_BETWEEN_UPDATES * 1000) {
      return res.status(429).json({ error: `At most one unchanged update every ${MIN_SECONDS_BETWEEN_UPDATES} seconds.` });
    }
    // Reserve synchronously, before any await, so two simultaneous requests cannot both pass the check.
    const previous = { lastAcceptedMs, lastState };
    const mine = ++seq;
    lastAcceptedMs = nowMs;
    lastState = checked.value.state;
    const job = chain.then(() => apply(channelId, checked.value, nowMs));
    chain = job.catch(() => {});
    try {
      const result = await job;
      logInfo("status_relay.updated", { edited: result.edited, state: checked.value.state });
      return res.json({ ok: true, edited: result.edited });
    } catch (error) {
      if (seq === mine) {
        lastAcceptedMs = previous.lastAcceptedMs;
        lastState = previous.lastState;
      }
      logError("status_relay.failed", error, {});
      return res.status(502).json({ error: "Could not update the status message." });
    }
  };
}
