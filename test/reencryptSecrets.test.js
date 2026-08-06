import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { reencryptColumn, runReencrypt } from "../scripts/reencrypt-secrets.js";
import { createDatabase } from "../src/database.js";
import { decryptSecret, _resetKeyCacheForTests } from "../src/secretsCrypto.js";

const KEY = "a".repeat(64);

function makeEnv(key = KEY) {
  return { ACP_SECRETS_KEY: key };
}

function openDb(path) {
  return createDatabase(path);
}

function seedPlaintext(db) {
  db.prepare("INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token, status) VALUES (?, ?, ?, ?, ?)")
    .run("g1", "Guild One", "http://example.invalid", "plain:tok-1", "active");
  db.prepare("INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token, status) VALUES (?, ?, ?, ?, ?)")
    .run("g2", "Guild Two", "http://example.invalid", "legacy-no-prefix-tok", "active");
}

test("reencryptColumn re-encrypts plaintext rows and skips already-encrypted ones", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reenc-"));
  const dbPath = join(dir, "acp.db");
  const db = openDb(dbPath);
  seedPlaintext(db);
  db.prepare("INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token, status) VALUES (?, ?, ?, ?, ?)")
    .run("g3", "Guild Three", "http://example.invalid", "enc:v1:AAAA", "active");

  const summary = reencryptColumn(db, { table: "guilds", keyColumns: ["guild_id"], valueColumn: "adapter_token" }, { env: makeEnv() });
  assert.deepEqual(
    { ...summary, total: summary.total },
    { table: "guilds", total: 3, changed: 2, skipped: 1 }
  );

  const rows = db.prepare("SELECT adapter_token FROM guilds ORDER BY guild_id").all();
  assert.ok(rows[0].adapter_token.startsWith("enc:v1:"), "plain:tok-1 should be encrypted");
  assert.ok(rows[1].adapter_token.startsWith("enc:v1:"), "legacy plaintext should be encrypted");
  assert.equal(rows[2].adapter_token, "enc:v1:AAAA", "already-encrypted row is untouched");

  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("reencryptColumn in dry-run mode changes nothing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reenc-"));
  const dbPath = join(dir, "acp.db");
  const db = openDb(dbPath);
  seedPlaintext(db);

  const summary = reencryptColumn(db, { table: "guilds", keyColumns: ["guild_id"], valueColumn: "adapter_token" }, { dryRun: true, env: makeEnv() });
  assert.equal(summary.changed, 2);

  const rows = db.prepare("SELECT adapter_token FROM guilds ORDER BY guild_id").all();
  assert.equal(rows[0].adapter_token, "plain:tok-1", "dry-run must not alter rows");
  assert.equal(rows[1].adapter_token, "legacy-no-prefix-tok", "dry-run must not alter rows");

  db.close();
  await rm(dir, { recursive: true, force: true });
});

test("runReencrypt migrates both tables and round-trips correctly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reenc-"));
  const dbPath = join(dir, "acp.db");
  const db = openDb(dbPath);
  seedPlaintext(db);

  const result = await runReencrypt(dbPath, { key: KEY });
  assert.equal(result.changedTotal, 2);
  assert.equal(result.dryRun, false);
  db.close();

  const check = openDb(dbPath);
  const rows = check.prepare("SELECT adapter_token FROM guilds ORDER BY guild_id").all();
  assert.equal(decryptSecret(rows[0].adapter_token, makeEnv()), "tok-1", "round-trip recovers plaintext");
  assert.equal(decryptSecret(rows[1].adapter_token, makeEnv()), "legacy-no-prefix-tok");
  check.close();
  await rm(dir, { recursive: true, force: true });
});

test("runReencrypt refuses to run without a configured key", async () => {
  _resetKeyCacheForTests();
  const dir = await mkdtemp(join(tmpdir(), "reenc-"));
  const dbPath = join(dir, "acp.db");
  const db = openDb(dbPath);
  seedPlaintext(db);
  db.close();

  await assert.rejects(
    runReencrypt(dbPath, { key: undefined, keyFile: undefined }),
    /no ACP_SECRETS_KEY/
  );

  const untouched = openDb(dbPath);
  const rows = untouched.prepare("SELECT adapter_token FROM guilds").all();
  assert.equal(rows[0].adapter_token, "plain:tok-1", "abort must leave rows untouched");
  untouched.close();
  _resetKeyCacheForTests();
  await rm(dir, { recursive: true, force: true });
});