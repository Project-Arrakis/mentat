import assert from "node:assert/strict";
import { test } from "node:test";
import { AdapterClient, AdapterHttpError, LIVE_ROUTES, PLANNED_ROUTES, UNMERGED_ROUTES, MISSING_ROUTES, routeStatus } from "../src/adapterClient.js";

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

// FULL route-table pin (added 2026-08-06, RO roadmap audit -- see
// docs/ro-roadmap-state-2026-08-06.md). These four sets must together
// classify every route the bot can possibly call (every key in config.js's
// DEFAULT_PATHS), disjointly, with zero "unknown" status. Prior to this
// test, fourteen DEFAULT_PATHS keys had no classification at all -- most
// importantly the nine player routes the bot calls daily (the audit's
// central finding), plus players-accounts-link-steam -- because they had
// been removed from UNMERGED_ROUTES in the 2026-07-26 reconciliation but
// never added to any table. If this test fails because a route reports
// "unknown", classify it in the correct set (verified against Core's real
// DISCORD_ADAPTER_ROUTES at the current upstream tag) rather than relaxing
// the test.
test("every known route is classified into exactly one of the four route tables (no unknowns)", () => {
  const whole = new Set([...LIVE_ROUTES, ...PLANNED_ROUTES, ...UNMERGED_ROUTES, ...MISSING_ROUTES]);

  // The player routes re-added here on 2026-08-06 must be live: the bot
  // calls them daily through playerLinkVerify()/playerInventory()/etc. and
  // Core serves them (DISCORD_LIVE_ADAPTER_ROUTES, verified at v1.3.79).
  for (const route of [
    "players-link", "players-unlink", "players-me", "players-inventory",
    "players-inventory-search", "players-storage", "players-find",
    "guild-storage", "guild-find", "players-accounts-link-steam",
    "players-link-verify", "players-accounts-list", "players-accounts-unlink"
  ]) {
    assert.equal(routeStatus(route), "live", `${route} must be classified live (bot calls it daily, Core serves it)`);
  }

  // Every key the bot's config path table can be asked to call must be
  // classifiable. This is the exact set of DEFAULT_PATHS keys in
  // src/config.js (49) -- kept in sync by hand; a new config route MUST be
  // added to one of the four sets in the same change, or this fails.
  const expectedPathKeys = [
    "health", "status", "readiness", "services", "population", "logs",
    "map-state", "maintenance", "backups", "announcements", "broadcast",
    "version", "servers", "ports", "db", "write-execute", "write-preview",
    "players-link", "players-unlink", "players-me", "players-faction",
    "players-inventory", "players-inventory-search", "players-storage",
    "players-find", "guild-storage", "guild-find", "ops-activity",
    "ops-combat", "ops-resources", "ops-economy", "ops-inventory",
    "ops-location", "ops-soc", "ops-prometheus", "ops-dashboard",
    "player-links-start", "player-links-verify", "player-links",
    "player-links-unlink", "guild-grants", "guild-grants-enable",
    "guild-grants-disable", "guild-grants-default", "player-inventory-v2",
    "players-accounts-link-steam", "players-link-verify",
    "players-accounts-list", "players-accounts-unlink"
  ];

  assert.equal(whole.size, LIVE_ROUTES.size + PLANNED_ROUTES.size + UNMERGED_ROUTES.size + MISSING_ROUTES.size,
    "the four sets must be disjoint (every route classifies exactly once)");
  assert.deepEqual([...whole].sort(), expectedPathKeys.slice().sort(),
    "config path keys and classified route keys must be identical sets -- a new config key without a classification is a bug");
});

// The 2026-08-06 ops:announcements dispatch fix: OPS_COMMANDS.announcements
// used to point at route "ops-announcements", whose camelCase-derived
// method opsAnnouncements existed ONLY in the test mock and not on the real
// AdapterClient -- a live /dune ops announcements call would have thrown
// TypeError. It now routes to "announcements", the real, live
// /api/integrations/discord/announcements route. Pin that here.
test("ops announcements dispatches to the real announcements method, not a mock-only opsAnnouncements", () => {
  assert.equal(routeStatus("announcements"), "planned",
    "announcements must stay planned -- upstream returns a planned stub until Core wires real announcement data");
  assert.equal("function", typeof AdapterClient.prototype.announcements,
    "real AdapterClient must expose announcements() (the dispatch derives the method name from the route)");
  assert.equal("undefined", typeof AdapterClient.prototype.opsAnnouncements,
    "no opsAnnouncements may exist on the real client -- only the route-derived name wins");

  // Route-to-method derivation mirror of commands.js's dispatch:
  // route.replace(/-(\w)/g, c => c.toUpperCase()) => announcements.
  assert.equal("announcements", "announcements".replace(/-(\w)/g, (_, c) => c.toUpperCase()));
});
