import assert from "node:assert/strict";
import { test } from "node:test";
import { createSetupServer } from "../src/setupServer.js";

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
    assert.ok(html.includes("Arrakis Control Panel"), "should title the landing page");
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

// ─── Unified 4-tier role enrollment (Phase 1) ─────────────────────────────
// The wizard previously only accepted admin + observer role IDs. Owner and
// moderator tiers now have optional fields, and every role row must land
// in guild_roles with the correct role_type (owner > admin > moderator >
// player/observer ordering enforced upstream, but persistence must be
// exact or the tier resolver can fail closed on a working deployment).

test("setup wizard source exposes the Owner and Moderator and Player role fields", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/setupServer.js", import.meta.url), "utf8");
  assert.ok(src.includes('name="ownerRoleId"'), "should render the owner role field");
  assert.ok(src.includes('name="moderatorRoleId"'), "should render the moderator role field");
  assert.ok(src.includes('name="observerRoleId"'), "should render the player/observer role field");
});

test("POST /setup/register persists all four tier role rows", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { createDatabase, getGuildRoles } = await import("../src/database.js");

  const dir = mkdtempSync(join(tmpdir(), "acp-setup-rbac-"));
  const dbPath = join(dir, "setup.db");
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
    const payload = {
      discordUserId: "u1",
      guildId: "g-role-tiers",
      consoleUrl: "https://console.test",
      adapterToken: "mock-token",
      ownerRoleId: "owner-role",
      adminRoleId: "admin-role",
      moderatorRoleId: "mod-role",
      observerRoleId: "player-role"
    };
    const res = await fetch(`${base}/setup/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, guildId: "g-role-tiers", guildName: "Unknown" });

    const db = createDatabase(dbPath);
    const roles = getGuildRoles(db, "g-role-tiers");
    db.close();
    const byType = Object.fromEntries(roles.map((r) => [r.role_type, r.role_id]));
    assert.deepEqual(byType, {
      owner: "owner-role",
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
