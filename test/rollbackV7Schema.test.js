import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { runRollback } from "../scripts/rollback-v7-schema.js";
import { createDatabase } from "../src/database.js";

test("runRollback refuses a database with no schema_version table at all", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rollback-v7-"));
  const dbPath = join(dir, "acp.db");
  try {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE unrelated (id INTEGER PRIMARY KEY)");
    db.close();

    assert.throws(() => runRollback(dbPath), /no schema_version table/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runRollback refuses a database with a schema_version table but no row in it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rollback-v7-"));
  const dbPath = join(dir, "acp.db");
  try {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY)");
    db.close();

    assert.throws(() => runRollback(dbPath), /no schema_version row/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runRollback refuses a database that is not at schema_version 7", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rollback-v7-"));
  const dbPath = join(dir, "acp.db");
  try {
    const db = new Database(dbPath);
    db.exec("CREATE TABLE schema_version (version INTEGER PRIMARY KEY); INSERT INTO schema_version (version) VALUES (6);");
    db.close();

    assert.throws(() => runRollback(dbPath), /not 7/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runRollback --dry-run reports schema_version 7 -> 6 without modifying anything", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rollback-v7-"));
  const dbPath = join(dir, "acp.db");
  try {
    const seeded = createDatabase(dbPath);
    assert.equal(seeded.prepare("SELECT version FROM schema_version").get().version, 7);
    seeded.close();

    const result = runRollback(dbPath, { dryRun: true });
    assert.deepEqual(result, { dryRun: true, before: 7, after: 7 });

    const check = new Database(dbPath);
    assert.equal(check.prepare("SELECT version FROM schema_version").get().version, 7, "dry-run must not actually change schema_version");
    const tableNames = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    assert.equal(tableNames.includes("bot_stats"), false, "dry-run must not recreate any dropped table");
    check.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runRollback performs the real rollback and reports 7 -> 6", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rollback-v7-"));
  const dbPath = join(dir, "acp.db");
  try {
    const seeded = createDatabase(dbPath);
    seeded.close();

    const result = runRollback(dbPath);
    assert.deepEqual(result, { dryRun: false, before: 7, after: 6 });

    const check = new Database(dbPath);
    assert.equal(check.prepare("SELECT version FROM schema_version").get().version, 6);
    const tableNames = check.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    for (const restored of ["player_links", "guild_member_activity", "oauth_sessions", "bot_stats", "stats_snapshot", "guild_stats_snapshot"]) {
      assert.ok(tableNames.includes(restored), `${restored} must be recreated by a real rollback`);
    }
    check.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
