import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, getAuditLog } from "../src/database.js";
import {
  actionForCommand,
  recordAuditEvent,
  recordAuditEventForCommand,
  queryAuditLog,
  runAuditLogPruning
} from "../src/auditLog.js";

function freshDb() {
  return createDatabase(":memory:");
}

test("actionForCommand returns the mapping for tracked player:* keys", () => {
  const mapping = actionForCommand("player:link");
  assert.equal(mapping.action, "player:link");
  assert.equal(mapping.capability, "ACCOUNT_LINK_WRITE");
});

test("actionForCommand returns null for untracked keys", () => {
  assert.equal(actionForCommand("core:about"), null);
  assert.equal(actionForCommand("server:status"), null);
  assert.equal(actionForCommand("data:inventory"), null);
});

test("recordAuditEvent persists a row when db is provided", () => {
  const db = freshDb();
  recordAuditEvent({
    db,
    guildId: "guild-1",
    discordUserId: "user-1",
    discordUsername: "TestUser",
    command: "write:restart",
    action: "operations:restart-service",
    capability: "owner",
    idempotencyKey: "dune-idem-1",
    result: "pending",
    detail: { service: "gateway" }
  });

  const rows = getAuditLog(db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].command, "write:restart");
  assert.equal(rows[0].result, "pending");
  assert.deepEqual(rows[0].detail, { service: "gateway" });
});

test("recordAuditEvent redacts sensitive detail fields before persisting", () => {
  const db = freshDb();
  recordAuditEvent({
    db,
    command: "player:link",
    action: "player:link",
    capability: "ACCOUNT_LINK_WRITE",
    result: "success",
    detail: { steamId: "76561198012345678", note: "safe value" }
  });

  const rows = getAuditLog(db, {});
  // format.js's redactSecrets() redacts keys matching steamid/steam64/etc.
  assert.notEqual(rows[0].detail.steamId, "76561198012345678");
  assert.equal(rows[0].detail.note, "safe value");
});

test("recordAuditEvent does not throw when db is null (falls back to a log line)", () => {
  assert.doesNotThrow(() => {
    recordAuditEvent({ db: null, command: "player:link", result: "success" });
  });
});

test("recordAuditEvent does not throw when the underlying insert fails", () => {
  const brokenDb = {
    prepare() {
      throw new Error("simulated db failure");
    }
  };
  assert.doesNotThrow(() => {
    recordAuditEvent({ db: brokenDb, command: "player:link", result: "success" });
  });
});

test("recordAuditEventForCommand is a no-op for untracked commands", () => {
  const db = freshDb();
  recordAuditEventForCommand({
    db,
    interaction: { guildId: "g1", user: { id: "u1", username: "u" } },
    key: "core:about",
    result: "success"
  });
  assert.equal(getAuditLog(db, {}).length, 0);
});

test("recordAuditEventForCommand records tracked player:* commands with actor fields from the interaction", () => {
  const db = freshDb();
  recordAuditEventForCommand({
    db,
    interaction: {
      guildId: "guild-9",
      channelId: "channel-9",
      user: { id: "user-9", username: "PaulAtreides" }
    },
    key: "player:unlink",
    idempotencyKey: "idem-9",
    result: "success",
    detail: { characterLinkId: "abc" }
  });

  const rows = getAuditLog(db, { guildId: "guild-9" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].discord_user_id, "user-9");
  assert.equal(rows[0].discord_username, "PaulAtreides");
  assert.equal(rows[0].channel_id, "channel-9");
  assert.equal(rows[0].command, "player:unlink");
  assert.equal(rows[0].action, "player:unlink");
  assert.equal(rows[0].capability, "ACCOUNT_LINK_WRITE");
  assert.equal(rows[0].idempotency_key, "idem-9");
});

test("recordAuditEventForCommand tolerates a missing/partial interaction object", () => {
  const db = freshDb();
  assert.doesNotThrow(() => {
    recordAuditEventForCommand({ db, interaction: null, key: "player:link", result: "success" });
  });
  const rows = getAuditLog(db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].discord_user_id, "");
});

test("queryAuditLog returns [] when db is null", () => {
  assert.deepEqual(queryAuditLog(null, {}), []);
});

test("queryAuditLog delegates to getAuditLog when db is provided", () => {
  const db = freshDb();
  recordAuditEvent({ db, command: "player:faction", result: "success" });
  const rows = queryAuditLog(db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].command, "player:faction");
});

test("runAuditLogPruning returns 0 when db is null", () => {
  assert.equal(runAuditLogPruning(null, 1000), 0);
});

test("runAuditLogPruning prunes old rows via the database layer", () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO audit_log (source, guild_id, command, result, detail, created_at)
    VALUES ('discord-command', '', 'ancient', 'success', '{}', '2020-01-01 00:00:00')
  `).run();
  const deleted = runAuditLogPruning(db, 14 * 24 * 60 * 60 * 1000);
  assert.equal(deleted, 1);
});

test("runAuditLogPruning does not throw if the underlying prune call fails", () => {
  const brokenDb = {
    prepare() {
      throw new Error("simulated db failure");
    }
  };
  assert.doesNotThrow(() => {
    const result = runAuditLogPruning(brokenDb, 1000);
    assert.equal(result, 0);
  });
});
