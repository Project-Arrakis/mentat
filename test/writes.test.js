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

test("canWrite allows owner role when writes enabled", () => {
  const oldEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  const oldOwnerIds = process.env.DISCORD_WRITE_OWNER_ROLE_IDS;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  process.env.DISCORD_WRITE_OWNER_ROLE_IDS = "write-owner-role";
  try {
    const interaction = { member: { roles: { cache: new Map([["write-owner-role", {}]]) } } };
    assert.equal(canWrite(interaction, { discord: { writes: { enabled: true } } }), true);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = oldEnabled;
    process.env.DISCORD_WRITE_OWNER_ROLE_IDS = oldOwnerIds;
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
