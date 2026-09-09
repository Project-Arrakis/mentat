import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { createDatabase, getGuild, upsertGuild, createOauthSession, getOauthSession, updateOauthSession, deleteOauthSession, saveStatsSnapshot, getStatsSnapshot, getGuildFaction, setGuildFaction, verifyGuildStatsPushSecret, setGuildStatsSharingSecret, clearGuildStatsSharingSecret, getGuildStatsSharingStatus, upsertGuildStatsSnapshot, getActiveGuildStatsAggregate, isValidStatsPushValue, rollbackSchemaV7ToV6, _resetEphemeralStateForTests } from "../src/database.js";
import { _resetKeyCacheForTests, _resetKEKCacheForTests, decryptWithDEK } from "../src/secretsCrypto.js";

const VALID_KEY_HEX = "c".repeat(64);

test.beforeEach(() => {
  _resetKeyCacheForTests();
  _resetKEKCacheForTests();
  _resetEphemeralStateForTests();
  delete process.env.ACP_SECRETS_KEY;
  delete process.env.ACP_SECRETS_KEY_FILE;
  delete process.env.ACP_AGE_IDENTITY_FILE;
  delete process.env.ACP_KEK_FILE;
  delete process.env.ACP_KEK_VERSION;
});

function ageAvailable() {
  try {
    execFileSync("age", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function makeRealKEKFixture(dir) {
  const identityPath = join(dir, "age-identity.txt");
  execFileSync("age-keygen", ["-o", identityPath]);
  const identityText = execFileSync("cat", [identityPath], { encoding: "utf8" });
  const publicKeyLine = identityText.split("\n").find((l) => l.startsWith("# public key:"));
  const publicKey = publicKeyLine.replace("# public key:", "").trim();

  const kekHex = randomBytes(32).toString("hex");
  const kekPlainPath = join(dir, "kek-plain.txt");
  const kekPath = join(dir, "kek.age");
  writeFileSync(kekPlainPath, kekHex);
  execFileSync("age", ["-r", publicKey, "-o", kekPath, kekPlainPath]);
  chmodSync(identityPath, 0o400);
  chmodSync(kekPath, 0o600);
  return { identityPath, kekPath };
}

test("upsertGuild/getGuild round-trips adapterToken without an encryption key configured", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "plain-token-value", status: "active" });
  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "plain-token-value");
});

test("adapter_token is not stored as plaintext in the underlying row once a key is configured", () => {
  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "super-secret-adapter-token", status: "active" });

  const rawRow = db.prepare("SELECT adapter_token FROM guilds WHERE guild_id = ?").get("g1");
  assert.equal(rawRow.adapter_token.includes("super-secret-adapter-token"), false);

  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "super-secret-adapter-token");
});

test("upsertGuild UPDATE path re-encrypts a changed adapterToken", () => {
  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "first-token", status: "active" });
  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "second-token", status: "active" });

  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "second-token");

  const rawRow = db.prepare("SELECT adapter_token FROM guilds WHERE guild_id = ?").get("g1");
  assert.equal(rawRow.adapter_token.includes("first-token"), false);
  assert.equal(rawRow.adapter_token.includes("second-token"), false);
});

test("getGuild returns undefined for a guild that does not exist, without throwing", () => {
  const db = createDatabase(":memory:");
  assert.equal(getGuild(db, "does-not-exist"), undefined);
});

// oauth_sessions moved to in-memory-only storage in schema v7 (see the
// "Schema hardening (v7)" comment in database.js) -- it's never written
// to disk at all now, so there's no longer an "encrypted at rest" vs.
// "plaintext" distinction to test; a stolen database file was the whole
// threat model KEK/DEK existed to address, and this data is never in
// that file in the first place.
test("oauth session round-trips through create/update/get", () => {
  createOauthSession({ state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
  updateOauthSession("state1", { accessToken: "live-discord-oauth-token", expiresAt: "2030-01-01T00:00:00.000Z" });

  const session = getOauthSession("state1");
  assert.equal(session.access_token, "live-discord-oauth-token");
  assert.equal(session.expires_at, "2030-01-01T00:00:00.000Z");
  assert.equal(session.discord_user_id, "u1");
  assert.equal(session.guild_id, "g1");
});

test("getOauthSession returns undefined for an unknown state, without throwing", () => {
  assert.equal(getOauthSession("no-such-state"), undefined);
});

// Layer 3 /code-review ultra finding (CONFIRMED, normal severity): GET
// /setup (the only caller of createOauthSession()) is public and
// unauthenticated with no rate limit ahead of it, so before this fix the
// Map had no size cap at all -- only the 30-minute TTL, which sustained
// abuse could outrun (accumulating far more entries than the TTL alone
// would ever reclaim) while retaining unbounded memory in the shared bot
// process.
test("createOauthSession caps total sessions and evicts the oldest first (FIFO), not silently growing forever", () => {
  const first = "session-created-first";
  createOauthSession({ state: first, discordUserId: "u0", discordUsername: "first", guildId: "g0" });

  // Fill well past the cap. 1000 is MAX_OAUTH_SESSIONS in src/database.js
  // -- not exported, so this pins the same number a change to that
  // constant would need to update here too, which is deliberate: a
  // silent widening of the cap should be a visible test change, not an
  // invisible one.
  for (let i = 0; i < 1005; i++) {
    createOauthSession({ state: `filler-${i}`, discordUserId: `u${i}`, discordUsername: `filler${i}`, guildId: "g" });
  }

  assert.equal(getOauthSession(first), undefined, "the oldest session must be evicted once the cap is exceeded, not retained forever");
  assert.ok(getOauthSession("filler-1004"), "the most recently created session must still be present");
  assert.ok(getOauthSession("filler-500"), "a recent-enough session well within the cap must still be present");
});

test("deleteOauthSession removes a session so it can no longer be read back", () => {
  createOauthSession({ state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
  assert.ok(getOauthSession("state1"));
  deleteOauthSession("state1");
  assert.equal(getOauthSession("state1"), undefined);
});

test("a guild written before a key was configured still reads back correctly (legacy plaintext)", () => {
  const db = createDatabase(":memory:");  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "legacy-plaintext-token", status: "active" });

  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  _resetKeyCacheForTests();

  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "legacy-plaintext-token");
});

// Live-stats display cache (KV replacement, issue #83.2; in-memory as of
// schema v7): saveStatsSnapshot must overwrite the single cached value
// and getStatsSnapshot must return it exactly, including after a second
// save (overwrite, not accumulate), and must return null when nothing
// was ever stored.
test("stats snapshot round-trips a payload and overwrites in place", () => {
  assert.equal(getStatsSnapshot(), null, "no snapshot stored yet -> null");

  saveStatsSnapshot({ players_online: 12, version: "1.0.0-rc.2" });
  const first = getStatsSnapshot();
  assert.deepEqual(first, { players_online: 12, version: "1.0.0-rc.2" });

  saveStatsSnapshot({ players_online: 7, version: "1.0.0-rc.2" });
  const second = getStatsSnapshot();
  assert.equal(second.players_online, 7, "second save must overwrite, not accumulate");
});

// ── KEK/DEK per-row hierarchy (schema v4, issues #107/#108/#109) ──

test("schema v4: key_versions, secret_keys, and secret_access_log tables exist on a fresh database", () => {
  const db = createDatabase(":memory:");
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tableNames.includes("key_versions"));
  assert.ok(tableNames.includes("secret_keys"));
  assert.ok(tableNames.includes("secret_access_log"));
  // 7, not 4 -- schema v5 added guild_member_activity (mentat#251, since
  // removed in v7), v6 added stats_push_secret/guild_stats_snapshot
  // (mentat#276), v7 hardened the schema (removed six tables entirely --
  // see database.js's "Schema hardening (v7)" comment). This test's own
  // name still says "v4" since it's specifically about the v4-era
  // KEK/DEK tables, which are unaffected and still present.
  assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 7);
});

test("real age/KEK: upsertGuild/getGuild round-trip using a real KEK produces v2 ciphertext and a secret_keys row", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const db = createDatabase(":memory:");
    upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "real-kek-token", status: "active" });

    const rawRow = db.prepare("SELECT adapter_token FROM guilds WHERE guild_id = ?").get("g1");
    assert.ok(rawRow.adapter_token.startsWith("enc:v2:"), "must use the per-row DEK format once a real KEK is configured");

    const keyRow = db.prepare("SELECT * FROM secret_keys WHERE table_name = ? AND row_key = ? AND column_name = ?").get("guilds", "g1", "adapter_token");
    assert.ok(keyRow, "a wrapped DEK row must be written for this guild's adapter_token");
    assert.equal(keyRow.key_version, 1);

    const guild = getGuild(db, "g1");
    assert.equal(guild.adapter_token, "real-kek-token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: encrypt and decrypt events are recorded in secret_access_log", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const db = createDatabase(":memory:");
    upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "audited-token", status: "active" });
    getGuild(db, "g1");

    const events = db.prepare(
      "SELECT event, key_version FROM secret_access_log WHERE table_name = ? AND row_key = ? ORDER BY id"
    ).all("guilds", "g1");
    assert.deepEqual(events, [
      { event: "encrypt", key_version: 1 },
      { event: "decrypt", key_version: 1 }
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: a decrypt failure is logged as decrypt_failed, not silently swallowed", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const db = createDatabase(":memory:");
    upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "will-be-corrupted", status: "active" });

    // Simulate corruption: wipe the wrapped DEK row so decryptColumn()
    // has no key material to unwrap.
    db.prepare("DELETE FROM secret_keys WHERE table_name = 'guilds' AND row_key = 'g1'").run();

    assert.throws(() => getGuild(db, "g1"));
    const failedEvents = db.prepare(
      "SELECT event FROM secret_access_log WHERE table_name = 'guilds' AND row_key = 'g1' AND event = 'decrypt_failed'"
    ).all();
    assert.equal(failedEvents.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: a v1-encrypted row written before a KEK existed still decrypts correctly once a KEK is added later", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
    const db = createDatabase(":memory:");
    upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "pre-kek-token", status: "active" });

    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;
    _resetKEKCacheForTests();

    const guild = getGuild(db, "g1");
    assert.equal(guild.adapter_token, "pre-kek-token", "a v1 row must remain readable after a KEK is configured, without requiring a migration step");

    // Its next WRITE, however, upgrades it to v2 -- confirming the
    // "existing rows only upgrade on next write" design.
    upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "post-kek-token", status: "active" });
    const rawRow = db.prepare("SELECT adapter_token FROM guilds WHERE guild_id = ?").get("g1");
    assert.ok(rawRow.adapter_token.startsWith("enc:v2:"));
    assert.equal(getGuild(db, "g1").adapter_token, "post-kek-token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// oauth_sessions no longer touches secret_keys/KEK/DEK at all (schema
// v7, in-memory storage) -- this is the direct regression test for that:
// a real KEK configured for other purposes (guilds.adapter_token) must
// not cause an oauth session to leave any trace in secret_keys.
test("real age/KEK: an oauth session leaves no trace in secret_keys, even with a real KEK configured for other secrets", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const db = createDatabase(":memory:");
    createOauthSession({ state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
    updateOauthSession("state1", { accessToken: "real-oauth-token", expiresAt: "2030-01-01T00:00:00.000Z" });

    const session = getOauthSession("state1");
    assert.equal(session.access_token, "real-oauth-token", "still round-trips correctly, just never touches SQLite");

    const keyRow = db.prepare("SELECT * FROM secret_keys WHERE table_name = 'oauth_sessions'").get();
    assert.equal(keyRow, undefined, "no secret_keys row should ever be written for oauth_sessions -- it's not a table anymore");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: two guilds' adapter_token rows use independent DEKs (compromising one wrapped DEK does not expose the other)", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const db = createDatabase(":memory:");
    upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "token-one", status: "active" });
    upsertGuild(db, { guildId: "g2", guildName: "Guild Two", consoleUrl: "https://two.test", adapterToken: "token-two", status: "active" });

    const key1 = db.prepare("SELECT wrapped_dek FROM secret_keys WHERE row_key = 'g1'").get();
    const key2 = db.prepare("SELECT wrapped_dek FROM secret_keys WHERE row_key = 'g2'").get();
    assert.notEqual(key1.wrapped_dek, key2.wrapped_dek);

    // Attempting to decrypt g1's ciphertext with g2's wrapped DEK must
    // fail, not succeed -- proving the DEKs are genuinely independent,
    // not e.g. accidentally reused across rows.
    const g1Raw = db.prepare("SELECT adapter_token FROM guilds WHERE guild_id = 'g1'").get();
    assert.throws(() => decryptWithDEK(g1Raw.adapter_token, key2.wrapped_dek));

    assert.equal(getGuild(db, "g1").adapter_token, "token-one");
    assert.equal(getGuild(db, "g2").adapter_token, "token-two");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Cross-console live-stats push (schema v6, mentat#276) ──────────────

// This is the direct regression test for Layer 1 DBA/Architect/Cloud-
// Security audit finding #11: a schema change that only edits SCHEMA's
// CREATE TABLE IF NOT EXISTS string is a no-op for any operator whose
// guilds table already exists. Unlike every other test in this file
// (which uses createDatabase(":memory:") and therefore only ever
// exercises the fresh-install path), this test manually constructs an
// on-disk database matching the pre-v6 schema, then re-opens it through
// createDatabase() to exercise the actual upgrade path an existing
// operator hits.
test("schema v5 install upgrades straight to v7: gains the guilds columns from v6 and lands on the current version", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-migration-"));
  const dbPath = join(dir, "acp.db");
  try {
    // Simulate a real pre-v6 install: no stats_push_secret /
    // stats_sharing_opted_in_at / stats_sharing_opted_out_at columns,
    // schema_version pinned at 5, and one real guild row already present.
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE guilds (
        guild_id TEXT PRIMARY KEY,
        guild_name TEXT NOT NULL DEFAULT '',
        console_url TEXT NOT NULL DEFAULT '',
        adapter_token TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO schema_version (version) VALUES (5);
      INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token, status)
        VALUES ('existing-guild', 'Existing Guild', 'https://existing.test', 'pre-migration-token', 'active');
    `);
    legacyDb.close();

    // Re-open through the real migration path -- a v5 install jumps
    // straight to v7 in one pass (the v6 ALTER TABLEs and the v7 DROP
    // TABLEs both run off the same originally-captured currentVersion).
    const db = createDatabase(dbPath);

    assert.equal(
      db.prepare("SELECT version FROM schema_version").get().version,
      7,
      "schema_version must land on the current version after migration"
    );

    const columns = db.prepare("PRAGMA table_info(guilds)").all().map((c) => c.name);
    assert.ok(columns.includes("stats_push_secret"), "guilds must gain stats_push_secret on upgrade, not just on fresh install");
    assert.ok(columns.includes("stats_sharing_opted_in_at"));
    assert.ok(columns.includes("stats_sharing_opted_out_at"));

    // The pre-existing row must survive untouched, and the new columns
    // must read as NULL (not '', not throw) for a row that predates them.
    const row = db.prepare("SELECT * FROM guilds WHERE guild_id = ?").get("existing-guild");
    assert.equal(row.guild_name, "Existing Guild", "pre-existing data must not be lost by the migration");
    assert.equal(row.stats_push_secret, null, "a pre-existing row's new column must read as NULL, not ''");
    assert.equal(row.stats_sharing_opted_in_at, null);

    // The route this migration exists to unblock must actually work
    // against the migrated row, not just report the column as present.
    assert.equal(verifyGuildStatsPushSecret(db, "existing-guild", "anything"), false);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// This is the direct regression test for the v7 hardening migration
// itself: a real v6 install (exactly what was running before this
// hardening pass) has all six now-removed tables actually populated with
// real rows -- upgrading to v7 must drop them cleanly and preserve every
// piece of data that's supposed to survive (the guilds row itself,
// including its stats-sharing consent columns).
test("schema v6->v7 hardening migration: drops all six removed tables and preserves the guilds row, including stats-sharing consent state", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-v7-migration-"));
  const dbPath = join(dir, "acp.db");
  try {
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE guilds (
        guild_id TEXT PRIMARY KEY, guild_name TEXT, console_url TEXT, adapter_token TEXT,
        status TEXT DEFAULT 'active', created_at TEXT, updated_at TEXT,
        stats_push_secret TEXT, stats_sharing_opted_in_at TEXT, stats_sharing_opted_out_at TEXT
      );
      CREATE TABLE player_links (id INTEGER PRIMARY KEY, guild_id TEXT, discord_user_id TEXT);
      CREATE TABLE guild_member_activity (guild_id TEXT, discord_user_id TEXT, last_seen_at TEXT);
      CREATE TABLE oauth_sessions (state TEXT PRIMARY KEY, access_token TEXT);
      CREATE TABLE bot_stats (key TEXT PRIMARY KEY, value INTEGER);
      CREATE TABLE stats_snapshot (id INTEGER PRIMARY KEY, payload TEXT);
      CREATE TABLE guild_stats_snapshot (guild_id TEXT PRIMARY KEY, players_online INTEGER, spice_fields INTEGER, sietches INTEGER, updated_at TEXT);
      INSERT INTO schema_version (version) VALUES (6);
      INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token, stats_push_secret, stats_sharing_opted_in_at)
        VALUES ('existing-guild', 'Existing Guild', 'https://existing.test', 'a-real-token', 'a-real-secret', '2026-09-01 00:00:00');
      INSERT INTO player_links (guild_id, discord_user_id) VALUES ('existing-guild', 'u1');
      INSERT INTO guild_member_activity (guild_id, discord_user_id, last_seen_at) VALUES ('existing-guild', 'u1', datetime('now'));
      INSERT INTO oauth_sessions (state, access_token) VALUES ('abc', 'token');
      INSERT INTO bot_stats (key, value) VALUES ('commands_total', 42);
      INSERT INTO stats_snapshot (id, payload) VALUES (1, '{}');
      INSERT INTO guild_stats_snapshot (guild_id, players_online, spice_fields, sietches) VALUES ('existing-guild', 5, 2, 1);
    `);
    legacyDb.close();

    const db = createDatabase(dbPath);

    assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 7);

    const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
    for (const removed of ["player_links", "guild_member_activity", "oauth_sessions", "bot_stats", "stats_snapshot", "guild_stats_snapshot"]) {
      assert.equal(tableNames.includes(removed), false, `${removed} must be dropped by the v6->v7 migration`);
    }

    const row = db.prepare("SELECT * FROM guilds WHERE guild_id = ?").get("existing-guild");
    assert.equal(row.guild_name, "Existing Guild", "the guilds row itself must survive the migration untouched");
    assert.equal(row.stats_push_secret, "a-real-secret", "existing stats-sharing consent state must survive -- it's still a real column, not a dropped table");
    assert.ok(row.stats_sharing_opted_in_at);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Requirement 26: every migration needs a documented rollback path and a
// test that verifies it works against the previous version's schema. This
// exercises rollbackSchemaV7ToV6() against a real, freshly-migrated v7
// database (not a hand-built fixture) -- start on v6, migrate forward via
// the real createDatabase() path, then roll back and confirm a v6-era
// query shape works again on every one of the six recreated tables.
test("schema v7->v6 rollback: recreates all six tables with the pre-v7 shape and old-code queries succeed again", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-v7-rollback-"));
  const dbPath = join(dir, "acp.db");
  try {
    const legacyDb = new Database(dbPath);
    legacyDb.exec(`
      CREATE TABLE schema_version (version INTEGER PRIMARY KEY);
      CREATE TABLE guilds (
        guild_id TEXT PRIMARY KEY, guild_name TEXT, console_url TEXT, adapter_token TEXT,
        status TEXT DEFAULT 'active', created_at TEXT, updated_at TEXT,
        stats_push_secret TEXT, stats_sharing_opted_in_at TEXT, stats_sharing_opted_out_at TEXT
      );
      INSERT INTO schema_version (version) VALUES (6);
      INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token) VALUES ('g1', 'G1', 'https://g1.test', 'tok');
    `);
    legacyDb.close();

    // Forward migration (the real path, not a hand-built v7 fixture) --
    // this is the exact database a v7 upgrade produces.
    const migrated = createDatabase(dbPath);
    assert.equal(migrated.prepare("SELECT version FROM schema_version").get().version, 7);
    migrated.close();

    // Now roll it back, as an operator downgrading to pre-v7 code would.
    const db = new Database(dbPath);
    rollbackSchemaV7ToV6(db);

    assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 6, "schema_version must be reset to 6");

    // Exercise the exact query shapes pre-v7 code actually used against
    // each recreated table (see database.js pre-5516a6b for the source of
    // these statements) -- a shape mismatch would throw here, not just
    // fail a table-existence check.
    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO oauth_sessions (state, discord_user_id, discord_username, guild_id) VALUES (?, ?, ?, ?)").run("state1", "u1", "user1", "g1");
      db.prepare("SELECT * FROM oauth_sessions WHERE state = ?").get("state1");
    }, "oauth_sessions must accept the old code's real INSERT/SELECT shape");

    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO player_links (guild_id, discord_user_id, character_name) VALUES (?, ?, ?) ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET character_name = excluded.character_name").run("g1", "u1", "Char One");
      db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND discord_user_id = ?").get("g1", "u1");
    }, "player_links must accept the old code's real UPSERT shape");

    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO guild_member_activity (guild_id, discord_user_id) VALUES (?, ?) ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET last_seen_at = datetime('now')").run("g1", "u1");
    }, "guild_member_activity must accept the old code's real UPSERT shape");

    assert.doesNotThrow(() => {
      db.prepare("INSERT OR IGNORE INTO bot_stats (key, value) VALUES ('commands_total', 0)").run();
      db.prepare("UPDATE bot_stats SET value = value + 1 WHERE key = 'commands_total'").run();
      assert.equal(db.prepare("SELECT value FROM bot_stats WHERE key = 'commands_total'").get().value, 1);
    }, "bot_stats must accept the old code's real increment shape");

    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO stats_snapshot (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload").run("{}");
      db.prepare("SELECT payload FROM stats_snapshot WHERE id = 1").get();
    }, "stats_snapshot must accept the old code's real UPSERT shape");

    assert.doesNotThrow(() => {
      db.prepare("INSERT INTO guild_stats_snapshot (guild_id, players_online, spice_fields, sietches) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET players_online = excluded.players_online").run("g1", 5, 2, 1);
    }, "guild_stats_snapshot must accept the old code's real UPSERT shape");

    // Rollback must never touch the guilds row itself -- it was never one
    // of the dropped tables.
    const guildRow = db.prepare("SELECT * FROM guilds WHERE guild_id = ?").get("g1");
    assert.equal(guildRow.guild_name, "G1", "rollback must not touch the guilds table");

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("guild_stats_snapshot is not a real table on a fresh database -- it's in-memory only as of schema v7", () => {
  const db = createDatabase(":memory:");
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.equal(tableNames.includes("guild_stats_snapshot"), false);
  assert.equal(tableNames.includes("oauth_sessions"), false);
  assert.equal(tableNames.includes("player_links"), false);
  assert.equal(tableNames.includes("bot_stats"), false);
  assert.equal(tableNames.includes("stats_snapshot"), false);
  assert.equal(tableNames.includes("guild_member_activity"), false);
});

test("setGuildStatsSharingSecret records the opt-in and stores the secret encrypted at rest", () => {
  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });

  setGuildStatsSharingSecret(db, "g1", "the-real-secret");

  const raw = db.prepare("SELECT stats_push_secret FROM guilds WHERE guild_id = ?").get("g1");
  assert.notEqual(raw.stats_push_secret, "the-real-secret", "must not be stored in plaintext");

  const status = getGuildStatsSharingStatus(db, "g1");
  assert.equal(status.enabled, true);
  assert.ok(status.optedInAt, "opted_in_at must be set");
  assert.equal(status.optedOutAt, null);
});

test("getGuildStatsSharingStatus reports disabled for a guild that never opted in, and for an unknown guild", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  assert.deepEqual(getGuildStatsSharingStatus(db, "g1"), { enabled: false, optedInAt: null, optedOutAt: null });
  assert.deepEqual(getGuildStatsSharingStatus(db, "no-such-guild"), { enabled: false, optedInAt: null, optedOutAt: null });
});

test("clearGuildStatsSharingSecret revokes: clears the secret, records opted_out_at, and actually deletes the in-memory snapshot rather than leaving it to go stale", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  setGuildStatsSharingSecret(db, "g1", "secret-1");
  upsertGuildStatsSnapshot("g1", { playersOnline: 5, spiceFields: 2, sietches: 1 });
  assert.equal(getActiveGuildStatsAggregate(db).contributing_guilds, 1);

  clearGuildStatsSharingSecret(db, "g1");

  const status = getGuildStatsSharingStatus(db, "g1");
  assert.equal(status.enabled, false);
  assert.ok(status.optedOutAt, "opted_out_at must be set on revoke");
  assert.equal(
    getActiveGuildStatsAggregate(db).contributing_guilds,
    0,
    "revoking must actively delete the in-memory snapshot, not just wait for it to age out"
  );
});

test("verifyGuildStatsPushSecret: correct secret matches", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  setGuildStatsSharingSecret(db, "g1", "correct-secret");
  assert.equal(verifyGuildStatsPushSecret(db, "g1", "correct-secret"), true);
});

// These three cases are the direct regression test for Layer 1 Security
// Architect/QA audit findings #1/#2: an unknown guild_id, a guild that
// exists but never opted in, and a wrong secret for a guild that DID opt
// in must all be indistinguishable to a caller -- every one of them
// returns the exact same `false`, never throws, and (per the function's
// own implementation) pays an equivalent decrypt-and-compare cost rather
// than short-circuiting.
test("verifyGuildStatsPushSecret: unknown guild_id, never-opted-in guild, and wrong secret are all indistinguishably false", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  upsertGuild(db, { guildId: "g2", guildName: "Guild Two", consoleUrl: "https://two.test", adapterToken: "t2", status: "active" });
  setGuildStatsSharingSecret(db, "g2", "g2s-real-secret");

  assert.equal(verifyGuildStatsPushSecret(db, "no-such-guild", "anything"), false, "unknown guild_id");
  assert.equal(verifyGuildStatsPushSecret(db, "g1", "anything"), false, "known guild, never opted in");
  assert.equal(verifyGuildStatsPushSecret(db, "g2", "wrong-secret"), false, "known guild, wrong secret");
  assert.equal(verifyGuildStatsPushSecret(db, "g2", ""), false, "empty provided secret");
});

// Direct regression test for the Layer 2 /code-review high finding
// (mentat#276): the opted-in branch used to pay 2 extra real DB
// round-trips (a secret_keys SELECT + a secret_access_log INSERT) that
// the "no secret to check" branch skipped entirely -- a timing
// side-channel letting an attacker distinguish "this guild opted in"
// from "it didn't" by response latency, even though the comparison
// itself was already constant-time. This test proves the DB write cost
// is now identical either way by counting real rows appended to
// secret_access_log, not just checking the boolean return value.
test("verifyGuildStatsPushSecret writes the same number of secret_access_log rows whether or not the guild has a real secret", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "opted-in", guildName: "Opted In", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  setGuildStatsSharingSecret(db, "opted-in", "real-secret");
  upsertGuild(db, { guildId: "never-opted-in", guildName: "Never Opted In", consoleUrl: "https://two.test", adapterToken: "t2", status: "active" });

  const countLogRows = () => db.prepare("SELECT COUNT(*) AS n FROM secret_access_log").get().n;

  const before1 = countLogRows();
  verifyGuildStatsPushSecret(db, "opted-in", "wrong-guess");
  const after1 = countLogRows();
  assert.equal(after1 - before1, 1, "checking an opted-in guild with a wrong secret must append exactly one secret_access_log row");

  const before2 = countLogRows();
  verifyGuildStatsPushSecret(db, "no-such-guild", "anything");
  const after2 = countLogRows();
  assert.equal(after2 - before2, 1, "checking a completely unknown guild_id must append exactly one secret_access_log row too -- the same DB cost as a real opted-in guild, not zero");

  const before3 = countLogRows();
  verifyGuildStatsPushSecret(db, "never-opted-in", "anything");
  const after3 = countLogRows();
  assert.equal(after3 - before3, 1, "a known guild that never opted in must also append exactly one row -- not distinguishable from the other two cases by DB write count");
});

// Layer 3 /code-review ultra finding (CONFIRMED, normal): the row-count
// test above proves both branches hit the DB the same number of times,
// but in a real KEK-configured deployment that was not sufficient -- the
// never-opted-in/unknown-guild path used to throw immediately inside
// decryptWithDEK() ("no wrapped DEK was provided") with ZERO AES-GCM
// operations, while the opted-in path paid a real unwrapDEK() + decrypt
// (2 operations), a crypto-cost timing gap the DB-round-trip fix alone
// didn't close. This test only makes sense in real KEK mode (v1
// single-key mode never calls unwrapDEK() at all, so the gap doesn't
// exist there) -- see the row-count test above for the mode-independent
// coverage.
test("real age/KEK: verifyGuildStatsPushSecret's never-opted-in path decrypts successfully instead of failing with 'no wrapped DEK'", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const db = createDatabase(":memory:");
    upsertGuild(db, { guildId: "opted-in", guildName: "Opted In", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
    setGuildStatsSharingSecret(db, "opted-in", "real-secret");
    upsertGuild(db, { guildId: "never-opted-in", guildName: "Never Opted In", consoleUrl: "https://two.test", adapterToken: "t2", status: "active" });

    verifyGuildStatsPushSecret(db, "opted-in", "wrong-guess");
    verifyGuildStatsPushSecret(db, "no-such-guild", "anything");
    verifyGuildStatsPushSecret(db, "never-opted-in", "anything");

    // Before the fix, every decoy-path call above logged decrypt_failed
    // (0 crypto ops) instead of decrypt (2 crypto ops, same as the
    // opted-in call) -- assert none of them failed.
    const failedEvents = db.prepare(
      "SELECT COUNT(*) AS n FROM secret_access_log WHERE event = 'decrypt_failed'"
    ).get().n;
    assert.equal(failedEvents, 0, "the decoy path must decrypt successfully via a real, persisted wrappedDEK -- not fail with 'no wrapped DEK'");

    // The decoy's own wrappedDEK must actually be persisted, under the
    // fixed sentinel row key, not the caller-supplied guild_id -- this is
    // what lets getWrappedDEK() find it on every subsequent call.
    const decoyKeyRow = db.prepare(
      "SELECT wrapped_dek FROM secret_keys WHERE table_name = 'guilds' AND row_key = '__stats_push_decoy__' AND column_name = 'stats_push_secret'"
    ).get();
    assert.ok(decoyKeyRow && decoyKeyRow.wrapped_dek, "the decoy's wrappedDEK must be persisted under a fixed, non-guild row key");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isValidStatsPushValue: accepts finite non-negative numbers within a sane ceiling, rejects everything else", () => {
  assert.equal(isValidStatsPushValue(0), true);
  assert.equal(isValidStatsPushValue(42), true);
  assert.equal(isValidStatsPushValue(10000), true);
  assert.equal(isValidStatsPushValue(10001), false, "must reject absurdly large values (Layer 1 Security Architect finding #4)");
  assert.equal(isValidStatsPushValue(-1), false, "must reject negative values");
  assert.equal(isValidStatsPushValue(Number.POSITIVE_INFINITY), false);
  assert.equal(isValidStatsPushValue(Number.NaN), false);
  assert.equal(isValidStatsPushValue("5"), false, "must reject a numeric-looking string, not coerce it");
  assert.equal(isValidStatsPushValue(undefined), false);
  assert.equal(isValidStatsPushValue(null), false);
});

test("upsertGuildStatsSnapshot writes a valid payload and rejects an invalid one without touching the previous value", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });

  assert.equal(upsertGuildStatsSnapshot("g1", { playersOnline: 10, spiceFields: 3, sietches: 2 }), true);
  assert.equal(getActiveGuildStatsAggregate(db).players_online, 10);

  // A negative field must be rejected outright -- the previous snapshot
  // value must be left in place, not overwritten with garbage (Layer 1
  // Security Architect finding #4).
  assert.equal(upsertGuildStatsSnapshot("g1", { playersOnline: -5, spiceFields: 3, sietches: 2 }), false);
  assert.equal(getActiveGuildStatsAggregate(db).players_online, 10, "previous value must survive a rejected update");

  assert.equal(upsertGuildStatsSnapshot("g1", { playersOnline: 11, spiceFields: 3, sietches: "not-a-number" }), false);
  assert.equal(getActiveGuildStatsAggregate(db).players_online, 10, "a single invalid field must reject the entire payload, not partially apply it");
});

test("upsertGuildStatsSnapshot is idempotent per guild (last-write-wins, not a growing history)", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  upsertGuildStatsSnapshot("g1", { playersOnline: 1, spiceFields: 1, sietches: 1 });
  upsertGuildStatsSnapshot("g1", { playersOnline: 2, spiceFields: 2, sietches: 2 });
  const aggregate = getActiveGuildStatsAggregate(db);
  assert.equal(aggregate.contributing_guilds, 1, "one guild pushing twice must not be double-counted");
  assert.equal(aggregate.players_online, 2, "the second push must overwrite, not add to, the first");
});

// This is the direct regression test for Layer 1 Architect audit finding
// #6: a guild the bot was removed from (status 'suspended') must not
// keep contributing to the public aggregate just because its own Core
// console has no way to know it was removed and keeps pushing anyway.
test("getActiveGuildStatsAggregate: sums only guilds that are both status='active' and have a fresh snapshot", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "active-with-data", guildName: "A", consoleUrl: "https://a.test", adapterToken: "t", status: "active" });
  upsertGuild(db, { guildId: "suspended-with-data", guildName: "B", consoleUrl: "https://b.test", adapterToken: "t", status: "suspended" });
  upsertGuild(db, { guildId: "active-no-data", guildName: "C", consoleUrl: "https://c.test", adapterToken: "t", status: "active" });
  upsertGuild(db, { guildId: "active-stale-data", guildName: "D", consoleUrl: "https://d.test", adapterToken: "t", status: "active" });

  upsertGuildStatsSnapshot("active-with-data", { playersOnline: 10, spiceFields: 2, sietches: 1 });
  upsertGuildStatsSnapshot("suspended-with-data", { playersOnline: 999, spiceFields: 999, sietches: 999 });
  // Backdate this one 21 minutes, past the 20-minute staleness window --
  // simulates a guild whose push has stopped.
  upsertGuildStatsSnapshot("active-stale-data", { playersOnline: 500, spiceFields: 500, sietches: 500 }, { nowMs: Date.now() - 21 * 60 * 1000 });

  const aggregate = getActiveGuildStatsAggregate(db);
  assert.equal(aggregate.contributing_guilds, 1, "only the one active guild with a fresh snapshot should count");
  assert.equal(aggregate.players_online, 10);
  assert.equal(aggregate.spice_fields, 2);
  assert.equal(aggregate.sietches, 1);
});

// Layer 1 QA audit finding #29: a functional accept/reject test alone
// can't detect a future refactor that silently swaps the constant-time
// comparison for a naive ===. This source-level check is the guard for
// that specific regression class.
test("verifyGuildStatsPushSecret's implementation goes through a timingSafeEqual-based comparison, not inline ===", async () => {
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../src/database.js", import.meta.url), "utf8");
  const start = src.indexOf("export function verifyGuildStatsPushSecret");
  assert.ok(start !== -1, "verifyGuildStatsPushSecret must exist");
  const end = src.indexOf("\nexport function", start + 1);
  const body = src.slice(start, end === -1 ? src.length : end);
  assert.ok(
    body.includes("constantTimeStringsEqual"),
    "the auth comparison must go through the shared timingSafeEqual-based helper, not an inline === swapped in by a future refactor"
  );
});

test("getActiveGuildStatsAggregate reports zero contributing_guilds (not a crash) when nobody has opted in", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  const aggregate = getActiveGuildStatsAggregate(db);
  assert.equal(aggregate.contributing_guilds, 0);
  assert.equal(aggregate.players_online, 0);
});
