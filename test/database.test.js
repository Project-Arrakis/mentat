import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { createDatabase, getGuild, upsertGuild, createOauthSession, getOauthSession, updateOauthSession, saveStatsSnapshot, getStatsSnapshot } from "../src/database.js";
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
  assert.equal(db.prepare("SELECT version FROM schema_version").get().version, 4);
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
