import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createDatabase, getLiveMessage, setLiveMessage } from "../src/database.js";
import { createSetupServer } from "../src/setupServer.js";
import {
  STATUS_MESSAGE_KEY,
  alertEmbeds,
  chunkEmbedsBySize,
  createStatusRelayHandler,
  formatStatusEmbed,
  statusRelayToken,
  validateStatusPayload
} from "../src/statusRelay.js";

// statusRelay.js (mentat#469): monitoring posts from Mentat in Sahir Venn's voice.

const good = {
  state: "ok",
  headline: "Online",
  fields: [
    { name: "Players", value: "3 / 120" },
    { name: "Server CPU", value: "9%", inline: false }
  ]
};

function fakeChannel({ id = "chan-1", guildId = "guild-1", isTextBased = true } = {}) {
  const sent = [];
  const edited = [];
  return {
    id,
    guildId,
    isTextBased: () => isTextBased,
    send: async (content) => { sent.push(content); return { id: `msg-${sent.length}` }; },
    messages: { fetch: async (messageId) => ({ id: messageId, edit: async (content) => { edited.push(content); } }) },
    _sent: sent,
    _edited: edited
  };
}

function fakeClient(channels) {
  return { channels: { fetch: async (id) => { const c = channels[id]; if (!c) throw new Error(`no channel ${id}`); return c; } } };
}

function fakeRes() {
  return { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
}

function fakeReq({ token, body = good } = {}) {
  return { ip: "203.0.113.9", body, get: (h) => (h.toLowerCase() === "authorization" && token !== undefined ? `Bearer ${token}` : "") };
}

const env = { DUNE_STATUS_RELAY_TOKEN: "relay-secret", DUNE_STATUS_CHANNEL_ID: "chan-1" };

// ── validation ──────────────────────────────────────────────────────────────

test("validateStatusPayload accepts a well-formed payload and defaults inline to true", () => {
  const r = validateStatusPayload(good);
  assert.equal(r.ok, true);
  assert.equal(r.value.state, "ok");
  assert.equal(r.value.fields[0].inline, true);
  assert.equal(r.value.fields[1].inline, false);
});

test("validateStatusPayload rejects bad shapes, unknown states and oversized field lists", () => {
  for (const body of [null, [], "x", {}, { state: "great", headline: "x" }, { state: "ok" }, { state: "ok", headline: "   " },
    { state: "ok", headline: "x", fields: "no" }, { state: "ok", headline: "x", fields: [{ name: "a" }] },
    { state: "ok", headline: "x", fields: Array.from({ length: 21 }, () => ({ name: "a", value: "b" })) }]) {
    assert.equal(validateStatusPayload(body).ok, false, JSON.stringify(body));
  }
});

test("validateStatusPayload clips long text instead of passing it through", () => {
  const r = validateStatusPayload({ state: "ok", headline: "h".repeat(500), note: "n".repeat(900), fields: [{ name: "x".repeat(200), value: "y".repeat(2000) }] });
  assert.equal(r.ok, true);
  assert.ok(r.value.headline.length <= 80 && r.value.note.length <= 300);
  assert.ok(r.value.fields[0].name.length <= 40 && r.value.fields[0].value.length <= 300);
});

test("validateStatusPayload keeps line breaks in a field value but flattens names and the headline", () => {
  const r = validateStatusPayload({ state: "ok", headline: "On\nline", fields: [{ name: "A\nB", value: "Smooth\r\nServer tick: 20 Hz\n\n\n\nLag:   0" }] });
  assert.equal(r.value.headline, "On line");
  assert.equal(r.value.fields[0].name, "A B");
  assert.equal(r.value.fields[0].value, "Smooth\nServer tick: 20 Hz\n\nLag: 0");
});

// ── the Mentat voice ────────────────────────────────────────────────────────

test("formatStatusEmbed speaks as Sahir Venn: footer, quote signature, state phrase and last-updated time", () => {
  const embed = formatStatusEmbed(validateStatusPayload(good).value, { nowMs: 1_800_000_000_000, random: () => 0 }).toJSON();
  assert.equal(embed.title, "Server status");
  assert.match(embed.footer.text, /Sahir Venn — Mentat/);
  assert.match(embed.description, /### 🟢 Online/);
  assert.match(embed.description, /The sands are calm/);
  assert.match(embed.description, /Last updated <t:1800000000:R>/);
  const quote = embed.fields.at(-1);
  assert.match(quote.value, /— Sahir Venn$/, "the random quote is signed by Sahir Venn");
  assert.equal(embed.fields[0].name, "Players");
});

test("formatStatusEmbed keeps the signed quote on a down state (generic computational asides, not taunts)", () => {
  const embed = formatStatusEmbed(validateStatusPayload({ state: "down", headline: "Offline" }).value).toJSON();
  assert.match(embed.fields.at(-1).value, /— Sahir Venn$/);
  assert.equal(embed.color, 0xE74C3C);
});

test("formatStatusEmbed varies the quote across calls", () => {
  const value = validateStatusPayload(good).value;
  const seen = new Set();
  for (let i = 0; i < 40; i += 1) seen.add(formatStatusEmbed(value).toJSON().fields.at(-1).value);
  assert.ok(seen.size > 1, "quotes are random, not fixed");
});

test("alertEmbeds: firing and resolved are Mentat-voiced, signed, and use relative times", () => {
  const [firing, resolved] = alertEmbeds([
    { status: "firing", labels: { alertname: "DuneTickRateLow", severity: "warning", instance: "x:1" }, annotations: { summary: "tick low", description: "below 18" }, startsAt: "2026-11-23T10:00:00Z" },
    { status: "resolved", labels: { alertname: "DuneTickRateLow", severity: "warning" }, annotations: { summary: "tick low" }, startsAt: "2026-11-23T10:00:00Z", endsAt: "2026-11-23T10:30:00Z" }
  ]).map((e) => e.toJSON());
  assert.match(firing.title, /^🔥 Disturbance — DuneTickRateLow$/);
  assert.equal(firing.color, 0xF39C12);
  assert.match(firing.fields.find((f) => f.name === "Since").value, /^<t:\d+:R>$/);
  assert.match(resolved.title, /^✅ Restored — DuneTickRateLow$/);
  assert.equal(resolved.color, 0x2ECC71);
  assert.equal(resolved.fields.find((f) => f.name === "Resolved").value, `<t:${Math.floor(Date.parse("2026-11-23T10:30:00Z") / 1000)}:R>`);
  for (const e of [firing, resolved]) {
    assert.match(e.footer.text, /Sahir Venn — Mentat/);
    assert.match(e.fields.at(-1).value, /— Sahir Venn$/);
  }
});

test("alertEmbeds: a critical alert is red, and a malformed alert does not throw", () => {
  const [critical, odd] = alertEmbeds([
    { status: "firing", labels: { alertname: "X", severity: "critical" }, annotations: {}, startsAt: "2026-11-23T10:00:00Z" },
    {}
  ]).map((e) => e.toJSON());
  assert.equal(critical.color, 0xE74C3C);
  assert.match(odd.title, /Unnamed alert/);
});

// ── the handler ─────────────────────────────────────────────────────────────

test("handler is closed (503) when the token or channel is not configured", async () => {
  const db = createDatabase(":memory:");
  const client = fakeClient({ "chan-1": fakeChannel() });
  for (const e of [{}, { DUNE_STATUS_RELAY_TOKEN: "t" }, { DUNE_STATUS_CHANNEL_ID: "chan-1" }]) {
    const res = fakeRes();
    await createStatusRelayHandler({ client, db, env: e })(fakeReq({ token: "t" }), res);
    assert.equal(res.code, 503);
  }
});

test("handler rejects a missing or wrong bearer token (401) before touching the body or Discord", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": channel }), db, env });
  for (const token of [undefined, "wrong", ""]) {
    const res = fakeRes();
    await handler(fakeReq({ token, body: { not: "valid" } }), res);
    assert.equal(res.code, 401);
  }
  assert.equal(channel._sent.length, 0);
});

test("handler posts once, records it under the channel's real guild, then edits that same message", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  let t = 1_800_000_000_000;
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": channel }), db, env, now: () => t });

  const first = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), first);
  assert.equal(first.code, 200);
  assert.equal(first.body.edited, false);
  assert.equal(channel._sent.length, 1);
  assert.deepEqual(channel._sent[0].allowedMentions, { parse: [] }, "never pings anyone");
  assert.equal(getLiveMessage(db, "guild-1", STATUS_MESSAGE_KEY).message_id, "msg-1");

  t += 300_000;
  const second = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), second);
  assert.equal(second.code, 200);
  assert.equal(second.body.edited, true);
  assert.equal(channel._sent.length, 1, "no second post");
  assert.equal(channel._edited.length, 1);
});

test("handler answers 400 for a bad payload and 429 for updates faster than every 10 seconds", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  let t = 1_800_000_000_000;
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": channel }), db, env, now: () => t });
  const bad = fakeRes();
  await handler(fakeReq({ token: "relay-secret", body: { state: "nope" } }), bad);
  assert.equal(bad.code, 400);
  await handler(fakeReq({ token: "relay-secret" }), fakeRes());
  t += 2000;
  const fast = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), fast);
  assert.equal(fast.code, 429);
});

test("handler returns 502 with a generic message when Discord fails (no internals leaked)", async () => {
  const db = createDatabase(":memory:");
  const handler = createStatusRelayHandler({ client: fakeClient({}), db, env });
  const res = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), res);
  assert.equal(res.code, 502);
  assert.equal(res.body.error, "Could not update the status message.");
});

test("statusRelayToken reads a direct value or a file, and returns empty when neither works", () => {
  assert.equal(statusRelayToken({ DUNE_STATUS_RELAY_TOKEN: " abc " }), "abc");
  assert.equal(statusRelayToken({ DUNE_STATUS_RELAY_TOKEN_FILE: "/nonexistent/path" }), "");
  assert.equal(statusRelayToken({}), "");
});

// ── over HTTP: the real routes in createSetupServer ─────────────────────────

async function withApp(discordClient, fn) {
  const app = createSetupServer({ dbPath: ":memory:", discordClientId: "client-id", baseUrl: "http://localhost:3100", discordClient });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withEnv(overrides, fn) {
  const previous = {};
  for (const k of Object.keys(overrides)) previous[k] = process.env[k];
  Object.assign(process.env, overrides);
  try { return await fn(); } finally {
    for (const k of Object.keys(overrides)) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; }
  }
}

test("POST /api/status/relay over HTTP: 401 without the token, 200 and a signed post with it", async () => {
  const channel = fakeChannel();
  await withEnv({ DUNE_STATUS_RELAY_TOKEN: "relay-secret", DUNE_STATUS_CHANNEL_ID: "chan-1" }, () =>
    withApp(fakeClient({ "chan-1": channel }), async (base) => {
      const denied = await fetch(`${base}/api/status/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(good) });
      assert.equal(denied.status, 401);
      const ok = await fetch(`${base}/api/status/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer relay-secret" },
        body: JSON.stringify(good)
      });
      assert.equal(ok.status, 200);
      assert.equal(channel._sent.length, 1);
      assert.match(channel._sent[0].embeds[0].toJSON().footer.text, /Sahir Venn — Mentat/);
    })
  );
});

test("POST /api/status/relay is closed (503) when not configured, even with a bearer", async () => {
  await withEnv({ DUNE_STATUS_RELAY_TOKEN: "", DUNE_STATUS_RELAY_TOKEN_FILE: "", DUNE_STATUS_CHANNEL_ID: "" }, () =>
    withApp(fakeClient({}), async (base) => {
      const res = await fetch(`${base}/api/status/relay`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer x" }, body: JSON.stringify(good) });
      assert.equal(res.status, 503);
    })
  );
});

test("POST /api/alerts/relay posts as the bot when DUNE_ALERT_RELAY_CHANNEL_ID is set, and never touches the webhook", async () => {
  const channel = fakeChannel({ id: "alerts-1" });
  let webhookCalls = 0;
  const realFetch = globalThis.fetch;
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "alert-secret", DUNE_ALERT_RELAY_CHANNEL_ID: "alerts-1", DUNE_ALERT_WEBHOOK_URL: "http://127.0.0.1:9/never" }, () =>
    withApp(fakeClient({ "alerts-1": channel }), async (base) => {
      globalThis.fetch = async (url, init) => { if (String(url).includes(":9/never")) { webhookCalls += 1; } return realFetch(url, init); };
      try {
        const res = await fetch(`${base}/api/alerts/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer alert-secret" },
          body: JSON.stringify({ alerts: [{ status: "firing", labels: { alertname: "T", severity: "warning" }, annotations: { summary: "s" }, startsAt: "2026-11-23T10:00:00Z" }] })
        });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.via, "bot");
        assert.equal(channel._sent.length, 1);
        assert.match(channel._sent[0].embeds[0].toJSON().title, /Disturbance — T/);
        assert.deepEqual(channel._sent[0].allowedMentions, { parse: [] });
        assert.equal(webhookCalls, 0);
      } finally {
        globalThis.fetch = realFetch;
      }
    })
  );
});

test("POST /api/alerts/relay keeps the old webhook behaviour when DUNE_ALERT_RELAY_CHANNEL_ID is unset", async () => {
  const channel = fakeChannel({ id: "alerts-1" });
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_RELAY_CHANNEL_ID: "", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withApp(fakeClient({ "alerts-1": channel }), async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alerts: [{ status: "firing", labels: { alertname: "T" }, annotations: {}, startsAt: "2026-11-23T10:00:00Z" }] })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.webhookConfigured, false);
      assert.equal(channel._sent.length, 0, "the bot does not post unless the channel is configured");
    })
  );
});

// ── review fixes (mentat#469) ───────────────────────────────────────────────

test("a state change inside the 10 second window is NOT dropped; the same state is still throttled", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  let t = 1_800_000_000_000;
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": channel }), db, env, now: () => t });
  await handler(fakeReq({ token: "relay-secret" }), fakeRes());
  t += 3000;
  const down = fakeRes();
  await handler(fakeReq({ token: "relay-secret", body: { state: "down", headline: "Offline" } }), down);
  assert.equal(down.code, 200, "ok -> down must go through even 3 seconds later");
  t += 3000;
  const again = fakeRes();
  await handler(fakeReq({ token: "relay-secret", body: { state: "down", headline: "Offline" } }), again);
  assert.equal(again.code, 429);
});

test("two simultaneous identical updates cannot both reach Discord (the slot is reserved before any await)", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  const slow = fakeClient({ "chan-1": channel });
  const realFetch = slow.channels.fetch;
  slow.channels.fetch = async (id) => { await new Promise((r) => setTimeout(r, 25)); return realFetch(id); };
  const handler = createStatusRelayHandler({ client: slow, db, env, now: () => 1_800_000_000_000 });
  const [a, b] = [fakeRes(), fakeRes()];
  await Promise.all([handler(fakeReq({ token: "relay-secret" }), a), handler(fakeReq({ token: "relay-secret" }), b)]);
  assert.deepEqual([a.code, b.code].sort(), [200, 429]);
  assert.equal(channel._sent.length, 1);
});

test("a failed update does not consume the throttle slot, so the retry is accepted", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  let broken = true;
  const client = { channels: { fetch: async (id) => { if (broken) throw new Error("boom"); return channel; } } };
  const handler = createStatusRelayHandler({ client, db, env, now: () => 1_800_000_000_000 });
  const first = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), first);
  assert.equal(first.code, 502);
  broken = false;
  const retry = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), retry);
  assert.equal(retry.code, 200);
});

test("changing DUNE_STATUS_CHANNEL_ID posts a fresh message in the new channel instead of editing the old one", async () => {
  const db = createDatabase(":memory:");
  const oldChannel = fakeChannel({ id: "old-chan", guildId: "guild-1" });
  const newChannel = fakeChannel({ id: "chan-1", guildId: "guild-1" });
  setLiveMessage(db, "guild-1", STATUS_MESSAGE_KEY, "old-chan", "old-msg");
  const handler = createStatusRelayHandler({ client: fakeClient({ "old-chan": oldChannel, "chan-1": newChannel }), db, env });
  const res = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.edited, false);
  assert.equal(newChannel._sent.length, 1);
  assert.equal(oldChannel._edited.length, 0);
  assert.equal(getLiveMessage(db, "guild-1", STATUS_MESSAGE_KEY).channel_id, "chan-1");
});

test("an oversized body is refused with 413 after authentication", async () => {
  const db = createDatabase(":memory:");
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": fakeChannel() }), db, env });
  const req = fakeReq({ token: "relay-secret" });
  const realGet = req.get;
  req.get = (h) => (h.toLowerCase() === "content-length" ? String(64 * 1024) : realGet(h));
  const res = fakeRes();
  await handler(req, res);
  assert.equal(res.code, 413);
  const unauth = fakeReq({ token: "wrong" });
  unauth.get = (h) => (h.toLowerCase() === "content-length" ? String(64 * 1024) : "");
  const res2 = fakeRes();
  await handler(unauth, res2);
  assert.equal(res2.code, 401, "authentication is checked before the size");
});

test("chunkEmbedsBySize respects the 6000-character and 10-embed limits", () => {
  const big = (n) => ({ toJSON: () => ({ title: "t", description: "d".repeat(n), fields: [], footer: { text: "f" } }) });
  const bySize = chunkEmbedsBySize([big(2000), big(2000), big(2000), big(2000)]);
  assert.deepEqual(bySize.map((c) => c.length), [2, 2], "two at a time, not four");
  const byCount = chunkEmbedsBySize(Array.from({ length: 23 }, () => big(10)));
  assert.deepEqual(byCount.map((c) => c.length), [10, 10, 3]);
  assert.deepEqual(chunkEmbedsBySize([]), []);
  const worst = alertEmbeds(Array.from({ length: 10 }, (_, i) => ({ status: "firing", labels: { alertname: `A${i}`, severity: "warning", instance: "x".repeat(100) }, annotations: { summary: "s".repeat(300), description: "d".repeat(900) }, startsAt: "2026-11-23T10:00:00Z" })));
  for (const chunk of chunkEmbedsBySize(worst)) {
    const chars = chunk.reduce((n, e) => { const j = e.toJSON(); return n + j.title.length + j.description.length + j.footer.text.length + j.fields.reduce((m, f) => m + f.name.length + f.value.length, 0); }, 0);
    assert.ok(chars <= 6000, `chunk of ${chunk.length} was ${chars} characters`);
  }
});

function alertBody(count) {
  return JSON.stringify({ alerts: Array.from({ length: count }, (_, i) => ({ status: "firing", labels: { alertname: `A${i}`, severity: "warning" }, annotations: { summary: "s".repeat(300), description: "d".repeat(900) }, startsAt: "2026-11-23T10:00:00Z" })) });
}

async function withCaptureWebhook(fn) {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => { received.push(JSON.parse(body)); res.end("{}"); });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}/hook`, received); } finally { await new Promise((r) => server.close(r)); }
}

test("when the bot cannot post, alerts fall back to the webhook instead of being lost", async () => {
  const channel = fakeChannel({ id: "alerts-1" });
  channel.send = async () => { throw new Error("Missing Permissions"); };
  await withCaptureWebhook((hookUrl, received) =>
    withEnv({ DUNE_ALERT_RELAY_TOKEN: "alert-secret", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_RELAY_CHANNEL_ID: "alerts-1", DUNE_ALERT_WEBHOOK_URL: hookUrl }, () =>
      withApp(fakeClient({ "alerts-1": channel }), async (base) => {
        const res = await fetch(`${base}/api/alerts/relay`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer alert-secret" }, body: alertBody(3) });
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.webhookConfigured, true);
        assert.equal(body.total, 3);
        assert.equal(body.relayed, 3);
        assert.equal(received.reduce((n, p) => n + p.embeds.length, 0), 3, "all three alerts reached the webhook");
      })
    )
  );
});

test("a partial bot failure with no webhook answers 200 (so Alertmanager does not duplicate) and reports the shortfall", async () => {
  const channel = fakeChannel({ id: "alerts-1" });
  let calls = 0;
  channel.send = async (content) => { calls += 1; if (calls === 2) throw new Error("rate limited"); channel._sent.push(content); return { id: `m${calls}` }; };
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "alert-secret", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_RELAY_CHANNEL_ID: "alerts-1", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withApp(fakeClient({ "alerts-1": channel }), async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer alert-secret" }, body: alertBody(6) });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.via, "bot");
      assert.ok(body.relayed > 0 && body.skipped > 0 && body.relayed + body.skipped === 6, JSON.stringify(body));
    })
  );
});

test("nothing posted and no webhook is a 502, so Alertmanager retries", async () => {
  const channel = fakeChannel({ id: "alerts-1" });
  channel.send = async () => { throw new Error("Missing Permissions"); };
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "alert-secret", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_RELAY_CHANNEL_ID: "alerts-1", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withApp(fakeClient({ "alerts-1": channel }), async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer alert-secret" }, body: alertBody(2) });
      assert.equal(res.status, 502);
    })
  );
});

test("an unreadable DUNE_STATUS_RELAY_TOKEN_FILE is logged once, not silent", () => {
  const lines = [];
  const original = console.error;
  console.error = (line) => lines.push(String(line));
  try {
    statusRelayToken({ DUNE_STATUS_RELAY_TOKEN_FILE: "/nonexistent/second-path" });
    statusRelayToken({ DUNE_STATUS_RELAY_TOKEN_FILE: "/nonexistent/second-path" });
  } finally {
    console.error = original;
  }
  assert.equal(lines.filter((l) => l.includes("status_relay.token_file_unreadable")).length, 1);
});

// ── second review round (mentat#469) ────────────────────────────────────────

test("posting alerts as the bot REQUIRES the relay token (no spoofing as Mentat); the answer is 503 and nothing posts", async () => {
  const channel = fakeChannel({ id: "alerts-1" });
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_RELAY_CHANNEL_ID: "alerts-1", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withApp(fakeClient({ "alerts-1": channel }), async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: alertBody(1) });
      assert.equal(res.status, 503);
      assert.equal(channel._sent.length, 0);
    })
  );
});

test("a webhook that answers 4xx is reported as a failure (502) so Alertmanager retries, not as relayed", async () => {
  const server = createServer((req, res) => { req.resume(); req.on("end", () => { res.statusCode = 404; res.end("{}"); }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await withEnv({ DUNE_ALERT_RELAY_TOKEN: "", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_RELAY_CHANNEL_ID: "", DUNE_ALERT_WEBHOOK_URL: `http://127.0.0.1:${server.address().port}/hook` }, () =>
      withApp(fakeClient({}), async (base) => {
        const res = await fetch(`${base}/api/alerts/relay`, { method: "POST", headers: { "Content-Type": "application/json" }, body: alertBody(1) });
        assert.equal(res.status, 502);
      })
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("validateStatusPayload keeps the built embed under Discord's 6000 characters by capping total field text", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `Field ${i}`.padEnd(40, "n"), value: "v".repeat(300) }));
  assert.equal(validateStatusPayload({ state: "ok", headline: "Online", fields: many }).ok, false);
  const fits = Array.from({ length: 10 }, (_, i) => ({ name: `Field ${i}`.padEnd(40, "n"), value: "v".repeat(300) }));
  const ok = validateStatusPayload({ state: "ok", headline: "h".repeat(80), note: "n".repeat(300), fields: fits });
  assert.equal(ok.ok, true);
  const json = formatStatusEmbed(ok.value, { random: () => 0.99 }).toJSON();
  const chars = json.title.length + json.description.length + json.footer.text.length + json.fields.reduce((n, f) => n + f.name.length + f.value.length, 0);
  assert.ok(chars <= 6000, `worst allowed embed was ${chars} characters`);
});

test("a transient Discord error while editing is NOT turned into a duplicate post; the caller gets a 502 to retry", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  setLiveMessage(db, "guild-1", STATUS_MESSAGE_KEY, "chan-1", "msg-existing");
  channel.messages.fetch = async () => ({ id: "msg-existing", edit: async () => { const e = new Error("Service Unavailable"); e.code = 0; e.status = 503; throw e; } });
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": channel }), db, env });
  const res = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), res);
  assert.equal(res.code, 502);
  assert.equal(channel._sent.length, 0, "no second message");
  assert.equal(getLiveMessage(db, "guild-1", STATUS_MESSAGE_KEY).message_id, "msg-existing", "the pointer is unchanged");
});

test("a message that is definitely gone (Unknown Message) IS replaced with a fresh post", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  setLiveMessage(db, "guild-1", STATUS_MESSAGE_KEY, "chan-1", "msg-deleted");
  channel.messages.fetch = async () => { const e = new Error("Unknown Message"); e.code = 10008; throw e; };
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": channel }), db, env });
  const res = fakeRes();
  await handler(fakeReq({ token: "relay-secret" }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.edited, false);
  assert.equal(channel._sent.length, 1);
});

test("moving the status channel removes the stale message in the old channel (best effort)", async () => {
  const db = createDatabase(":memory:");
  const oldChannel = fakeChannel({ id: "old-chan" });
  const deleted = [];
  oldChannel.messages.fetch = async (id) => ({ id, delete: async () => { deleted.push(id); } });
  const newChannel = fakeChannel({ id: "chan-1" });
  setLiveMessage(db, "guild-1", STATUS_MESSAGE_KEY, "old-chan", "old-msg");
  const handler = createStatusRelayHandler({ client: fakeClient({ "old-chan": oldChannel, "chan-1": newChannel }), db, env });
  await handler(fakeReq({ token: "relay-secret" }), fakeRes());
  assert.deepEqual(deleted, ["old-msg"]);
  assert.equal(newChannel._sent.length, 1);
});

test("the body limit also applies when Content-Length is absent (a chunked request)", async () => {
  const db = createDatabase(":memory:");
  const handler = createStatusRelayHandler({ client: fakeClient({ "chan-1": fakeChannel() }), db, env });
  const big = { state: "ok", headline: "x", fields: [], filler: "z".repeat(40 * 1024) };
  const res = fakeRes();
  await handler(fakeReq({ token: "relay-secret", body: big }), res);
  assert.equal(res.code, 413);
});

test("an older failed update cannot undo a newer update's throttle reservation", async () => {
  const db = createDatabase(":memory:");
  const channel = fakeChannel();
  let calls = 0;
  const client = { channels: { fetch: async (id) => { calls += 1; if (calls === 1) { await new Promise((r) => setTimeout(r, 30)); throw new Error("boom"); } return channel; } } };
  const handler = createStatusRelayHandler({ client, db, env, now: () => 1_800_000_000_000 });
  const [a, b] = [fakeRes(), fakeRes()];
  const first = handler(fakeReq({ token: "relay-secret", body: { state: "ok", headline: "Online" } }), a);
  const second = handler(fakeReq({ token: "relay-secret", body: { state: "down", headline: "Offline" } }), b);
  await Promise.all([first, second]);
  assert.equal(a.code, 502);
  assert.equal(b.code, 200);
  const repeat = fakeRes();
  await handler(fakeReq({ token: "relay-secret", body: { state: "down", headline: "Offline" } }), repeat);
  assert.equal(repeat.code, 429, "the newer reservation (down) still throttles a repeat");
});
