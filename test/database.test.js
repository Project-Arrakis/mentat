import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { createDatabase, getGuild, upsertGuild, createOauthSession, getOauthSession, updateOauthSession, saveStatsSnapshot, getStatsSnapshot, recordGuildMemberActivity, getGuildMemberActivityIds, getGuildFaction, setGuildFaction, verifyGuildStatsPushSecret, setGuildStatsSharingSecret, clearGuildStatsSharingSecret, getGuildStatsSharingStatus, upsertGuildStatsSnapshot, getActiveGuildStatsAggregate, isValidStatsPushValue } from "../src/database.js";
import { _resetKeyCacheForTests, _resetKEKCacheForTests, decryptWithDEK } from "../src/secretsCrypto.js";

const VALID_KEY_HEX = "c".repeat(64);

test.beforeEach(() => {
  _resetKeyCacheForTests();
  _resetKEKCacheForTests();
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

test("oauth session access_token is encrypted at rest once a key is configured", () => {
  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  const db = createDatabase(":memory:");
  createOauthSession(db, { state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
  updateOauthSession(db, "state1", { accessToken: "live-discord-oauth-token", expiresAt: "2030-01-01T00:00:00.000Z" });

  const rawRow = db.prepare("SELECT access_token FROM oauth_sessions WHERE state = ?").get("state1");
  assert.equal(rawRow.access_token.includes("live-discord-oauth-token"), false);

  const session = getOauthSession(db, "state1");
  assert.equal(session.access_token, "live-discord-oauth-token");
  assert.equal(session.expires_at, "2030-01-01T00:00:00.000Z");
});

test("oauth session round-trips without an encryption key configured", () => {
  const db = createDatabase(":memory:");
  createOauthSession(db, { state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
  updateOauthSession(db, "state1", { accessToken: "plain-oauth-token", expiresAt: "2030-01-01T00:00:00.000Z" });

  const session = getOauthSession(db, "state1");
  assert.equal(session.access_token, "plain-oauth-token");
});

test("a guild written before a key was configured still reads back correctly (legacy plaintext)", () => {
  const db = createDatabase(":memory:");  upsertGuild(db, { guildId: "g1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "legacy-plaintext-token", status: "active" });

  process.env.ACP_SECRETS_KEY = VALID_KEY_HEX;
  _resetKeyCacheForTests();

  const guild = getGuild(db, "g1");
  assert.equal(guild.adapter_token, "legacy-plaintext-token");
});

// Stats snapshot table (KV replacement, issue #83.2): saveStatsSnapshot
// must upsert the single pinned row and getStatsSnapshot must return the
// exact parsed payload, including after a second save (overwrite, not
// append), and must return null when nothing was ever stored.
test("stats snapshot round-trips a payload and overwrites in place", () => {
  const db = createDatabase(":memory:");

  assert.equal(getStatsSnapshot(db), null, "no snapshot stored yet -> null");

  saveStatsSnapshot(db, { players_online: 12, version: "1.0.0-rc.2" });
  const first = getStatsSnapshot(db);
  assert.deepEqual(first, { players_online: 12, version: "1.0.0-rc.2" });

  saveStatsSnapshot(db, { players_online: 7, version: "1.0.0-rc.2" });
  const second = getStatsSnapshot(db);
  assert.equal(second.players_online, 7, "second save must overwrite, not append a row");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stats_snapshot").get().n, 1, "exactly one row must exist (id pinned to 1)");
});

// ── KEK/DEK per-row hierarchy (schema v4, issues #107/#108/#109) ──

test("schema v4: key_versions, secret_keys, and secret_access_log tables exist on a fresh database", () => {
  const db = createDatabase(":memory:");
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tableNames.includes("key_versions"));
  assert.ok(tableNames.includes("secret_keys"));
  assert.ok(tableNames.includes("secret_access_log"));
  // 6, not 4 -- schema v5 added guild_member_activity (mentat#251), v6
  // added stats_push_secret/guild_stats_snapshot (mentat#276); this
  // test's own name still says "v4" since it's specifically about the
  // v4-era KEK/DEK tables, which are unaffected and still present.
  assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 6);
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

test("real age/KEK: oauth session access_token also uses the per-row DEK path when a KEK is configured", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-kek-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const db = createDatabase(":memory:");
    createOauthSession(db, { state: "state1", discordUserId: "u1", discordUsername: "tester", guildId: "g1" });
    updateOauthSession(db, "state1", { accessToken: "real-kek-oauth-token", expiresAt: "2030-01-01T00:00:00.000Z" });

    const rawRow = db.prepare("SELECT access_token FROM oauth_sessions WHERE state = ?").get("state1");
    assert.ok(rawRow.access_token.startsWith("enc:v2:"));

    const keyRow = db.prepare("SELECT * FROM secret_keys WHERE table_name = 'oauth_sessions' AND row_key = 'state1' AND column_name = 'access_token'").get();
    assert.ok(keyRow);

    const session = getOauthSession(db, "state1");
    assert.equal(session.access_token, "real-kek-oauth-token");
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

// guild_member_activity (schema v5, mentat#251) -- real in-memory SQLite,
// not a hand-mocked query interceptor, since better-sqlite3 supports
// ":memory:" directly and this table's FK/upsert behavior is worth
// exercising for real.
test("recordGuildMemberActivity upserts, and getGuildMemberActivityIds returns the recorded ids for that guild only", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  upsertGuild(db, { guildId: "g2", guildName: "Guild Two", consoleUrl: "https://two.test", adapterToken: "t2", status: "active" });

  recordGuildMemberActivity(db, "g1", "user-1");
  recordGuildMemberActivity(db, "g1", "user-2");
  recordGuildMemberActivity(db, "g2", "user-3");

  assert.deepEqual(getGuildMemberActivityIds(db, "g1").sort(), ["user-1", "user-2"]);
  assert.deepEqual(getGuildMemberActivityIds(db, "g2"), ["user-3"]);
});

test("recordGuildMemberActivity is a real upsert -- calling it again for the same (guild, user) does not create a duplicate row", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });

  recordGuildMemberActivity(db, "g1", "user-1");
  recordGuildMemberActivity(db, "g1", "user-1");
  recordGuildMemberActivity(db, "g1", "user-1");

  const count = db.prepare("SELECT COUNT(*) AS c FROM guild_member_activity WHERE guild_id = ? AND discord_user_id = ?").get("g1", "user-1");
  assert.equal(count.c, 1);
});

test("recordGuildMemberActivity is a silent no-op for a guild that was never registered (FK violation swallowed, never throws)", () => {
  const db = createDatabase(":memory:");
  assert.doesNotThrow(() => recordGuildMemberActivity(db, "never-registered-guild", "user-1"));
  assert.deepEqual(getGuildMemberActivityIds(db, "never-registered-guild"), []);
});

test("recordGuildMemberActivity silently no-ops on a missing guildId or discordUserId, rather than recording a garbage row", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  recordGuildMemberActivity(db, "", "user-1");
  recordGuildMemberActivity(db, "g1", "");
  assert.deepEqual(getGuildMemberActivityIds(db, "g1"), []);
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
test("schema v5->v6 migration: an existing operator's pre-existing guilds row survives, and gains the new nullable columns, on upgrade", () => {
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

    // Re-open through the real migration path.
    const db = createDatabase(dbPath);

    assert.equal(
      db.prepare("SELECT version FROM schema_version").get().version,
      6,
      "schema_version must be bumped to 6 after migration"
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

test("guild_stats_snapshot table exists on a fresh database (schema v6)", () => {
  const db = createDatabase(":memory:");
  const tableNames = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
  assert.ok(tableNames.includes("guild_stats_snapshot"));
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

test("clearGuildStatsSharingSecret revokes: clears the secret, records opted_out_at, and actually deletes the snapshot row rather than leaving it to go stale", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  setGuildStatsSharingSecret(db, "g1", "secret-1");
  upsertGuildStatsSnapshot(db, "g1", { playersOnline: 5, spiceFields: 2, sietches: 1 });
  assert.ok(db.prepare("SELECT 1 FROM guild_stats_snapshot WHERE guild_id = ?").get("g1"));

  clearGuildStatsSharingSecret(db, "g1");

  const status = getGuildStatsSharingStatus(db, "g1");
  assert.equal(status.enabled, false);
  assert.ok(status.optedOutAt, "opted_out_at must be set on revoke");
  assert.equal(
    db.prepare("SELECT 1 FROM guild_stats_snapshot WHERE guild_id = ?").get("g1"),
    undefined,
    "revoking must actively delete the snapshot row, not just wait for it to age out"
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

  assert.equal(upsertGuildStatsSnapshot(db, "g1", { playersOnline: 10, spiceFields: 3, sietches: 2 }), true);
  let row = db.prepare("SELECT * FROM guild_stats_snapshot WHERE guild_id = ?").get("g1");
  assert.equal(row.players_online, 10);

  // A negative field must be rejected outright -- the previous snapshot
  // value must be left in place, not overwritten with garbage (Layer 1
  // Security Architect finding #4).
  assert.equal(upsertGuildStatsSnapshot(db, "g1", { playersOnline: -5, spiceFields: 3, sietches: 2 }), false);
  row = db.prepare("SELECT * FROM guild_stats_snapshot WHERE guild_id = ?").get("g1");
  assert.equal(row.players_online, 10, "previous value must survive a rejected update");

  assert.equal(upsertGuildStatsSnapshot(db, "g1", { playersOnline: 11, spiceFields: 3, sietches: "not-a-number" }), false);
  row = db.prepare("SELECT * FROM guild_stats_snapshot WHERE guild_id = ?").get("g1");
  assert.equal(row.players_online, 10, "a single invalid field must reject the entire payload, not partially apply it");
});

test("upsertGuildStatsSnapshot is idempotent per guild (last-write-wins, not a growing history)", () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "t1", status: "active" });
  upsertGuildStatsSnapshot(db, "g1", { playersOnline: 1, spiceFields: 1, sietches: 1 });
  upsertGuildStatsSnapshot(db, "g1", { playersOnline: 2, spiceFields: 2, sietches: 2 });
  const count = db.prepare("SELECT COUNT(*) AS n FROM guild_stats_snapshot WHERE guild_id = ?").get("g1");
  assert.equal(count.n, 1);
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

  upsertGuildStatsSnapshot(db, "active-with-data", { playersOnline: 10, spiceFields: 2, sietches: 1 });
  upsertGuildStatsSnapshot(db, "suspended-with-data", { playersOnline: 999, spiceFields: 999, sietches: 999 });
  upsertGuildStatsSnapshot(db, "active-stale-data", { playersOnline: 500, spiceFields: 500, sietches: 500 });
  // Force this row to look 21 minutes old, past the 20-minute staleness
  // window -- simulates a guild whose push has stopped.
  db.prepare("UPDATE guild_stats_snapshot SET updated_at = datetime('now', '-21 minutes') WHERE guild_id = ?").run("active-stale-data");

  const aggregate = getActiveGuildStatsAggregate(db);
  assert.equal(aggregate.contributing_guilds, 1, "only the one active guild with a fresh row should count");
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
