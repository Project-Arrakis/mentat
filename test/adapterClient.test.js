import assert from "node:assert/strict";
import { test } from "node:test";
import { AdapterClient, AdapterHttpError, LIVE_ROUTES, PLANNED_ROUTES, routeStatus } from "../src/adapterClient.js";

function config(overrides = {}) {
  return {
    adapter: {
      baseUrl: "http://console-api:3000",
      token: "adapter-token",
      timeoutMs: 1000,
      paths: {
        health: "/health",
        status: "/status",
        readiness: "/readiness",
        services: "/services"
      },
      methods: {
        health: "GET",
        status: "POST",
        readiness: "POST",
        services: "POST"
      },
      ...overrides
    }
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json" }
  });
}

test("AdapterClient sends bearer token and parses JSON", async () => {
  const seen = [];
  const client = new AdapterClient(config(), {
    fetchImpl: async (url, options) => {
      seen.push({ url: String(url), options });
      return jsonResponse({ ok: true });
    }
  });

  const result = await client.health({ userId: "user-1" });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen[0].url, "http://console-api:3000/health");
  assert.equal(seen[0].options.method, "GET");
  assert.equal(seen[0].options.headers.authorization, "Bearer adapter-token");
  assert.equal(seen[0].options.body, undefined);
});

test("AdapterClient posts actor context to POST routes", async () => {
  let postedBody;
  const client = new AdapterClient(config(), {
    fetchImpl: async (_url, options) => {
      postedBody = JSON.parse(options.body);
      return jsonResponse({ ok: true, services: [] });
    }
  });

  await client.services({ userId: "user-1", roleIds: ["role-1"] });
  assert.deepEqual(postedBody, {
    actor: {
      userId: "user-1",
      roleIds: ["role-1"]
    }
  });
});

test("AdapterClient does not attach actor-signature headers when DUNE_DISCORD_ACTOR_SECRET is unset (default, backward-compatible state)", async () => {
  const originalSecret = process.env.DUNE_DISCORD_ACTOR_SECRET;
  delete process.env.DUNE_DISCORD_ACTOR_SECRET;
  try {
    let seenHeaders;
    const client = new AdapterClient(config(), {
      fetchImpl: async (_url, options) => {
        seenHeaders = options.headers;
        return jsonResponse({ ok: true, services: [] });
      }
    });
    await client.services({ userId: "user-1", roleIds: ["role-1"] });
    assert.equal(seenHeaders["x-dune-actor-signature"], undefined);
    assert.equal(seenHeaders["x-dune-actor-timestamp"], undefined);
  } finally {
    if (originalSecret !== undefined) process.env.DUNE_DISCORD_ACTOR_SECRET = originalSecret;
  }
});

test("AdapterClient attaches a real, verifiable actor-signature when DUNE_DISCORD_ACTOR_SECRET is configured", async () => {
  const originalSecret = process.env.DUNE_DISCORD_ACTOR_SECRET;
  process.env.DUNE_DISCORD_ACTOR_SECRET = "test-secret";
  try {
    let seenHeaders;
    const client = new AdapterClient(config(), {
      fetchImpl: async (_url, options) => {
        seenHeaders = options.headers;
        return jsonResponse({ ok: true, services: [] });
      }
    });
    await client.services({ userId: "user-1", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-1"] });
    assert.match(seenHeaders["x-dune-actor-signature"], /^[0-9a-f]{64}$/);
    assert.ok(Number(seenHeaders["x-dune-actor-timestamp"]) > 0);
  } finally {
    if (originalSecret === undefined) delete process.env.DUNE_DISCORD_ACTOR_SECRET;
    else process.env.DUNE_DISCORD_ACTOR_SECRET = originalSecret;
  }
});

test("AdapterClient raises typed HTTP errors", async () => {
  const client = new AdapterClient(config(), {
    fetchImpl: async () => jsonResponse({ ok: false, error: "nope" }, { status: 503 })
  });

  await assert.rejects(
    () => client.status({ userId: "user-1" }),
    (error) => {
      assert.ok(error instanceof AdapterHttpError);
      assert.equal(error.status, 503);
      assert.equal(error.route, "status");
      assert.deepEqual(error.body, { ok: false, error: "nope" });
      return true;
    }
  );
});

// Route classification — dune-awakening-selfhost-docker's
// docs/remediation-prompt-cross-repo.md Phase 1 (PR #109, merged) wired
// ops-activity/ops-combat/ops-resources/ops-economy to real data. This
// client's LIVE_ROUTES/PLANNED_ROUTES sets must reflect that, or this
// bot would keep treating four now-real routes as stubs.
test("ops-activity, ops-combat, ops-resources, ops-economy are classified as live, not planned", () => {
  for (const route of ["ops-activity", "ops-combat", "ops-resources", "ops-economy"]) {
    assert.ok(LIVE_ROUTES.has(route), `${route} must be in LIVE_ROUTES now that Core wires it to real data`);
    assert.ok(!PLANNED_ROUTES.has(route), `${route} must no longer be in PLANNED_ROUTES`);
    assert.equal(routeStatus(route), "live");
  }
});

// The other five ops-* routes have no backing query anywhere in Core
// (see dune-awakening-selfhost-docker's opsProvider.js) and must remain
// correctly classified as planned stubs -- this reclassification is
// deliberately narrow, not a blanket "all ops routes are live now" change.
test("ops-inventory, ops-location, ops-soc, ops-prometheus, ops-dashboard remain classified as planned", () => {
  for (const route of ["ops-inventory", "ops-location", "ops-soc", "ops-prometheus", "ops-dashboard"]) {
    assert.ok(PLANNED_ROUTES.has(route), `${route} has no backing query in Core and must remain planned`);
    assert.ok(!LIVE_ROUTES.has(route), `${route} must not be misclassified as live`);
    assert.equal(routeStatus(route), "planned");
  }
});
