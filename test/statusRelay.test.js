import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, getLiveMessage } from "../src/database.js";
import { createSetupServer } from "../src/setupServer.js";
import {
  STATUS_MESSAGE_KEY,
  alertEmbeds,
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
