import assert from "node:assert/strict";
import { test } from "node:test";
import { createMockAdapterServer } from "../scripts/mock-adapter.js";
import {
  buildOperatorSmokeConfig,
  runOperatorSmoke
} from "../scripts/operator-smoke.js";

test("operator smoke check exercises all read-only adapter routes", async () => {
  const { server, baseUrl } = await startServer(createMockAdapterServer({ token: "local-adapter-token" }));
  try {
    const config = buildOperatorSmokeConfig({
      DUNE_CONSOLE_API_URL: baseUrl,
      DUNE_DISCORD_ADAPTER_TOKEN: "local-adapter-token"
    });

    const result = await runOperatorSmoke({ config });

    assert.equal(result.ok, true);
    assert.deepEqual(result.results.map(({ route, method, path }) => ({ route, method, path })), [
      { route: "health", method: "GET", path: "/api/integrations/discord/health" },
      { route: "status", method: "POST", path: "/api/integrations/discord/status" },
      { route: "readiness", method: "POST", path: "/api/integrations/discord/readiness" },
      { route: "services", method: "POST", path: "/api/integrations/discord/services" },
      { route: "population", method: "POST", path: "/api/integrations/discord/population" },
      { route: "backups", method: "GET", path: "/api/integrations/discord/backups/list" },
      { route: "announcements", method: "POST", path: "/api/integrations/discord/announcements" },
      { route: "ops-activity", method: "POST", path: "/api/integrations/discord/ops/activity" },
      { route: "ops-combat", method: "POST", path: "/api/integrations/discord/ops/combat" },
      { route: "ops-resources", method: "POST", path: "/api/integrations/discord/ops/resources" },
      { route: "ops-economy", method: "POST", path: "/api/integrations/discord/ops/economy" },
      { route: "ops-inventory", method: "POST", path: "/api/integrations/discord/ops/inventory" },
      { route: "ops-soc", method: "POST", path: "/api/integrations/discord/ops/soc" },
      { route: "ops-prometheus", method: "POST", path: "/api/integrations/discord/ops/prometheus" }
    ]);
  } finally {
    await closeServer(server);
  }
});

test("operator smoke check fails when adapter output would need redaction", async () => {
  const config = buildOperatorSmokeConfig({
    DUNE_CONSOLE_API_URL: "http://adapter.local",
    DUNE_DISCORD_ADAPTER_TOKEN: "adapter-token"
  });

  await assert.rejects(
    () => runOperatorSmoke({
      config,
      fetchImpl: async (url) => {
        const route = new URL(url).pathname;
        const body = route.endsWith("/status")
          ? { ok: true, token: "secret-token" }
          : { ok: true };
        return jsonResponse(body);
      }
    }),
    /status response contains sensitive content/
  );
});

test("operator smoke config supplies local Discord-only defaults", () => {
  const config = buildOperatorSmokeConfig({
    DUNE_CONSOLE_API_URL: "http://127.0.0.1:8095",
    DUNE_DISCORD_ADAPTER_TOKEN: "local-adapter-token"
  });

  assert.equal(config.discord.clientId, "operator-smoke-client");
  assert.deepEqual(config.discord.rbac.observerRoleIds, ["operator-smoke-role"]);
  assert.equal(config.adapter.baseUrl, "http://127.0.0.1:8095");
});

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

async function startServer(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://${address.address}:${address.port}`
  };
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
