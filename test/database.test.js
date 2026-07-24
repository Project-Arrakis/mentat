import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createDatabase,
  insertAuditLog,
  getAuditLog,
  pruneAuditLog
} from "../src/database.js";

function freshDb() {
  // ":memory:" — dirname(":memory:") resolves to "." (already exists),
  // so ensureDataDir() never attempts to create a real directory for
  // this path. Each test gets its own isolated in-memory database.
  return createDatabase(":memory:");
}

test("createDatabase creates the audit_log table with schema_version 3", () => {
  const db = freshDb();
  const row = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
  assert.equal(row.version, 3);

  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'"
  ).get();
  assert.ok(tableExists, "audit_log table should exist");
});

test("insertAuditLog writes a row with all fields", () => {
  const db = freshDb();
  insertAuditLog(db, {
    guildId: "guild-1",
    discordUserId: "user-1",
    discordUsername: "TestUser",
    channelId: "channel-1",
    command: "player:link",
    action: "player:link",
    capability: "ACCOUNT_LINK_WRITE",
    idempotencyKey: "dune-idem-abc",
    result: "success",
    detail: { characterName: "PaulAtreides" }
  });

  const rows = getAuditLog(db, { guildId: "guild-1" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].guild_id, "guild-1");
  assert.equal(rows[0].discord_user_id, "user-1");
  assert.equal(rows[0].discord_username, "TestUser");
  assert.equal(rows[0].command, "player:link");
  assert.equal(rows[0].result, "success");
  assert.deepEqual(rows[0].detail, { characterName: "PaulAtreides" });
});

test("insertAuditLog defaults every optional field safely", () => {
  const db = freshDb();
  insertAuditLog(db, {});
  const rows = getAuditLog(db, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].guild_id, "");
  assert.equal(rows[0].result, "unknown");
  assert.deepEqual(rows[0].detail, {});
});

test("insertAuditLog rejects an invalid result value (CHECK constraint)", () => {
  const db = freshDb();
  assert.throws(() => {
    insertAuditLog(db, { result: "not-a-real-result" });
  });
});

test("getAuditLog returns newest first", () => {
  const db = freshDb();
  insertAuditLog(db, { command: "first", result: "success" });
  insertAuditLog(db, { command: "second", result: "success" });
  insertAuditLog(db, { command: "third", result: "success" });

  const rows = getAuditLog(db, {});
  assert.deepEqual(rows.map((r) => r.command), ["third", "second", "first"]);
});

test("getAuditLog filters by guildId when provided", () => {
  const db = freshDb();
  insertAuditLog(db, { guildId: "guild-a", command: "cmd-a", result: "success" });
  insertAuditLog(db, { guildId: "guild-b", command: "cmd-b", result: "success" });

  const rowsA = getAuditLog(db, { guildId: "guild-a" });
  assert.equal(rowsA.length, 1);
  assert.equal(rowsA[0].command, "cmd-a");
});

test("getAuditLog with no guildId returns across all guilds", () => {
  const db = freshDb();
  insertAuditLog(db, { guildId: "guild-a", command: "cmd-a", result: "success" });
  insertAuditLog(db, { guildId: "guild-b", command: "cmd-b", result: "success" });

  const rows = getAuditLog(db, {});
  assert.equal(rows.length, 2);
});

test("getAuditLog caps limit at 200 and floors at 1", () => {
  const db = freshDb();
  for (let i = 0; i < 5; i++) insertAuditLog(db, { command: `cmd-${i}`, result: "success" });

  assert.equal(getAuditLog(db, { limit: 999 }).length, 5); // fewer rows than the cap exist
  assert.equal(getAuditLog(db, { limit: 0 }).length, 1); // floored to 1
  assert.equal(getAuditLog(db, { limit: -5 }).length, 1); // floored to 1
});

test("getAuditLog returns malformed detail JSON as an empty object rather than throwing", () => {
  const db = freshDb();
  db.prepare(`
    INSERT INTO audit_log (source, guild_id, command, result, detail)
    VALUES ('discord-command', '', 'broken', 'success', 'not valid json')
  `).run();

  const rows = getAuditLog(db, {});
  assert.deepEqual(rows[0].detail, {});
});

test("pruneAuditLog deletes rows older than maxAgeMs and keeps recent ones", () => {
  const db = freshDb();
  insertAuditLog(db, { command: "recent", result: "success" });
  db.prepare(`
    INSERT INTO audit_log (source, guild_id, command, result, detail, created_at)
    VALUES ('discord-command', '', 'ancient', 'success', '{}', '2020-01-01 00:00:00')
  `).run();

  const deleted = pruneAuditLog(db, 14 * 24 * 60 * 60 * 1000);
  assert.equal(deleted, 1);

  const remaining = getAuditLog(db, {});
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].command, "recent");
});

test("pruneAuditLog returns 0 when nothing is old enough to prune", () => {
  const db = freshDb();
  insertAuditLog(db, { command: "recent", result: "success" });
  const deleted = pruneAuditLog(db, 14 * 24 * 60 * 60 * 1000);
  assert.equal(deleted, 0);
});
