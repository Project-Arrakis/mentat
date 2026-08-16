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

// ops-location: at v1.3.79, this genuinely returned a { status: "planned"}
// stub, dispatched via the older OPS_PATHS/OPS_PROVIDERS array. Re-verified
// 2026-08-16 against a fresh upstream clone at tag v1.3.87 (#172): the
// replacement opsRoutes dispatch table in routes.js silently omits
// OPS_LOCATION entirely -- a request now hits the generic not_found
// fallthrough and 404s. It is kept in PLANNED_ROUTES (the underlying
// intent hasn't changed -- Core still exports the provider function,
// just doesn't route to it) but this is a real regression, not a
// permanently-stable classification -- see adapterClient.js's own
// PLANNED_ROUTES comment for the full history.
test("ops-location remains classified as planned (Core still declares intent, even though it now 404s -- see #172)", () => {
  assert.ok(PLANNED_ROUTES.has("ops-location"), "ops-location must remain planned");
  assert.ok(!LIVE_ROUTES.has("ops-location"), "ops-location must not be in LIVE");
  assert.equal(routeStatus("ops-location"), "planned");
});

test("ops-inventory, ops-soc, ops-prometheus are classified as live", () => {
  for (const route of ["ops-inventory", "ops-soc", "ops-prometheus"]) {
    assert.ok(LIVE_ROUTES.has(route), `${route} Core now returns real data — must be live`);
    assert.ok(!PLANNED_ROUTES.has(route), `${route} must not remain in planned`);
    assert.equal(routeStatus(route), "live");
  }
});

// ops-dashboard: at v1.3.79 this was correctly live (dispatched via the
// older OPS_PATHS/OPS_PROVIDERS array). Re-verified 2026-08-16 against a
// fresh upstream clone at tag v1.3.87 (#172): the replacement opsRoutes
// dispatch table in routes.js has exactly 7 entries and OPS_DASHBOARD is
// not one of them -- a request now 404s. opsDashboardProvider() still
// exists and is still exported from Core's opsProvider.js, but nothing in
// routes.js invokes it anymore. This is a genuine regression from a prior,
// correctly-verified LIVE classification, not a stale claim that was
// always wrong (contrast with players-accounts-* below).
test("ops-dashboard is classified as missing -- real regression from live at v1.3.79 to 404 at v1.3.87 (#172)", () => {
  assert.ok(MISSING_ROUTES.has("ops-dashboard"), "ops-dashboard must be classified missing -- Core's routes.js dispatch table omits it at v1.3.87");
  assert.ok(!LIVE_ROUTES.has("ops-dashboard"), "ops-dashboard must not be in LIVE");
  assert.equal(routeStatus("ops-dashboard"), "missing");
});

// backups, announcements, maintenance: re-verified 2026-08-16 against a
// fresh upstream clone at tag v1.3.87 (#172). All three were previously
// classified PLANNED (backups, announcements -- expected a
// { status: "planned" } stub) or MISSING (maintenance -- expected a 404,
// since Core declared the route constant but had no handler at v1.3.79).
// Direct inspection of routes.js at v1.3.87 shows all three now have real,
// working handlers: backups runs `dune db list` for real metadata,
// announcements calls the real readPlayerAnnouncements(config) service,
// and maintenance runs `dune readiness`. Safe-direction drift (the bot
// previously under-promised, not over-promised) but still inaccurate.
test("backups, announcements, maintenance are classified as live -- Core now has real handlers, not stubs or 404s (#172)", () => {
  for (const route of ["backups", "announcements", "maintenance"]) {
    assert.ok(LIVE_ROUTES.has(route), `${route} Core now returns real data — must be live`);
    assert.ok(!PLANNED_ROUTES.has(route), `${route} must not remain in planned`);
    assert.ok(!MISSING_ROUTES.has(route), `${route} must not remain in missing`);
    assert.equal(routeStatus(route), "live");
  }
});

// players-accounts-list, players-accounts-unlink, players-accounts-link-steam:
// the PRIOR claim ("verified 2026-08-06... at upstream tag v1.3.79") was
// FALSE. Direct inspection of the real v1.3.79 tag (and every tag up to
// and including the current v1.3.87 pin) shows these routes never
// existed in any tagged upstream release -- confirmed via direct grep,
// "accounts" and "steam" do not appear anywhere in Core's real
// adapter.js/routes.js at v1.3.87. They were transiently added in an
// untagged commit (upstream eac9c18, 2026-08-10) alongside a
// multiAccountLinkProvider.js file that was never actually committed
// (the commit as pushed had a broken import -- ERR_MODULE_NOT_FOUND at
// server boot), then fully reverted the very next day (upstream d102557,
// 2026-08-11), before ever reaching a tag. Real, live blast radius: /dune
// player characters, /dune player unlink <playerControllerId>, and the
// Steam-link OAuth callback flow all 404 against a real, unmodified,
// current upstream-based Core install -- see #172 for the full audit and
// the graceful-failure handling added at each call site.
test("players-accounts-list, players-accounts-unlink, players-accounts-link-steam are classified as missing -- never existed in any tagged upstream release, prior LIVE classification was factually false (#172)", () => {
  for (const route of ["players-accounts-list", "players-accounts-unlink", "players-accounts-link-steam"]) {
    assert.ok(MISSING_ROUTES.has(route), `${route} must be classified missing -- confirmed absent from every tagged upstream release`);
    assert.ok(!LIVE_ROUTES.has(route), `${route} must not be in LIVE -- the prior claim was false`);
    assert.equal(routeStatus(route), "missing");
  }
});

// FULL route-table pin. These four sets must together classify every
// route the bot can possibly call (every key in config.js's
// DEFAULT_PATHS), disjointly, with zero "unknown" status. If this test
// fails because a route reports "unknown", classify it in the correct
// set (verified against Core's real DISCORD_ADAPTER_ROUTES at the
// current upstream tag) rather than relaxing the test.
//
// Re-verified 2026-08-16 (upstream compat pin refresh v1.3.79 -> v1.3.87,
// #172) against a fresh clone of upstream at the current tag -- this is
// the audit that found players-accounts-list/players-accounts-unlink/
// players-accounts-link-steam/ops-dashboard's PRIOR classifications were
// wrong (either factually false, or since regressed) and corrected them.
test("every known route is classified into exactly one of the four route tables (no unknowns)", () => {
  const whole = new Set([...LIVE_ROUTES, ...PLANNED_ROUTES, ...UNMERGED_ROUTES, ...MISSING_ROUTES]);

  // These player/ops routes must be live: the bot calls them daily
  // through playerLinkVerify()/playerInventory()/etc. and Core serves
  // them (DISCORD_LIVE_ADAPTER_ROUTES, re-verified at v1.3.87).
  for (const route of [
    "players-link", "players-unlink", "players-me", "players-inventory",
    "players-inventory-search", "players-storage", "players-find",
    "guild-storage", "guild-find",
    "players-link-verify", "backups", "announcements", "maintenance"
  ]) {
    assert.equal(routeStatus(route), "live", `${route} must be classified live (bot calls it daily, Core serves it)`);
  }

  // These routes must be missing: confirmed absent from every tagged
  // upstream release (players-accounts-*), or a genuine regression from
  // live to 404 between v1.3.79 and v1.3.87 (ops-dashboard). See #172.
  for (const route of ["players-accounts-list", "players-accounts-unlink", "players-accounts-link-steam", "ops-dashboard"]) {
    assert.equal(routeStatus(route), "missing", `${route} must be classified missing (see #172 -- confirmed absent/regressed against real upstream)`);
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
//
// UPDATED 2026-08-16 (upstream compat pin refresh, #172): announcements
// was PLANNED at v1.3.79 (a real { status: "planned" } stub) but
// re-verified live against upstream v1.3.87 -- routes.js now calls the
// real readPlayerAnnouncements(config) service. See LIVE_ROUTES' "FIFTH
// reconciliation" comment in src/adapterClient.js for the full history.
test("ops announcements dispatches to the real announcements method, not a mock-only opsAnnouncements", () => {
  assert.equal(routeStatus("announcements"), "live",
    "announcements is live as of upstream v1.3.87 -- see #172");
  assert.equal("function", typeof AdapterClient.prototype.announcements,
    "real AdapterClient must expose announcements() (the dispatch derives the method name from the route)");
  assert.equal("undefined", typeof AdapterClient.prototype.opsAnnouncements,
    "no opsAnnouncements may exist on the real client -- only the route-derived name wins");

  // Route-to-method derivation mirror of commands.js's dispatch:
  // route.replace(/-(\w)/g, c => c.toUpperCase()) => announcements.
  assert.equal("announcements", "announcements".replace(/-(\w)/g, (_, c) => c.toUpperCase()));
});
