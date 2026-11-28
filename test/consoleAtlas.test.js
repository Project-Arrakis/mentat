import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AdapterClient, AdapterHttpError } from "../src/adapterClient.js";
import { atlasRefresher } from "../src/atlasRefresh.js";
import { loadConfig } from "../src/config.js";
import { createConsoleAtlas } from "../src/consoleAtlas.js";
import { createDatabase } from "../src/database.js";
import { formatAtlasEmbed } from "../src/embedFormat.js";
import { logError } from "../src/logger.js";

// #the-atlas from a Console API key (consoleAtlas.js). The key below is a made
// up value in the Console's key format.
const KEY = "dak_0123abcd_FAKE-test-key_not-a-real-secret";
const GUILD = "100000000000000001";
const OTHER_GUILD = "200000000000000002";
const CONSOLE = "https://console.example.test/";

const BASE_ENV = {
  DISCORD_BOT_TOKEN: "test-bot-token",
  DISCORD_CLIENT_ID: "123456789012345678",
  DUNE_CONSOLE_API_URL: "https://adapter.example.test",
  DUNE_DISCORD_ADAPTER_TOKEN: "test-adapter-token",
  DISCORD_ADMIN_ROLE_IDS: "role-admin"
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function consolePages(url) {
  const map = url.searchParams.get("map");
  if (url.pathname === "/api/map/spice") {
    return jsonResponse({ currentSeed: "cor-6", nextCycleAt: "2026-12-01T05:00:00.000Z", rows: [{ id: "field-1" }] });
  }
  if (url.pathname === "/api/maps/combat-state" && map === "Survival_1") {
    return jsonResponse({
      map,
      mapState: "PVE",
      // Anything beyond the shown fields must not travel on.
      partitions: [{ partitionId: "1", serverDisplayName: "Sietch Zahir", runtimeStatus: "RUNNING", configuredState: "PVE", databaseLabel: "never-copied", warnings: ["x"] }]
    });
  }
  if (url.pathname === "/api/maps/combat-state" && map === "DeepDesert_1") {
    return jsonResponse({
      map,
      mapState: "PVP",
      partitions: [{ partitionId: "8", serverDisplayName: null, runtimeStatus: "RUNNING", configuredState: "PVP" }]
    });
  }
  return jsonResponse({ error: "not found" }, 404);
}

function recordingFetch(handler = consolePages) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return handler(new URL(url), options);
  };
  return { calls, fetchImpl };
}

function clientConfig(atlasConsole) {
  const config = loadConfig(BASE_ENV);
  return { ...config, atlasConsole };
}

const ATLAS_CONSOLE = { baseUrl: CONSOLE, apiKey: KEY, guildId: GUILD };

test("the configured guild's atlas comes from the Console API pages, with only the shown fields", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const client = new AdapterClient(clientConfig(ATLAS_CONSOLE), { fetchImpl });

  const payload = await client.atlas({ guildId: GUILD }, GUILD);

  assert.deepEqual(calls.map((c) => `${c.url.pathname}${c.url.search}`).sort(), [
    "/api/map/spice?map=HaggaBasin",
    "/api/maps/combat-state?map=DeepDesert_1",
    "/api/maps/combat-state?map=Survival_1"
  ]);
  for (const { url, options } of calls) {
    assert.equal(url.origin, "https://console.example.test");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, `Bearer ${KEY}`);
    assert.equal(options.body, undefined);
  }
  assert.deepEqual(payload, {
    ok: true,
    sandstormAvailable: false,
    coriolisSeed: "cor-6",
    coriolisNextCycleAt: "2026-12-01T05:00:00.000Z",
    sietches: {
      HaggaBasin: [{ partitionId: "1", serverDisplayName: "Sietch Zahir", runtimeStatus: "RUNNING", combatState: "PVE" }],
      DeepDesert: [{ partitionId: "8", serverDisplayName: null, runtimeStatus: "RUNNING", combatState: "PVP" }]
    }
  });
});

test("calls within a minute share one answer, and a failure is not kept", async () => {
  let clock = 0;
  let status = 503;
  const { calls, fetchImpl } = recordingFetch((url) => (status === 200 ? consolePages(url) : jsonResponse({}, status)));
  const atlas = createConsoleAtlas(ATLAS_CONSOLE, { fetchImpl, now: () => clock, onWarning: () => {} });

  await assert.rejects(atlas.fetchAtlas());
  status = 200;
  await Promise.all([atlas.fetchAtlas(), atlas.fetchAtlas()]);
  clock = 59_000;
  await atlas.fetchAtlas();
  assert.equal(calls.length, 6);

  clock = 60_000;
  await atlas.fetchAtlas();
  assert.equal(calls.length, 9);
});

test("every Console request goes through the connection guard it is given", async () => {
  const dispatcher = { name: "guard" };
  const { calls, fetchImpl } = recordingFetch();
  await new AdapterClient(clientConfig(ATLAS_CONSOLE), { fetchImpl, dispatcher }).atlas({}, GUILD);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => c.options.dispatcher === dispatcher));
});

test("a Console address with a path prefix keeps the prefix", async () => {
  const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ partitions: [] }));
  await createConsoleAtlas({ ...ATLAS_CONSOLE, baseUrl: "https://host.example.test/console" }, { fetchImpl }).fetchAtlas();
  assert.ok(calls.every((c) => c.url.pathname.startsWith("/console/api/")));
});

test("another guild keeps the adapter route on its own Console and never receives the key", async () => {
  const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ ok: true, sietches: {} }));
  const config = clientConfig(ATLAS_CONSOLE);
  const client = new AdapterClient(config, {
    fetchImpl,
    getGuildConfig: () => ({ adapter: { ...config.adapter, baseUrl: "https://other.example.test", token: "other-guild-token" } })
  });

  await client.atlas({ guildId: OTHER_GUILD }, OTHER_GUILD);
  await client.atlas({}, null);

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.href, "https://other.example.test/api/integrations/discord/world/atlas");
  for (const { options } of calls) assert.ok(!JSON.stringify(options.headers).includes(KEY));
});

test("the key is not sent to the configured guild's database address or to any other route", async () => {
  const { calls, fetchImpl } = recordingFetch((url) =>
    url.hostname === "console.example.test" ? consolePages(url) : jsonResponse({ ok: true }));
  const config = clientConfig(ATLAS_CONSOLE);
  const client = new AdapterClient(config, {
    fetchImpl,
    // The guild's registered address can be changed through the setup portal.
    getGuildConfig: () => ({ adapter: { ...config.adapter, baseUrl: "https://changed.example.test", token: "guild-token" } })
  });

  await client.atlas({}, GUILD);
  await client.status({}, false, GUILD);

  const withKey = calls.filter((c) => JSON.stringify(c.options.headers).includes(KEY));
  assert.equal(withKey.length, 3);
  assert.ok(withKey.every((c) => c.url.hostname === "console.example.test"));
});

test("without the setting, the atlas uses the adapter route as before", async () => {
  const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ ok: true, sietches: {} }));
  const client = new AdapterClient(loadConfig(BASE_ENV), { fetchImpl });
  await client.atlas({}, GUILD);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, "/api/integrations/discord/world/atlas");
  assert.equal(calls[0].options.method, "POST");
});

test("a refused key reports the page and status, and neither the key nor the response body", async () => {
  const { fetchImpl } = recordingFetch(() => jsonResponse({ error: "Invalid API key.", echo: KEY }, 401));
  const atlas = createConsoleAtlas(ATLAS_CONSOLE, { fetchImpl, onWarning: () => {} });

  await assert.rejects(atlas.fetchAtlas(), (error) => {
    assert.ok(error instanceof AdapterHttpError);
    assert.equal(error.status, 401);
    assert.equal(error.body, undefined);
    assert.match(error.message, /\/api\/maps\/combat-state returned HTTP 401/);
    assert.ok(!error.message.includes(KEY));
    return true;
  });
});

test("a redirect is refused, so the key never reaches the redirect target", async (t) => {
  const targetHeaders = [];
  const target = createServer((req, res) => { targetHeaders.push(req.headers); res.end("{}"); });
  await new Promise((resolve) => target.listen(0, "127.0.0.1", resolve));
  const source = createServer((req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${target.address().port}${req.url}` });
    res.end();
  });
  await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
  t.after(() => { source.close(); target.close(); });

  const pending = [];
  const atlas = createConsoleAtlas(
    { ...ATLAS_CONSOLE, baseUrl: `http://127.0.0.1:${source.address().port}` },
    { onWarning: () => {}, fetchImpl: (url, options) => { const request = fetch(url, options); pending.push(request); return request; } }
  );

  await assert.rejects(atlas.fetchAtlas(), /Console atlas request \/api\/maps\/combat-state failed/);
  const outcomes = await Promise.allSettled(pending);
  assert.deepEqual(outcomes.map((o) => o.status), ["rejected", "rejected", "rejected"]);
  assert.equal(targetHeaders.length, 0);
});

test("an answer without a partition list throws instead of showing an empty atlas", async () => {
  for (const answer of [{}, { partitions: [], reason: "dune.world_partition is missing" }]) {
    const { fetchImpl } = recordingFetch((url) =>
      url.pathname === "/api/map/spice" ? consolePages(url) : jsonResponse(answer));
    const atlas = createConsoleAtlas(ATLAS_CONSOLE, { fetchImpl });
    await assert.rejects(atlas.fetchAtlas(), /no partition list/);
  }
});

test("a failed Coriolis page is reported and leaves the sietch list in place", async () => {
  const warnings = [];
  const { fetchImpl } = recordingFetch((url) =>
    url.pathname === "/api/map/spice" ? jsonResponse({ error: "down" }, 503) : consolePages(url));
  const payload = await createConsoleAtlas(ATLAS_CONSOLE, { fetchImpl, onWarning: (e) => warnings.push(e) }).fetchAtlas();

  assert.equal(payload.coriolisSeed, null);
  assert.equal(payload.coriolisNextCycleAt, null);
  assert.equal(payload.sietches.HaggaBasin.length, 1);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].status, 503);
});

test("empty Coriolis values from the Console read as not yet known", async () => {
  const { fetchImpl } = recordingFetch((url) =>
    url.pathname === "/api/map/spice" ? jsonResponse({ currentSeed: "", nextCycleAt: "" }) : consolePages(url));
  const payload = await createConsoleAtlas(ATLAS_CONSOLE, { fetchImpl }).fetchAtlas();
  assert.match(formatAtlasEmbed(payload).toJSON().description, /not yet known/);
});

test("the posted atlas shows the sietches and says storm status is unavailable", async () => {
  const sent = [];
  const channel = { id: "channel-1", guildId: GUILD, isTextBased: () => true, send: async (c) => { sent.push(c); return { id: "message-1" }; }, messages: { fetch: async () => null } };
  const { fetchImpl } = recordingFetch();
  const errors = [];
  const refresher = atlasRefresher({
    adapterClient: new AdapterClient(clientConfig(ATLAS_CONSOLE), { fetchImpl }),
    client: { channels: { fetch: async () => channel } },
    db: createDatabase(":memory:"),
    channelId: "channel-1",
    onError: (e) => errors.push(e)
  });

  await refresher.refresh();

  assert.deepEqual(errors, []);
  const embed = sent[0].embeds[0].toJSON();
  assert.match(embed.description, /cor-6/);
  assert.match(embed.description, /Live sandstorm status is not available/);
  const text = JSON.stringify(embed);
  assert.match(text, /Sietch Zahir/);
  assert.ok(!text.includes("never-copied"));
  assert.ok(!text.includes("Storm active"));
});

test("an adapter atlas payload carries no unavailable-storm note", () => {
  const embed = formatAtlasEmbed({ ok: true, sietches: { HaggaBasin: [], DeepDesert: [] } }).toJSON();
  assert.doesNotMatch(embed.description, /sandstorm status/);
});

test("logs hide a Console API key even without a label", () => {
  const lines = [];
  logError("x", new Error(`unexpected ${KEY} here`), {}, (line) => lines.push(line));
  assert.ok(!lines[0].includes(KEY));
  assert.match(lines[0], /\[REDACTED\]/);
});

test("loadConfig reads the key from a file and requires all three atlas settings", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, "console-api-key");
  writeFileSync(keyFile, `${KEY}\n`, { mode: 0o600 });
  const full = { DUNE_ATLAS_API_KEY_FILE: keyFile, DUNE_ATLAS_CONSOLE_URL: "https://console.example.test", DUNE_ATLAS_GUILD_ID: GUILD };

  assert.equal(loadConfig(BASE_ENV).atlasConsole, null);
  assert.deepEqual(loadConfig({ ...BASE_ENV, ...full }).atlasConsole, ATLAS_CONSOLE);

  for (const name of Object.keys(full)) {
    assert.throws(() => loadConfig({ ...BASE_ENV, ...full, [name]: "" }), /must be set together/, name);
  }
  for (const url of ["http://console.example.test", "https://user:pw@console.example.test", "https://console.example.test/?a=1", "console.example.test"]) {
    assert.throws(() => loadConfig({ ...BASE_ENV, ...full, DUNE_ATLAS_CONSOLE_URL: url }), /plain https/, url);
  }
  assert.throws(() => loadConfig({ ...BASE_ENV, ...full, DUNE_ATLAS_GUILD_ID: "my-server" }), /Discord server ID/);
});

test("loadConfig refuses a file that is not a Console API key without repeating its content", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "atlas-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const keyFile = join(dir, "console-api-key");
  const env = { ...BASE_ENV, DUNE_ATLAS_API_KEY_FILE: keyFile, DUNE_ATLAS_CONSOLE_URL: CONSOLE, DUNE_ATLAS_GUILD_ID: GUILD };

  for (const content of ["", "some-other-secret-value", `${KEY}\nsecond-line`, `Bearer ${KEY}`]) {
    writeFileSync(keyFile, content);
    assert.throws(() => loadConfig(env), (error) => {
      assert.match(error.message, /does not contain a Console API key/);
      assert.ok(!error.message.includes("secret"));
      return true;
    });
  }
});
