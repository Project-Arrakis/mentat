// guildRolesRoutes.test.js -- mentat#343+ Phase 5, design doc §4.3/§4.4.
// Real HTTP integration tests for GET/POST /api/consoles/:guildId/roles,
// matching this repo's own withApp()/real-Express-server convention.
//
// Uses a real temp-file SQLite DB (not ":memory:") -- a test that seeds
// data via its own createDatabase(dbPath) call and then expects the APP's
// own, separate createDatabase(dbPath) connection (inside
// createSetupServer()) to see it needs a real shared file: two
// ":memory:" connections are each their own independent, unshared
// database, matching test/setupServer.test.js's own mkdtempSync
// convention for the same reason.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSetupServer } from "../src/setupServer.js";
import { _resetEphemeralStateForTests, createDatabase, upsertGuild, getGuildRoles } from "../src/database.js";

test.beforeEach(() => {
  _resetEphemeralStateForTests();
});

const GUILD_ID = "111111111111111111";
const ADAPTER_TOKEN = "the-real-adapter-token";

function fakeDiscordRole(id, name, position = 0) {
  return { id, name, hexColor: "#000000", position };
}

// fakeDiscordClient: mimics the shape setupServer.js's routes actually
// read (client.guilds.cache.get(guildId)?.roles.cache) -- a real
// discord.js Client can't be constructed in a unit test without a live
// gateway connection.
function fakeDiscordClient({ guildInCache = true, roles = [] } = {}) {
  const roleMap = new Map(roles.map((r) => [r.id, r]));
  return {
    guilds: {
      cache: {
        get: (guildId) => {
          if (!guildInCache || guildId !== GUILD_ID) return undefined;
          return { roles: { cache: roleMap } };
        }
      }
    }
  };
}

// withRolesTestDb: creates a real temp-file DB, seeds it via `seed(db)`,
// starts a real Express server backed by that SAME file, runs `fn(base,
// dbPathForExternalReads)`, then tears everything down.
async function withRolesTestDb({ discordClient = fakeDiscordClient(), seed } = {}, fn) {
  const dir = mkdtempSync(join(tmpdir(), "mentat-guild-roles-"));
  const dbPath = join(dir, "test.db");
  const seedDb = createDatabase(dbPath);
  if (seed) seed(seedDb);
  seedDb.close();

  const app = createSetupServer({ dbPath, discordClientId: "client-id", baseUrl: "http://localhost:3100", discordClient });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`, dbPath);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
}

function seedOneGuild(db) {
  upsertGuild(db, { guildId: GUILD_ID, guildName: "Real Guild", consoleUrl: "https://console.test", adapterToken: ADAPTER_TOKEN, status: "active" });
}

// ─── GET /api/consoles/:guildId/roles: auth ───────────────────────────────

test("GET /roles rejects a request with no Authorization header at all", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`);
    assert.equal(res.status, 401);
  });
});

test("GET /roles rejects a request with the WRONG adapter token", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, { headers: { Authorization: "Bearer wrong-token" } });
    assert.equal(res.status, 401);
  });
});

test("GET /roles rejects a token that's valid for a DIFFERENT guild -- per-guild scoping, not just any registered token", async () => {
  const otherGuildId = "222222222222222222";
  await withRolesTestDb({
    seed: (db) => {
      seedOneGuild(db);
      upsertGuild(db, { guildId: otherGuildId, guildName: "Other Guild", consoleUrl: "https://other.test", adapterToken: "other-token", status: "active" });
    }
  }, async (base) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, { headers: { Authorization: "Bearer other-token" } });
    assert.equal(res.status, 401, "a token valid for a different guild must not authorize this one");
  });
});

test("GET /roles rejects a guildId that was never registered at all", async () => {
  await withRolesTestDb({}, async (base) => {
    const res = await fetch(`${base}/api/consoles/999999999999999999/roles`, { headers: { Authorization: `Bearer ${ADAPTER_TOKEN}` } });
    assert.equal(res.status, 401);
  });
});

// ─── GET /api/consoles/:guildId/roles: real data + cacheStale fallback ────

test("GET /roles with a valid token returns the guild's real Discord roles from the live gateway cache, excluding @everyone", async () => {
  const discordClient = fakeDiscordClient({
    roles: [
      fakeDiscordRole(GUILD_ID, "@everyone"), // same id as the guild -- must be excluded
      fakeDiscordRole("role-1", "Admins", 3),
      fakeDiscordRole("role-2", "Mods", 2)
    ]
  });
  await withRolesTestDb({ seed: seedOneGuild, discordClient }, async (base) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, { headers: { Authorization: `Bearer ${ADAPTER_TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.roles.length, 2, "must exclude @everyone (id === guildId)");
    assert.deepEqual(body.roles.map((r) => r.id).sort(), ["role-1", "role-2"]);
    assert.equal(body.cacheStale, undefined);
  });
});

test("GET /roles falls back to cacheStale:true (never a crash) when the bot hasn't reconnected to this guild yet", async () => {
  const discordClient = fakeDiscordClient({ guildInCache: false });
  await withRolesTestDb({ seed: seedOneGuild, discordClient }, async (base) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, { headers: { Authorization: `Bearer ${ADAPTER_TOKEN}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.roles, []);
    assert.equal(body.cacheStale, true);
  });
});

test("GET /roles with no discordClient configured at all (test/config gap) falls back gracefully, never crashes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "mentat-guild-roles-noclient-"));
  const dbPath = join(dir, "test.db");
  const seedDb = createDatabase(dbPath);
  seedOneGuild(seedDb);
  seedDb.close();

  const app = createSetupServer({ dbPath, discordClientId: "client-id", baseUrl: "http://localhost:3100" });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/api/consoles/${GUILD_ID}/roles`, { headers: { Authorization: `Bearer ${ADAPTER_TOKEN}` } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).cacheStale, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── POST /api/consoles/:guildId/roles: auth (same as GET) ───────────────

test("POST /roles rejects without a valid adapter token", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerRoleIds: ["r1"] })
    });
    assert.equal(res.status, 401);
  });
});

// ─── POST /api/consoles/:guildId/roles: writes + conflict detection ──────

test("POST /roles with N roles per tier writes all of them, translating playerRoleIds -> the observer tier internally", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base, dbPath) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["p1", "p2", "p3"], moderatorRoleIds: ["m1"], adminRoleIds: [] })
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).applied, true);

    const db = createDatabase(dbPath);
    const rows = getGuildRoles(db, GUILD_ID);
    db.close();
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((r) => r.role_type === "observer").length, 3, "playerRoleIds must be persisted under the observer role_type");
  });
});

test("POST /roles rejects a one-role-two-tiers submission with 409 and the real conflict detail, writes nothing", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base, dbPath) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["shared"], moderatorRoleIds: ["shared"], adminRoleIds: [] })
    });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.conflict.roleId, "shared");

    const db = createDatabase(dbPath);
    const rows = getGuildRoles(db, GUILD_ID);
    db.close();
    assert.equal(rows.length, 0, "a rejected submission must write nothing");
  });
});

test("POST /roles is per-guild scoped -- a valid token for guild A cannot write roles for guild B via the URL path", async () => {
  const otherGuildId = "222222222222222222";
  await withRolesTestDb({
    seed: (db) => {
      seedOneGuild(db);
      upsertGuild(db, { guildId: otherGuildId, guildName: "Other Guild", consoleUrl: "https://other.test", adapterToken: "other-token", status: "active" });
    }
  }, async (base, dbPath) => {
    const res = await fetch(`${base}/api/consoles/${otherGuildId}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["p1"] })
    });
    assert.equal(res.status, 401, "guild A's token must not authorize writing guild B's roles");
    const db = createDatabase(dbPath);
    const rows = getGuildRoles(db, otherGuildId);
    db.close();
    assert.equal(rows.length, 0);
  });
});

test("POST /roles ignores non-string/malformed entries in the submitted arrays rather than crashing", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base) => {
    const res = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["p1", null, 12345, ""], moderatorRoleIds: "not-an-array" })
    });
    assert.equal(res.status, 200);
  });
});

// ─── Layer 2 audit finding, HIGH: deselecting a role (omitting it from a
// resubmission) must actually revoke it -- full-state diffing, not just
// additive writes (mentat#352, the exact gap this endpoint was directed
// to close) ─────────────────────────────────────────────────────────────

test("POST /roles actually REVOKES a previously-mapped role that is absent from a resubmission -- the picker's real 'deselect' semantics", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base, dbPath) => {
    const first = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["p1", "p2", "p3"], moderatorRoleIds: [], adminRoleIds: [] })
    });
    assert.equal(first.status, 200);

    // Operator deselects p2/p3 in the picker, keeping only p1.
    const second = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["p1"], moderatorRoleIds: [], adminRoleIds: [] })
    });
    assert.equal(second.status, 200);

    const db = createDatabase(dbPath);
    const rows = getGuildRoles(db, GUILD_ID);
    db.close();
    assert.deepEqual(rows.map((r) => r.role_id).sort(), ["p1"], "p2 and p3 must be actually revoked, not silently retained");
  });
});

test("POST /roles: submitting an empty picker state for every tier clears all non-owner role mappings for the guild", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base, dbPath) => {
    await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["p1"], moderatorRoleIds: ["m1"], adminRoleIds: ["a1"] })
    });
    const cleared = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: [], moderatorRoleIds: [], adminRoleIds: [] })
    });
    assert.equal(cleared.status, 200);
    const db = createDatabase(dbPath);
    const rows = getGuildRoles(db, GUILD_ID);
    db.close();
    assert.equal(rows.length, 0);
  });
});

test("POST /roles: a rejected (409) resubmission leaves the PREVIOUS mapping completely untouched -- the full-state diff never partially applies", async () => {
  await withRolesTestDb({ seed: seedOneGuild }, async (base, dbPath) => {
    await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: ["p1"], moderatorRoleIds: [], adminRoleIds: [] })
    });
    // A conflicting resubmission that would ALSO have deselected p1.
    const conflicting = await fetch(`${base}/api/consoles/${GUILD_ID}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ADAPTER_TOKEN}` },
      body: JSON.stringify({ playerRoleIds: [], moderatorRoleIds: ["shared"], adminRoleIds: ["shared"] })
    });
    assert.equal(conflicting.status, 409);

    const db = createDatabase(dbPath);
    const rows = getGuildRoles(db, GUILD_ID);
    db.close();
    assert.deepEqual(rows.map((r) => r.role_id), ["p1"], "the rejected submission must not have deselected p1 either -- all-or-nothing");
  });
});
