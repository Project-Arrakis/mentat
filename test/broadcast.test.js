import assert from "node:assert/strict";
import { test } from "node:test";
import { validateBroadcastMessage, broadcastEnabled, checkBroadcastCooldown, applyBroadcastCooldown, canBroadcast } from "../src/broadcast.js";
import { createDatabase, upsertGuild, addGuildRole } from "../src/database.js";

function mtWritesConfig() {
  return { multiTenant: true, discord: { writes: { enabled: true } } };
}

function mtDb(roles) {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "guild-9", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "t", status: "active" });
  for (const row of roles) addGuildRole(db, "guild-9", row.type, row.id);
  return db;
}

function mtActor(roleIds) {
  return { member: { roles: { cache: new Map(roleIds.map((id) => [id, {}])) } } };
}

const mtDbConfig = mtWritesConfig();

test("validateBroadcastMessage accepts valid message", () => {
  assert.equal(validateBroadcastMessage("Server restart in 5m"), "Server restart in 5m");
});

test("validateBroadcastMessage rejects empty message", () => {
  assert.throws(() => validateBroadcastMessage(""));
  assert.throws(() => validateBroadcastMessage("  "));
});

test("validateBroadcastMessage rejects long message", () => {
  assert.throws(() => validateBroadcastMessage("x".repeat(501)));
});

test("validateBroadcastMessage rejects control characters", () => {
  assert.throws(() => validateBroadcastMessage("bad\u0001message"));
});

test("broadcastEnabled returns false by default", () => {
  assert.equal(broadcastEnabled({}), false);
});

test("broadcast cooldown allows first request", () => {
  const result = checkBroadcastCooldown("u1");
  assert.equal(result.allowed, true);
});

test("broadcast cooldown blocks repeated requests", () => {
  applyBroadcastCooldown("u1");
  const result = checkBroadcastCooldown("u1");
  assert.equal(result.allowed, false);
});

test("canBroadcast (multi-tenant) allows a moderator-tier actor", () => {
  // Regression test: canBroadcast() used to pass requiredTier=null into
  // canWrite(), which silently defaults to "admin" -- denying a moderator
  // even though both the command's own Discord description ("moderator+")
  // and its own denial error message ("requires moderator or admin role")
  // advertised moderator access. Fixed to pass "moderator" explicitly.
  const db = mtDb([{ type: "moderator", id: "mod-role" }]);
  assert.equal(canBroadcast(mtActor(["mod-role"]), mtDbConfig, db, "guild-9"), true);
});

test("canBroadcast (multi-tenant) still allows admin and owner tiers", () => {
  const db = mtDb([{ type: "admin", id: "admin-role" }]);
  assert.equal(canBroadcast(mtActor(["admin-role"]), mtDbConfig, db, "guild-9"), true);
});

test("canBroadcast (multi-tenant) rejects a player-tier actor", () => {
  const db = mtDb([{ type: "observer", id: "player-role" }]);
  assert.equal(canBroadcast(mtActor(["player-role"]), mtDbConfig, db, "guild-9"), false);
});

test("canBroadcast returns false when writes are disabled", () => {
  const db = mtDb([{ type: "moderator", id: "mod-role" }]);
  assert.equal(canBroadcast(mtActor(["mod-role"]), { multiTenant: true, discord: { writes: { enabled: false } } }, db, "guild-9"), false);
});

test("broadcast cooldown allows different users", () => {
  applyBroadcastCooldown("u1");
  assert.equal(checkBroadcastCooldown("u2").allowed, true);
});
