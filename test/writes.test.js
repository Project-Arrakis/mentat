import assert from "node:assert/strict";
import { test } from "node:test";
import { writesEnabled, canWrite, generateIdempotencyKey, requireConfirmation, isConfirmationResponse, writeRoleIds, writeAuditEvent, parseCsv } from "../src/writes.js";

test("writesEnabled returns false by default", () => {
  assert.equal(writesEnabled({}), false);
});

test("writesEnabled respects env flag", () => {
  const old = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    assert.equal(writesEnabled({}), true);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = old;
  }
});

test("writesEnabled respects config flag", () => {
  assert.equal(writesEnabled({ discord: { writes: { enabled: true } } }), true);
});

test("canWrite returns false when writes disabled", () => {
  assert.equal(canWrite({ member: { roles: { cache: new Map([["admin", {}]]) } } }, {}), false);
});

test("canWrite returns false when user has no matching write roles", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  const oldOwnerIds = process.env.DISCORD_WRITE_OWNER_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  process.env.DISCORD_WRITE_OWNER_ROLE_IDS = "write-owner-role";
  try {
    const interaction = { member: { roles: { cache: new Map([["observer-role", {}]]) } } };
    assert.equal(canWrite(interaction, { discord: { writes: { enabled: true } } }), false);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
    process.env.DISCORD_WRITE_OWNER_ROLE_IDS = oldOwnerIds;
  }
});

test("canWrite allows admin role when writes enabled", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  try {
    const interaction = { member: { roles: { cache: new Map([["write-admin-role", {}]]) } } };
    assert.equal(canWrite(interaction, { discord: { writes: { enabled: true } } }), true);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
  }
});

// Issue #238: DISCORD_WRITE_OWNER_ROLE_IDS is deprecated for granting
// owner-tier access -- it's folded into the ADMIN-equivalent set instead
// (matching isAdminActor()'s existing back-compat behavior in
// commands.js), so a role in this list reaches admin-tier, never owner.
test("canWrite folds DISCORD_WRITE_OWNER_ROLE_IDS into admin-tier (not owner-tier) for back-compat", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldOwnerIds = process.env.DISCORD_WRITE_OWNER_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_OWNER_ROLE_IDS = "write-owner-role";
  try {
    const interaction = { member: { roles: { cache: new Map([["write-owner-role", {}]]) } } };
    const config = { discord: { writes: { enabled: true } } };
    assert.equal(canWrite(interaction, config), true, "reaches the default admin-or-above threshold");
    assert.equal(canWrite(interaction, config, "admin"), true);
    assert.equal(canWrite(interaction, config, "owner"), false, "no longer reaches owner-tier -- only real guild ownership does");
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_OWNER_ROLE_IDS = oldOwnerIds;
  }
});

test("canWrite grants owner-tier to the real Discord guild owner, regardless of any role or env config", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    const interaction = {
      user: { id: "real-owner" },
      guild: { ownerId: "real-owner" },
      member: { roles: { cache: new Map() } }
    };
    const config = { discord: { writes: { enabled: true } } };
    assert.equal(canWrite(interaction, config, "owner"), true);
    assert.equal(canWrite(interaction, config, "admin"), true, "owner outranks admin");
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
  }
});

// Regression test for a real ordering bug a code review caught: an earlier
// revision checked `interaction.member.roles` for presence BEFORE checking
// real guild ownership, so the actual owner was denied whenever
// member.roles was falsy/missing (a partial member payload) -- exactly
// contradicting "owner-tier access is decided by real Discord guild
// ownership ... never by a role". This interaction deliberately omits
// member.roles entirely.
test("canWrite grants owner-tier to the real guild owner even when interaction.member.roles is missing", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    const interaction = { user: { id: "real-owner" }, guild: { ownerId: "real-owner" }, member: {} };
    const config = { discord: { writes: { enabled: true } } };
    assert.equal(canWrite(interaction, config, "owner"), true, "guild ownership must be checked before any role-shaped guard");
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
  }
});

test("canWrite enforces tier separation when requiredTier is given", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  try {
    const config = { discord: { writes: { enabled: true } } };
    const adminInteraction = { member: { roles: { cache: new Map([["write-admin-role", {}]]) } } };
    // Issue #238: owner-tier is real Discord guild ownership, never a role.
    const ownerInteraction = {
      user: { id: "real-owner" },
      guild: { ownerId: "real-owner" },
      member: { roles: { cache: new Map() } }
    };

    // Admin cannot reach owner-tier actions.
    assert.equal(canWrite(adminInteraction, config, "owner"), false);
    // Admin can reach admin-tier actions.
    assert.equal(canWrite(adminInteraction, config, "admin"), true);
    // Owner outranks admin: can reach both tiers.
    assert.equal(canWrite(ownerInteraction, config, "owner"), true);
    assert.equal(canWrite(ownerInteraction, config, "admin"), true);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
  }
});

test("canWrite without requiredTier preserves legacy union behavior", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldAdminIds = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
  try {
    const config = { discord: { writes: { enabled: true } } };
    const adminInteraction = { member: { roles: { cache: new Map([["write-admin-role", {}]]) } } };
    assert.equal(canWrite(adminInteraction, config), true);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdminIds;
  }
});

test("canWrite returns false without member roles", () => {
  const old = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    assert.equal(canWrite({ member: {} }, {}), false);
    assert.equal(canWrite({}, {}), false);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = old;
  }
});

// ── Multi-tenant tier wiring (unified-RBAC Phase 1) ───────────────────────
// In multi-tenant mode canWrite() must resolve the actor's tier from the
// guild's guild_roles rows (all four tiers), not from process env vars --
// a hosted guild's owner-tier row previously could not reach owner-tier
// write actions because the env-only lookup never saw it.

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

test("canWrite (multi-tenant) lets a guild_roles admin reach admin-tier actions but not owner-tier", () => {
  const db = mtDb([{ type: "admin", id: "admin-role" }]);
  const actor = mtActor(["admin-role"]);
  assert.equal(canWrite(actor, mtDbConfig, null, db, "guild-9"), true, "admin passes default (admin-or-above)");
  assert.equal(canWrite(actor, mtDbConfig, "admin", db, "guild-9"), true);
  assert.equal(canWrite(actor, mtDbConfig, "owner", db, "guild-9"), false, "admin must not reach owner-tier");
});

// Issue #238: a legacy guild_roles "owner" row (from before the
// unification) is inert -- it must not reach owner-tier, or any tier.
test("canWrite (multi-tenant) ignores a legacy guild_roles owner row", () => {
  const db = mtDb([{ type: "owner", id: "owner-role" }]);
  const actor = mtActor(["owner-role"]);
  assert.equal(canWrite(actor, mtDbConfig, null, db, "guild-9"), false);
  assert.equal(canWrite(actor, mtDbConfig, "owner", db, "guild-9"), false);
});

test("canWrite (multi-tenant) grants owner-tier to the real Discord guild owner regardless of guild_roles", () => {
  const db = mtDb([{ type: "admin", id: "admin-role" }]);
  const actor = {
    user: { id: "real-owner" },
    guild: { ownerId: "real-owner" },
    member: { roles: { cache: new Map() } }
  };
  assert.equal(canWrite(actor, mtDbConfig, "owner", db, "guild-9"), true);
  assert.equal(canWrite(actor, mtDbConfig, "admin", db, "guild-9"), true, "owner is above admin");
});

test("canWrite (multi-tenant) rejects player/moderator tiers for write actions", () => {
  const db = mtDb([{ type: "observer", id: "player-role" }, { type: "moderator", id: "mod-role" }]);
  assert.equal(canWrite(mtActor(["player-role"]), mtDbConfig, null, db, "guild-9"), false);
  assert.equal(canWrite(mtActor(["mod-role"]), mtDbConfig, null, db, "guild-9"), false, "moderator is below admin, so no write access");
});

test("canWrite (multi-tenant) rejects actors with no configured guild_roles row", () => {
  const db = mtDb([{ type: "admin", id: "admin-role" }]);
  assert.equal(canWrite(mtActor(["some-other-role"]), mtDbConfig, null, db, "guild-9"), false);
  assert.equal(canWrite(mtActor([]), mtDbConfig, null, db, "guild-9"), false);
});

test("writeRoleIds parses env vars", () => {
  const oldAdmin = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  const oldOwner = process.env.DISCORD_WRITE_OWNER_ROLE_IDS;
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "a,b";
  process.env.DISCORD_WRITE_OWNER_ROLE_IDS = "c";
  try {
    const ids = writeRoleIds();
    assert.deepEqual(ids.admin, ["a", "b"]);
    assert.deepEqual(ids.owner, ["c"]);
  } finally {
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdmin;
    process.env.DISCORD_WRITE_OWNER_ROLE_IDS = oldOwner;
  }
});

test("generateIdempotencyKey produces unique keys", () => {
  const k1 = generateIdempotencyKey();
  const k2 = generateIdempotencyKey();
  assert.ok(k1.startsWith("dune-idem-"));
  assert.notEqual(k1, k2);
});

test("requireConfirmation returns confirmation message", () => {
  const result = requireConfirmation({ action: "set-maintenance-note", target: "server", risk: "low" });
  assert.equal(result.needsConfirmation, true);
  assert.ok(result.message.includes("set-maintenance-note"));
  assert.ok(result.message.includes("server"));
});

test("isConfirmationResponse recognizes confirm", () => {
  assert.equal(isConfirmationResponse("confirm"), true);
  assert.equal(isConfirmationResponse(" Confirm "), true);
  assert.equal(isConfirmationResponse("cancel"), false);
  assert.equal(isConfirmationResponse("no"), false);
});

test("writeAuditEvent records actor, action, and idempotency", () => {
  const event = writeAuditEvent({
    actor: { userId: "u1", guildId: "g1", channelId: "c1", username: "test" },
    action: "broadcast:send",
    capability: "broadcast:execute",
    idempotencyKey: "dune-idem-abc",
    result: "pending",
    detail: { message: "Server restart" }
  });
  assert.equal(event.source, "discord-write");
  assert.equal(event.actor.userId, "u1");
  assert.equal(event.action, "broadcast:send");
  assert.equal(event.capability, "broadcast:execute");
  assert.equal(event.idempotencyKey, "dune-idem-abc");
  assert.equal(event.result, "pending");
  assert.equal(event.detail.message, "Server restart");
  assert.equal(event.detail.writeEnabled, false);
  assert.ok(event.timestamp.length > 0);
});

test("writeAuditEvent records failed result", () => {
  const event = writeAuditEvent({
    actor: { userId: "u1" },
    action: "operations:restart-service",
    capability: "ops:restart",
    idempotencyKey: "key-1",
    result: "denied"
  });
  assert.equal(event.result, "denied");
});

test("parseCsv splits and trims", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("a, b ,c"), ["a", "b", "c"]);
});
