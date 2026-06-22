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
  }
});

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
      const route = routeNames[calls.length];
      calls.push({
        route,
        url: String(url),
        method: options.method,
        authorization: options.headers.authorization,
        contentType: options.headers["content-type"],
        body: options.body ? JSON.parse(options.body) : undefined
      });
      return jsonResponse(await fixture(UPSTREAM_CONTRACT[route].fixture));
    }
  });

  const responses = {};
  for (const route of routeNames) {
    responses[route] = await client[route](actor);
  }

  assert.deepEqual(responses.health, await fixture("health.json"));
  assert.deepEqual(responses.status, await fixture("status.json"));
  assert.deepEqual(responses.readiness, await fixture("readiness.json"));
  assert.deepEqual(responses.services, await fixture("services.json"));
  assert.deepEqual(calls.map(({ route, url, method }) => ({ route, url, method })), routeNames.map((route) => ({
    route,
    url: `http://console-api:3000${UPSTREAM_CONTRACT[route].path}`,
    method: UPSTREAM_CONTRACT[route].method
  })));
  assert.equal(calls[0].body, undefined);
  assert.equal(calls[0].contentType, undefined);
  for (const call of calls.slice(1)) {
    assert.equal(call.authorization, "Bearer adapter-token");
    assert.equal(call.contentType, "application/json");
    assert.deepEqual(call.body, { actor });
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
