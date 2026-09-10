import assert from "node:assert/strict";
import { test } from "node:test";
import { createSetupServer } from "../src/setupServer.js";
import { _resetEphemeralStateForTests } from "../src/database.js";

// database.js's oauth-session/stats-snapshot/guild-stats-snapshot state is
// module-level, in-memory, and process-wide as of schema v7 (see the
// "Schema hardening (v7)" comment in database.js) -- every test in this
// file shares it, so it must be reset before each test or an earlier
// test's leftover state can silently leak into a later one even though
// each test opens its own fresh, differently-named SQLite file.
test.beforeEach(() => {
  _resetEphemeralStateForTests();
});

// ─── Issue #91: the bare domain root previously fell through to
// Express's default "Cannot GET /" error page. A real landing page now
// exists at "/" -- these tests pin that behavior so a future refactor
// can't silently re-expose the error page. ─────────────────────────────

function makeSetupApp() {
  return createSetupServer({
    dbPath: ":memory:",
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100"
  });
}

// mentat#327/#328: /setup/register now independently re-verifies Discord
// guild ownership and validates consoleUrl's resolved destination, both of
// which need injectable mocks in tests -- neither should make a real
// network/DNS call. fetchImplOwning(guildId) mocks Discord confirming
// ownership of exactly that guildId; publicLookupImpl mocks DNS resolution
// to a public address for any hostname (the test suite's "https://console.test"
// URLs have no real DNS record).
function fetchImplOwning(guildId) {
  return async (url) => {
    if (String(url).includes("/users/@me/guilds")) {
      return { ok: true, json: async () => ([{ id: guildId, name: "Test Guild", owner: true }]) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

async function publicLookupImpl() {
  return [{ address: "203.0.113.10", family: 4 }];
}

function registerServerConfig(overrides = {}) {
  return {
    dbPath: ":memory:",
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100",
    fetchImpl: fetchImplOwning(overrides.guildId),
    lookupImpl: publicLookupImpl,
    ...overrides
  };
}

async function withApp(fn) {
  const app = makeSetupApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET / returns a friendly landing page, not Express's default 404", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Dune: Awakening Docker") && html.includes("Mentat"), "should title the landing page");
    assert.ok(!html.includes("Cannot GET /"), "must not be the Express default error page");
  });
});

test("GET / links to the setup flow", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.ok(html.includes('href="/setup"'), "should link to /setup");
  });
});

test("GET /health is unaffected by the new root route", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
  });
});

// ─── /api/live-stats (KV replacement, issue #83.2) ───────────────────────
// The former Cloudflare KV acp-stats-aggregate payload is now stored in
// the local stats_snapshot table (statsPusher.js) and served here. The
// endpoint must read from the same DB file the pusher writes to -- use a
// real file-backed DB (not :memory:) so the test can verify the write
// via one connection is visible through the server's own connection.

test("GET /api/live-stats returns 503 before any snapshot exists", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "acp-stats-"));
  const dbPath = join(dir, "acp.db");
  const app = createSetupServer({
    dbPath,
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100"
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/api/live-stats`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, "No stats collected yet");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("GET /api/live-stats serves the stored snapshot from the same DB file", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { saveStatsSnapshot } = await import("../src/database.js");
  const dir = mkdtempSync(join(tmpdir(), "acp-stats2-"));
  const dbPath = join(dir, "acp.db");

  const app = createSetupServer({
    dbPath,
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100"
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // saveStatsSnapshot is in-memory, process-wide state as of schema v7
    // -- no separate DB handle needed to "simulate" statsPusher writing
    // it, the same process-wide cache the server reads from is shared
    // directly.
    saveStatsSnapshot({ players_online: 12, installations: 3, version: "1.0.0-rc.2" });

    const res = await fetch(`${base}/api/live-stats`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "public, max-age=120");
    const body = await res.json();
    assert.equal(body.players_online, 12);
    assert.equal(body.installations, 3);
    assert.equal(body.version, "1.0.0-rc.2");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── Unified role enrollment, owner via guild ownership (issue #238) ──────
// Owner has no role concept at all -- it is always the real Discord guild
// owner (rbac.js's isGuildOwner), matching Core's tier1-upstream design.
// The wizard exposes admin/moderator/observer role fields only, and every
// role row must land in guild_roles with the correct role_type (persistence
// must be exact or the tier resolver can fail closed on a working
// deployment).

test("setup wizard source exposes Moderator and Player role fields but no Owner Role field", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/setupServer.js", import.meta.url), "utf8");
  assert.ok(!src.includes('name="ownerRoleId"'), "owner has no role concept -- should NOT render an owner role field");
  assert.ok(src.includes('name="adminRoleId"'), "should render the admin role field");
  assert.ok(src.includes('name="moderatorRoleId"'), "should render the moderator role field");
  assert.ok(src.includes('name="observerRoleId"'), "should render the player/observer role field");
});

test("POST /setup/register persists admin/moderator/observer role rows, never an owner row", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDatabase, getGuildRoles } = await import("../src/database.js");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-rbac-"));
  const dbPath = join(dir, "setup.db");
  const app = createSetupServer(registerServerConfig({ dbPath, guildId: "g-role-tiers" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const payload = {
      discordUserId: "u1",
      guildId: "g-role-tiers",
      consoleUrl: "https://console.test",
      adapterToken: "mock-token",
      accessToken: "mock-access-token",
      adminRoleId: "admin-role",
      moderatorRoleId: "mod-role",
      observerRoleId: "player-role"
    };
    // Issue #201: the endpoint intentionally 302s the browser form to the
    // success page (which looks the guild up from the DB by id) instead
    // of returning JSON — assert the redirect contract, then verify
    // persistence directly against the database below.
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      redirect: "manual"
    });
    assert.equal(res.status, 302);
    // mentat#330: the redirect now also carries a single-use handoff token.
    assert.ok(res.headers.get("location").startsWith("/setup/success?guildId=g-role-tiers&token="));

    const db = createDatabase(dbPath);
    const roles = getGuildRoles(db, "g-role-tiers");
    db.close();
    const byType = Object.fromEntries(roles.map((r) => [r.role_type, r.role_id]));
    assert.deepEqual(byType, {
      admin: "admin-role",
      moderator: "mod-role",
      observer: "player-role"
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /setup/register succeeds with zero role mappings -- the real guild owner can never be locked out", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-no-roles-"));
  const dbPath = join(dir, "setup.db");
  const app = createSetupServer(registerServerConfig({ dbPath, guildId: "g-no-roles" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guildId: "g-no-roles", consoleUrl: "https://console.test", adapterToken: "mock-token", accessToken: "mock-access-token" }),
      redirect: "manual"
    });
    assert.equal(res.status, 302, "no role mapping is required any more -- owner-tier access always exists via real guild ownership");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /setup/register rejects a role mapped to two tiers (separation of duties)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-sod-"));
  const dbPath = join(dir, "setup.db");
  const app = createSetupServer(registerServerConfig({ dbPath, guildId: "g-sod" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-sod",
        consoleUrl: "https://console.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token",
        adminRoleId: "same-role",
        moderatorRoleId: "same-role"
      }),
      redirect: "manual"
    });
    assert.equal(res.status, 400);
    const body = await res.text();
    assert.ok(body.includes("same-role"), "error page should name the conflicting role ID");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /setup/register lets an operator reassign an already-mapped role to a new tier", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDatabase, getGuildRoles } = await import("../src/database.js");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-reassign-"));
  const dbPath = join(dir, "setup.db");
  const app = createSetupServer(registerServerConfig({ dbPath, guildId: "g-reassign" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // Code-review finding: a role originally mapped to "moderator" must be
    // promotable to "admin" through a later /setup submission, not
    // permanently rejected as a conflict against its own prior mapping.
    const first = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-reassign",
        consoleUrl: "https://console.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token",
        moderatorRoleId: "role-x"
      }),
      redirect: "manual"
    });
    assert.equal(first.status, 302);

    const second = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-reassign",
        consoleUrl: "https://console.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token",
        adminRoleId: "role-x"
      }),
      redirect: "manual"
    });
    assert.equal(second.status, 302, "reassigning role-x from moderator to admin must succeed, not 400 as a conflict");

    const db = createDatabase(dbPath);
    const roles = getGuildRoles(db, "g-reassign");
    db.close();
    const byType = Object.fromEntries(roles.map((r) => [r.role_type, r.role_id]));
    assert.deepEqual(byType, { admin: "role-x" }, "role-x's stale moderator row must be removed, not left alongside the new admin row");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /setup/register still rejects a genuine conflict against an unrelated pre-existing role", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-real-conflict-"));
  const dbPath = join(dir, "setup.db");
  const app = createSetupServer(registerServerConfig({ dbPath, guildId: "g-real-conflict" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    // role-a is mapped to "observer" and left alone by the second
    // submission -- a later request must still be rejected if it tries to
    // ALSO give role-a the "admin" tier, since that request never mentions
    // reassigning role-a away from observer.
    const first = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-real-conflict",
        consoleUrl: "https://console.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token",
        observerRoleId: "role-a"
      }),
      redirect: "manual"
    });
    assert.equal(first.status, 302);

    const second = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-real-conflict",
        consoleUrl: "https://console.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token",
        observerRoleId: "role-a",
        adminRoleId: "role-a"
      }),
      redirect: "manual"
    });
    assert.equal(second.status, 400, "role-a cannot be both observer and admin in the same submission");
    const body = await second.text();
    assert.ok(body.includes("role-a"), "error page should name the conflicting role ID");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── POST /api/alerts/relay authentication (issue #167) ───────────────────
// This route previously had zero authentication -- anyone who discovered
// the URL could inject arbitrary-looking Alertmanager payloads and have
// them relayed to the real configured Discord channel as genuine alerts.
// These tests pin the fix's real, deliberately opt-in/backward-compatible
// contract: unauthenticated requests are still accepted (with a warning
// logged) until DUNE_ALERT_RELAY_TOKEN is set, at which point a request
// without a matching bearer token must be rejected with 401 before the
// payload is ever parsed or relayed.

function withEnv(overrides, fn) {
  const previous = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  Object.assign(process.env, overrides);
  return (async () => {
    try {
      return await fn();
    } finally {
      for (const key of Object.keys(overrides)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    }
  })();
}

async function withRelayApp(fn) {
  const app = createSetupServer({
    dbPath: ":memory:",
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100"
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const validAlertmanagerPayload = {
  alerts: [
    {
      status: "firing",
      labels: { alertname: "TestAlert", severity: "warning", instance: "test:9090" },
      annotations: { summary: "test alert" },
      startsAt: "2026-08-16T00:00:00Z"
    }
  ]
};

test("POST /api/alerts/relay accepts an unauthenticated request when DUNE_ALERT_RELAY_TOKEN is unset (backward compatible)", async () => {
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withRelayApp(async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validAlertmanagerPayload)
      });
      assert.equal(res.status, 200, "must still accept the request when no token is configured, per issue #167's backward-compatibility requirement");
      const body = await res.json();
      assert.equal(body.ok, true);
    })
  );
});

test("POST /api/alerts/relay rejects a request with no Authorization header once DUNE_ALERT_RELAY_TOKEN is set", async () => {
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "s3cr3t-token", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withRelayApp(async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validAlertmanagerPayload)
      });
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.match(body.error, /Unauthorized/);
    })
  );
});

test("POST /api/alerts/relay rejects a request with the wrong bearer token", async () => {
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "s3cr3t-token", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withRelayApp(async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
        body: JSON.stringify(validAlertmanagerPayload)
      });
      assert.equal(res.status, 401);
    })
  );
});

test("POST /api/alerts/relay accepts a request with the correct bearer token", async () => {
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "s3cr3t-token", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withRelayApp(async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer s3cr3t-token" },
        body: JSON.stringify(validAlertmanagerPayload)
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
    })
  );
});

test("POST /api/alerts/relay reads the token from DUNE_ALERT_RELAY_TOKEN_FILE when the direct value is unset", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "acp-relay-token-"));
  const tokenPath = join(dir, "token.txt");
  writeFileSync(tokenPath, "file-based-token\n");
  try {
    await withEnv({ DUNE_ALERT_RELAY_TOKEN: "", DUNE_ALERT_RELAY_TOKEN_FILE: tokenPath, DUNE_ALERT_WEBHOOK_URL: "" }, () =>
      withRelayApp(async (base) => {
        const wrong = await fetch(`${base}/api/alerts/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer not-the-file-token" },
          body: JSON.stringify(validAlertmanagerPayload)
        });
        assert.equal(wrong.status, 401);

        const right = await fetch(`${base}/api/alerts/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer file-based-token" },
          body: JSON.stringify(validAlertmanagerPayload)
        });
        assert.equal(right.status, 200, "must accept the token loaded from the _FILE path, trimmed of trailing whitespace");
      })
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/alerts/relay's direct DUNE_ALERT_RELAY_TOKEN value takes precedence over DUNE_ALERT_RELAY_TOKEN_FILE", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "acp-relay-token-precedence-"));
  const tokenPath = join(dir, "token.txt");
  writeFileSync(tokenPath, "file-token");
  try {
    await withEnv({ DUNE_ALERT_RELAY_TOKEN: "direct-token", DUNE_ALERT_RELAY_TOKEN_FILE: tokenPath, DUNE_ALERT_WEBHOOK_URL: "" }, () =>
      withRelayApp(async (base) => {
        const res = await fetch(`${base}/api/alerts/relay`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer direct-token" },
          body: JSON.stringify(validAlertmanagerPayload)
        });
        assert.equal(res.status, 200, "the direct env var value must win over the _FILE path when both are set");
      })
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/alerts/relay rejects a malformed Authorization header (not 'Bearer <token>') once a token is configured", async () => {
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "s3cr3t-token", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withRelayApp(async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "s3cr3t-token" },
        body: JSON.stringify(validAlertmanagerPayload)
      });
      assert.equal(res.status, 401, "a header missing the 'Bearer ' prefix must be rejected, not silently treated as the raw token");
    })
  );
});

test("POST /api/alerts/relay still validates the payload shape after a successful auth check", async () => {
  await withEnv({ DUNE_ALERT_RELAY_TOKEN: "s3cr3t-token", DUNE_ALERT_RELAY_TOKEN_FILE: "", DUNE_ALERT_WEBHOOK_URL: "" }, () =>
    withRelayApp(async (base) => {
      const res = await fetch(`${base}/api/alerts/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer s3cr3t-token" },
        body: JSON.stringify({ not: "an alertmanager payload" })
      });
      assert.equal(res.status, 400, "auth passing must not bypass the existing payload-shape validation");
    })
  );
});

// ─── POST /api/stats/push (mentat#276) ───────────────────────────────────
// Each opted-in operator's own Core console pushes its aggregate stats
// here. Unlike /api/alerts/relay above, this route is fail-closed from
// day one (no unauthenticated-request-allowed fallback) and scoped
// per-guild rather than one global token — see the Layer 1 Eight-Hats
// design audit (mentat#276 issue comment) for the full rationale.

async function withStatsPushApp(fn) {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDatabase, upsertGuild, setGuildStatsSharingSecret } = await import("../src/database.js");
  const { resetStatsPushRateLimiterForTests } = await import("../src/statsPushRateLimit.js");

  resetStatsPushRateLimiterForTests();

  const dir = mkdtempSync(join(tmpdir(), "acp-stats-push-"));
  const dbPath = join(dir, "acp.db");

  // Pre-populate via a separate writer connection, exactly like the
  // /api/live-stats file-backed-DB tests above — the server opens its
  // own connection to the same file.
  const writerDb = createDatabase(dbPath);
  upsertGuild(writerDb, { guildId: "opted-in-guild", guildName: "Opted In", consoleUrl: "https://opted.test", adapterToken: "t", status: "active" });
  setGuildStatsSharingSecret(writerDb, "opted-in-guild", "the-real-push-secret");
  upsertGuild(writerDb, { guildId: "never-opted-in-guild", guildName: "Never Opted In", consoleUrl: "https://never.test", adapterToken: "t", status: "active" });
  writerDb.close();

  const app = createSetupServer({ dbPath, discordClientId: "client-id", baseUrl: "http://localhost:3100" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`, { dbPath, createDatabase: (await import("../src/database.js")).createDatabase });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    resetStatsPushRateLimiterForTests();
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

const validStatsPushPayload = { guildId: "opted-in-guild", playersOnline: 10, spiceFields: 3, sietches: 2 };

test("POST /api/stats/push accepts a correctly-authenticated push and it becomes readable via getActiveGuildStatsAggregate", async () => {
  await withStatsPushApp(async (base, { dbPath, createDatabase }) => {
    const res = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer the-real-push-secret" },
      body: JSON.stringify(validStatsPushPayload)
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.nextPushSeconds, "number", "must hint a next-push interval, mirroring publicDirectory.js's nextHeartbeatSeconds (Layer 1 Network finding #20)");

    const { getActiveGuildStatsAggregate } = await import("../src/database.js");
    const readerDb = createDatabase(dbPath);
    const aggregate = getActiveGuildStatsAggregate(readerDb);
    assert.equal(aggregate.contributing_guilds, 1);
    assert.equal(aggregate.players_online, 10);
    readerDb.close();
  });
});

// Layer 1 Security Architect / QA audit findings #1/#2: an unknown
// guild_id, a known guild that never opted in, and a known guild with the
// wrong secret must all be byte-for-byte indistinguishable to a caller.
// This is the direct regression test for that requirement.
test("POST /api/stats/push: unknown guild_id, never-opted-in guild, and wrong secret all produce byte-identical 401 responses", async () => {
  await withStatsPushApp(async (base) => {
    const cases = [
      { guildId: "no-such-guild", secret: "irrelevant" },
      { guildId: "never-opted-in-guild", secret: "irrelevant" },
      { guildId: "opted-in-guild", secret: "wrong-secret" }
    ];

    const responses = [];
    for (const { guildId, secret } of cases) {
      const res = await fetch(`${base}/api/stats/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ guildId, playersOnline: 1, spiceFields: 1, sietches: 1 })
      });
      assert.equal(res.status, 401);
      responses.push(await res.json());
    }

    assert.deepEqual(responses[0], responses[1], "unknown guild vs. never-opted-in guild must return an identical body");
    assert.deepEqual(responses[1], responses[2], "never-opted-in guild vs. wrong-secret must return an identical body");
    assert.deepEqual(responses[0], { error: "unauthorized" });
  });
});

test("POST /api/stats/push rejects a request with no Authorization header", async () => {
  await withStatsPushApp(async (base) => {
    const res = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(validStatsPushPayload)
    });
    assert.equal(res.status, 401);
  });
});

test("POST /api/stats/push rejects a non-numeric/negative/absurd payload without touching a previously-good snapshot", async () => {
  const { resetStatsPushRateLimiterForTests } = await import("../src/statsPushRateLimit.js");
  await withStatsPushApp(async (base, { dbPath, createDatabase }) => {
    // This test sends two requests for the same guild — raise the
    // per-guild limit so rate limiting (tested separately below) doesn't
    // interfere with what this test is actually checking.
    resetStatsPushRateLimiterForTests({ perGuildMax: 100, perGuildWindow: 60000 });
    const good = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer the-real-push-secret" },
      body: JSON.stringify(validStatsPushPayload)
    });
    assert.equal(good.status, 200);

    const bad = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer the-real-push-secret" },
      body: JSON.stringify({ guildId: "opted-in-guild", playersOnline: -1, spiceFields: 3, sietches: 2 })
    });
    assert.equal(bad.status, 400);

    const { getActiveGuildStatsAggregate } = await import("../src/database.js");
    const readerDb = createDatabase(dbPath);
    const aggregate = getActiveGuildStatsAggregate(readerDb);
    assert.equal(aggregate.players_online, 10, "the rejected push must not have overwritten the previously-good value");
    readerDb.close();
  });
});

test("POST /api/stats/push is rate-limited per guild_id, independent of a different guild's own limit", async () => {
  const { resetStatsPushRateLimiterForTests } = await import("../src/statsPushRateLimit.js");
  await withStatsPushApp(async (base) => {
    resetStatsPushRateLimiterForTests({ perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 60000 });

    const first = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer the-real-push-secret" },
      body: JSON.stringify(validStatsPushPayload)
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer the-real-push-secret" },
      body: JSON.stringify(validStatsPushPayload)
    });
    assert.equal(second.status, 429, "a second push within the per-guild window must be rejected");
    assert.ok(second.headers.get("retry-after"), "must include a Retry-After header");
  });
});

test("POST /api/stats/push rate limiting is global-capped too, bounding a flood of fabricated guild_ids", async () => {
  const { resetStatsPushRateLimiterForTests } = await import("../src/statsPushRateLimit.js");
  await withStatsPushApp(async (base) => {
    resetStatsPushRateLimiterForTests({ globalMax: 3, globalWindow: 60000, globalBlock: 60000, perGuildMax: 100, perGuildWindow: 60000 });

    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${base}/api/stats/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer irrelevant" },
        body: JSON.stringify({ guildId: `fabricated-${i}`, playersOnline: 1, spiceFields: 1, sietches: 1 })
      });
      assert.equal(res.status, 401, "these use fabricated/unknown guild ids, so still unauthorized -- but each pays the auth-check cost and counts against the global cap");
    }

    const third = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer irrelevant" },
      body: JSON.stringify({ guildId: "fabricated-yet-another", playersOnline: 1, spiceFields: 1, sietches: 1 })
    });
    assert.equal(third.status, 429, "a flood of distinct fabricated guild_ids must still be bounded by the global cap, not just the per-guild one");
  });
});

// Direct regression test for the Layer 2 /code-review high finding
// (statsPushRateLimit.js's own module comment): an unauthenticated
// attacker who merely knows a victim guild's REAL id (public -- visible
// in invite links, widgets, etc., not a secret) must not be able to
// exhaust that guild's own per-guild rate-limit bucket using
// wrong-secret requests, since that would deny the real operator's own
// legitimate, correctly-authenticated push. The per-guild bucket must
// only ever be consumed by requests that already passed auth.
test("wrong-secret requests against a real guild_id never exhaust that guild's own rate limit for the real operator", async () => {
  const { resetStatsPushRateLimiterForTests } = await import("../src/statsPushRateLimit.js");
  await withStatsPushApp(async (base) => {
    resetStatsPushRateLimiterForTests({ perGuildMax: 2, perGuildWindow: 60000, perGuildBlock: 60000, globalMax: 1000, globalWindow: 60000 });

    // An attacker who knows "opted-in-guild" is a real, active guild
    // sends several wrong-secret requests against it.
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/api/stats/push`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer attacker-guess" },
        body: JSON.stringify({ guildId: "opted-in-guild", playersOnline: 1, spiceFields: 1, sietches: 1 })
      });
      assert.equal(res.status, 401);
    }

    // The real operator's own correctly-authenticated push must still
    // succeed -- the attacker's failed attempts must not have consumed
    // "opted-in-guild"'s per-guild bucket.
    const real = await fetch(`${base}/api/stats/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer the-real-push-secret" },
      body: JSON.stringify(validStatsPushPayload)
    });
    assert.equal(real.status, 200, "the real operator's legitimate push must succeed -- an attacker's wrong-secret requests against the same guild_id must never consume that guild's own rate-limit budget");
  });
});

// mentat-link#127: renderPage()'s sand-particle script was externalized
// from an inline <script> block to a same-origin <script src="/js/sand.js">
// reference (CSP compatibility, see setupLayout.test.js for that half of
// this fix). This is the other half: prove the real, running setup server
// actually serves that exact path with real content via express.static(),
// not just that the HTML references it -- a broken/missing static file
// would otherwise only surface as a silent, browser-console-only 404 for
// real users, never failing any existing test.
test("GET /js/sand.js is served by the real running setup server with real script content", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/js/sand.js`);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /sandLayer/, "must serve the real sand-particle script, not an empty/placeholder file");
    assert.match(res.headers.get("content-type") || "", /javascript/, "must be served with a JS content type, not e.g. text/plain");
  });
});

// mentat#333 (comprehensive wizard security audit finding): the CORS
// allowlist had gone stale (dead acp.darkdante.org/acp-landing.pages.dev
// origins, missing the real current production origin).
test("CORS allowlist accepts the real, current production origin (mentat-link.darkdante.org)", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/health`, { headers: { Origin: "https://mentat-link.darkdante.org" } });
    assert.equal(res.headers.get("access-control-allow-origin"), "https://mentat-link.darkdante.org");
  });
});

test("CORS allowlist no longer accepts the dead acp.darkdante.org/acp-landing.pages.dev origins", async () => {
  await withApp(async (base) => {
    const dead1 = await fetch(`${base}/health`, { headers: { Origin: "https://acp.darkdante.org" } });
    assert.equal(dead1.headers.get("access-control-allow-origin"), null);
    const dead2 = await fetch(`${base}/health`, { headers: { Origin: "https://acp-landing.pages.dev" } });
    assert.equal(dead2.headers.get("access-control-allow-origin"), null);
  });
});

// mentat#333: err.message used to be shown verbatim to an unauthenticated
// caller on these two error paths -- pinned at the source level (both
// call sites are hard to reliably force into their generic-error catch
// block via a real HTTP request without a more invasive DB-failure
// harness, disproportionate to this LOW-severity, non-exploitable finding
// -- unnecessary detail exposure, not a secret leak).
//
// mentat#327/#328 (merged after this test was written) added two NEW,
// narrower `${err.message}` usages inside /setup/register's inner
// try/catch blocks (verifyGuildOwnership/validateConsoleUrl) -- those are
// safe by construction: both throw only fixed, developer-authored strings
// with no interpolated external/internal data (see
// src/consoleUrlValidation.js and verifyGuildOwnership in src/setupServer.js),
// unlike the generic outer catches below, which wrap arbitrary unexpected
// exceptions. A blanket "no ${err.message} anywhere in the file" assertion
// would false-positive on that legitimate, reviewed usage -- so this test
// pins the two *generic outer catch* call sites specifically, not the
// literal string everywhere in the file.
test("the /oauth/callback and /setup/register error paths log the real error and no longer interpolate err.message into the caller-visible response", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/setupServer.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /errorPage\(res, 500, "Setup Error", err\.message\)/, "oauth/callback must not echo err.message back to the caller");
  assert.doesNotMatch(src, /errorPage\(res, 500, "Setup Failed",\s*\n\s*`?\$\{err\.message\}/, "setup/register's generic outer catch must not echo err.message back to the caller");
  assert.match(src, /logError\("setup\.oauth_callback_failed", err\)/, "the real error must still be logged server-side");
  assert.match(src, /logError\("setup\.register_failed", err\)/, "the real error must still be logged server-side");
});

// ─── mentat#327/#328/#330: /setup/register + /setup/success security ─────
// hardening -- regression tests proving the actual fixes, not just that
// pre-existing tests still pass.

test("POST /setup/register rejects a guildId the submitted access token does not own -- mentat#327 (unauthenticated cross-tenant guild hijack)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDatabase, getGuild } = await import("../src/database.js");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-hijack-"));
  const dbPath = join(dir, "setup.db");
  // fetchImplOwning is configured to confirm ownership of "g-legit-owned",
  // NOT the guildId this test actually submits -- simulating an attacker
  // who knows a victim's guildId but has no real Discord ownership of it.
  const app = createSetupServer(registerServerConfig({ dbPath, guildId: "g-legit-owned" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-victim-guild",
        consoleUrl: "https://console.test",
        adapterToken: "attacker-controlled-token",
        accessToken: "attacker-access-token"
      }),
      redirect: "manual"
    });
    assert.equal(res.status, 403, "a hijack attempt against an unowned guildId must be rejected, not silently registered");

    const db = createDatabase(dbPath);
    const stored = getGuild(db, "g-victim-guild");
    db.close();
    assert.equal(stored, undefined, "the victim guild must NOT be registered to the attacker's consoleUrl/adapterToken");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /setup/register rejects a missing access token outright -- no bypass for callers that omit it", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-no-token",
        consoleUrl: "https://console.test",
        adapterToken: "mock-token"
        // deliberately no accessToken
      }),
      redirect: "manual"
    });
    assert.equal(res.status, 403, "omitting the access token must not be treated as a trusted API/test caller -- it must fail ownership verification");
  });
});

test("POST /setup/register rejects a consoleUrl that resolves to a private/internal address -- mentat#328 (SSRF)", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDatabase, getGuild } = await import("../src/database.js");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-ssrf-"));
  const dbPath = join(dir, "setup.db");
  const app = createSetupServer({
    dbPath,
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100",
    fetchImpl: fetchImplOwning("g-ssrf-guild"),
    // Simulates a hostname that resolves to a cloud-metadata/link-local
    // address -- the exact class of destination this check must reject.
    lookupImpl: async () => ([{ address: "169.254.169.254", family: 4 }])
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-ssrf-guild",
        consoleUrl: "https://attacker-controlled-hostname.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token"
      }),
      redirect: "manual"
    });
    assert.equal(res.status, 400, "a consoleUrl resolving to a metadata/link-local address must be rejected");

    const db = createDatabase(dbPath);
    const stored = getGuild(db, "g-ssrf-guild");
    db.close();
    assert.equal(stored, undefined, "the guild must not be registered with an SSRF-capable consoleUrl");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /setup/register rejects a non-https consoleUrl", async () => {
  const app = createSetupServer(registerServerConfig({ dbPath: ":memory:", guildId: "g-http-only" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-http-only",
        consoleUrl: "http://console.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token"
      }),
      redirect: "manual"
    });
    assert.equal(res.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("GET /setup/success discloses guild details ONLY to the holder of the single-use handoff token -- mentat#330", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-success-token-"));
  const dbPath = join(dir, "setup.db");
  const app = createSetupServer(registerServerConfig({ dbPath, guildId: "g-success-token" }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const registerRes = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        guildId: "g-success-token",
        consoleUrl: "https://console.test",
        adapterToken: "mock-token",
        accessToken: "mock-access-token"
      }),
      redirect: "manual"
    });
    assert.equal(registerRes.status, 302);
    const location = registerRes.headers.get("location");
    assert.match(location, /^\/setup\/success\?guildId=g-success-token&token=[0-9a-f]+$/);

    // An unauthenticated caller who merely knows the guildId (no token) must
    // NOT see the real guild name -- previously, this was a full,
    // unauthenticated cross-tenant enumeration oracle.
    const noToken = await fetch(`${base}/setup/success?guildId=g-success-token`);
    assert.equal(noToken.status, 200);
    const noTokenBody = await noToken.text();
    assert.ok(!noTokenBody.includes("Test Guild"), "must not disclose the real guild name without the handoff token");
    assert.ok(noTokenBody.includes("Your server"), "must fall back to the generic placeholder");

    // The real redirect (with the correct token) DOES see the real details.
    const withToken = await fetch(`${base}${location}`);
    assert.equal(withToken.status, 200);
    const withTokenBody = await withToken.text();
    assert.ok(withTokenBody.includes("Test Guild"), "the legitimate holder of the handoff token must see the real guild name");

    // The token is single-use -- a second visit with the same token/guildId
    // must no longer disclose the real name either.
    const replay = await fetch(`${base}${location}`);
    const replayBody = await replay.text();
    assert.ok(!replayBody.includes("Test Guild"), "the handoff token must not be reusable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});
