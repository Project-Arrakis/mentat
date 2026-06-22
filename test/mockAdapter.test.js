import assert from "node:assert/strict";
import { test } from "node:test";
import { AdapterClient, AdapterHttpError } from "../src/adapterClient.js";
import { createMockAdapterServer } from "../scripts/mock-adapter.js";

function config(baseUrl, token = "test-token") {
  return {
    adapter: {
      baseUrl,
      token,
      timeoutMs: 1000,
      paths: {
        health: "/api/integrations/discord/health",
        status: "/api/integrations/discord/status",
        readiness: "/api/integrations/discord/readiness",
        services: "/api/integrations/discord/services"
      },
      methods: {
        health: "GET",
        status: "POST",
        readiness: "POST",
        services: "POST"
      }
    }
  };
}

async function withMockAdapter(fn) {
  const server = createMockAdapterServer({ token: "test-token" });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("mock adapter serves read-only fixture responses through AdapterClient", async () => {
  await withMockAdapter(async (baseUrl) => {
    const client = new AdapterClient(config(baseUrl));
    const actor = { userId: "user-1", guildId: "guild-1", channelId: "channel-1", roleIds: ["observer-role"] };

    const health = await client.health(actor);
    const status = await client.status(actor);
    const readiness = await client.readiness(actor);
    const services = await client.services(actor);

    assert.equal(health.readOnly, true);
    assert.equal(health.writesEnabled, false);
    assert.equal(status.operation, "status");
    assert.equal(readiness.operation, "readiness");
    assert.equal(services.operation, "services");
  });
});

test("mock adapter requires the bearer token", async () => {
  await withMockAdapter(async (baseUrl) => {
    const client = new AdapterClient(config(baseUrl, "wrong-token"));

    await assert.rejects(
      () => client.health({ userId: "user-1" }),
      (error) => {
        assert.ok(error instanceof AdapterHttpError);
        assert.equal(error.status, 401);
        assert.equal(error.body.code, "invalid_adapter_token");
        return true;
      }
    );
  });
});
