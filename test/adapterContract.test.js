import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AdapterClient } from "../src/adapterClient.js";
import { loadConfig } from "../src/config.js";

const UPSTREAM_CONTRACT = Object.freeze({
  health: {
    method: "GET",
    path: "/api/integrations/discord/health",
    fixture: "health.json"
  },
  status: {
    method: "POST",
    path: "/api/integrations/discord/status",
    fixture: "status.json"
  },
  readiness: {
    method: "POST",
    path: "/api/integrations/discord/readiness",
    fixture: "readiness.json"
  },
  services: {
    method: "POST",
    path: "/api/integrations/discord/services",
    fixture: "services.json"
  },
  population: {
    method: "POST",
    path: "/api/integrations/discord/population",
    fixture: "population.json"
  },
  logs: {
    method: "POST",
    path: "/api/integrations/discord/logs",
    fixture: "ops.json"
  },
  "map-state": {
    method: "POST",
    path: "/api/integrations/discord/map-state",
    fixture: "ops.json"
  },
  maintenance: {
    method: "POST",
    path: "/api/integrations/discord/maintenance",
    fixture: "ops.json"
  },
  backups: {
    method: "GET",
    path: "/api/integrations/discord/backups/list",
    fixture: "backups.json"
  },
  announcements: {
    method: "POST",
    path: "/api/integrations/discord/announcements",
    fixture: "announcements.json"
  },
  broadcast: {
    method: "POST",
    path: "/api/integrations/discord/broadcast",
    fixture: "broadcast.json"
  },
  version: { method: "GET", path: "/api/integrations/discord/version", fixture: "health.json" },
  servers: { method: "POST", path: "/api/integrations/discord/servers", fixture: "ops.json" },
  ports: { method: "POST", path: "/api/integrations/discord/ports", fixture: "ops.json" },
  db: { method: "POST", path: "/api/integrations/discord/db", fixture: "ops.json" },
  "write-execute": { method: "POST", path: "/api/integrations/discord/write/execute", fixture: "broadcast.json" },
  "write-preview": { method: "POST", path: "/api/integrations/discord/write/preview", fixture: "broadcast.json" },
  "ops-activity": { method: "POST", path: "/api/integrations/discord/ops/activity", fixture: "ops.json" },
  "ops-combat": { method: "POST", path: "/api/integrations/discord/ops/combat", fixture: "ops.json" },
  "ops-resources": { method: "POST", path: "/api/integrations/discord/ops/resources", fixture: "ops.json" },
  "ops-economy": { method: "POST", path: "/api/integrations/discord/ops/economy", fixture: "ops.json" },
  "ops-inventory": { method: "POST", path: "/api/integrations/discord/ops/inventory", fixture: "ops.json" },
  "ops-location": { method: "POST", path: "/api/integrations/discord/ops/location", fixture: "ops.json" },
  "ops-soc": { method: "POST", path: "/api/integrations/discord/ops/soc", fixture: "ops.json" },
  "ops-prometheus": { method: "POST", path: "/api/integrations/discord/ops/prometheus", fixture: "ops.json" },
  "ops-dashboard": { method: "POST", path: "/api/integrations/discord/ops/dashboard", fixture: "ops.json" },
  "players-link": { method: "POST", path: "/api/integrations/discord/players/link", fixture: "ops.json" },
  "players-link-verify": { method: "POST", path: "/api/integrations/discord/players/link/verify", fixture: "ops.json" },
  "players-accounts-link-steam": { method: "POST", path: "/api/integrations/discord/players/accounts/link-steam", fixture: "ops.json" },
  // FIX (2026-07-27, found via a real live production error:
  // "Unsupported adapter route: players-accounts-unlink"). This contract
  // table's whole purpose is catching exactly this class of bug --
  // a route added to adapterClient.js/DEFAULT_PATHS but never added to
  // config.js's actual runtime paths/methods object -- and it would have
  // caught this one immediately had these two entries been added here
  // (and this test file actually run) when playerAccountsList()/
  // playerAccountsUnlink() were first added, instead of only being
  // caught by a real user hitting it in production.
  "players-accounts-list": { method: "POST", path: "/api/integrations/discord/players/accounts/list", fixture: "ops.json" },
  "players-accounts-unlink": { method: "POST", path: "/api/integrations/discord/players/accounts/unlink", fixture: "ops.json" },
  "players-unlink": { method: "POST", path: "/api/integrations/discord/players/unlink", fixture: "ops.json" },
  "players-me": { method: "POST", path: "/api/integrations/discord/players/me", fixture: "ops.json" },
  "players-faction": { method: "POST", path: "/api/integrations/discord/players/faction", fixture: "ops.json" },
  "players-inventory": { method: "POST", path: "/api/integrations/discord/players/inventory", fixture: "ops.json" },
  "players-inventory-search": { method: "POST", path: "/api/integrations/discord/players/inventory-search", fixture: "ops.json" },
  "players-storage": { method: "POST", path: "/api/integrations/discord/players/storage", fixture: "ops.json" },
  "players-find": { method: "POST", path: "/api/integrations/discord/players/find", fixture: "ops.json" },
  "guild-storage": { method: "POST", path: "/api/integrations/discord/guilds/storage", fixture: "ops.json" },
  "guild-find": { method: "POST", path: "/api/integrations/discord/guilds/find", fixture: "ops.json" },
  "player-links-start": { method: "POST", path: "/api/integrations/discord/player-links/start", fixture: "ops.json" },
  "player-links-verify": { method: "POST", path: "/api/integrations/discord/player-links/verify", fixture: "ops.json" },
  "player-links": { method: "GET", path: "/api/integrations/discord/player-links", fixture: "ops.json" },
  "player-links-unlink": { method: "POST", path: "/api/integrations/discord/player-links/unlink", fixture: "ops.json" },
  "guild-grants": { method: "GET", path: "/api/integrations/discord/guild-character-grants", fixture: "ops.json" },
  "guild-grants-enable": { method: "POST", path: "/api/integrations/discord/guild-character-grants/enable", fixture: "ops.json" },
  "guild-grants-disable": { method: "POST", path: "/api/integrations/discord/guild-character-grants/disable", fixture: "ops.json" },
  "guild-grants-default": { method: "POST", path: "/api/integrations/discord/guild-character-grants/default", fixture: "ops.json" },
  "player-inventory-v2": { method: "POST", path: "/api/integrations/discord/player/inventory", fixture: "ops.json" }
});

function routeToMethodName(route) {
  return route.replace(/-(\w)/g, (_, c) => c.toUpperCase());
}

function baseEnv(overrides = {}) {
  return {
    DISCORD_BOT_TOKEN: "discord-token",
    DISCORD_CLIENT_ID: "client-id",
    DISCORD_OBSERVER_ROLE_IDS: "observer-role",
    DUNE_CONSOLE_API_URL: "http://console-api:3000",
    DUNE_DISCORD_ADAPTER_TOKEN: "adapter-token",
    ...overrides
  };
}

async function fixture(name) {
  const body = await readFile(new URL(`./fixtures/adapter/${name}`, import.meta.url), "utf8");
  return JSON.parse(body);
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

test("default adapter routes match the upstream Discord adapter contract", () => {
  const config = loadConfig(baseEnv());

  assert.deepEqual(config.adapter.paths, Object.fromEntries(
    Object.entries(UPSTREAM_CONTRACT).map(([route, contract]) => [route, contract.path])
  ));
  assert.deepEqual(config.adapter.methods, Object.fromEntries(
    Object.entries(UPSTREAM_CONTRACT).map(([route, contract]) => [route, contract.method])
  ));
});

test("AdapterClient requests upstream routes with the expected methods and actor body", async () => {
  const config = loadConfig(baseEnv());
  const actor = { userId: "user-1", guildId: "guild-1", channelId: "channel-1", roleIds: ["observer-role"] };
  const calls = [];
  const routeNames = Object.keys(UPSTREAM_CONTRACT);
  const client = new AdapterClient(config, {
    fetchImpl: async (url, options) => {
      // Identify route by URL path
      const urlPath = new URL(url).pathname;
      const route = Object.entries(UPSTREAM_CONTRACT).find(([, c]) => c.path === urlPath)?.[0] || urlPath;
      calls.push({
        route,
        url: String(url),
        method: options.method,
        authorization: options.headers.authorization,
        contentType: options.headers["content-type"],
        body: options.body ? JSON.parse(options.body) : undefined
      });
      return jsonResponse(await fixture(UPSTREAM_CONTRACT[route]?.fixture || "health.json"));
    }
  });

  const responses = {};
  for (const route of routeNames) {
    const methodName = routeToMethodName(route);
    if (typeof client[methodName] === "function") {
      responses[route] = await client[methodName](actor);
    }
  }
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].contentType, undefined);
  for (const call of calls.slice(1)) {
    assert.equal(call.authorization, "Bearer adapter-token");
    if (call.method === "POST") {
      assert.equal(call.contentType, "application/json");
      assert.deepEqual(call.body, { actor });
    }
  }
});

test("AdapterClient honors configured compatibility route overrides", async () => {
  const config = loadConfig(baseEnv({
    DUNE_ADAPTER_STATUS_PATH: "/api/discord/status",
    DUNE_ADAPTER_STATUS_METHOD: "GET"
  }));
  const calls = [];
  const client = new AdapterClient(config, {
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options.method, body: options.body });
      return jsonResponse(await fixture("status.json"));
    }
  });

  await client.status({ userId: "user-1", roleIds: ["observer-role"] });

  assert.deepEqual(calls, [{
    url: "http://console-api:3000/api/discord/status",
    method: "GET",
    body: undefined
  }]);
});

test("adapter method overrides stay limited to read-only-compatible verbs", () => {
  assert.throws(
    () => loadConfig(baseEnv({ DUNE_ADAPTER_STATUS_METHOD: "DELETE" })),
    /DUNE_ADAPTER_STATUS_METHOD must be GET or POST/
  );
});
