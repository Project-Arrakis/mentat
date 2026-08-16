import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs, rotateKeys } from "../scripts/rotate-keys.js";
import { generateAgeIdentity, generateAndWrapKEK } from "../scripts/setup-keys.js";
import { createDatabase, upsertGuild, getGuild } from "../src/database.js";
import { _resetKEKCacheForTests } from "../src/secretsCrypto.js";

function ageAvailable() {
  try {
    execFileSync("age", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test.beforeEach(() => {
  _resetKEKCacheForTests();
  delete process.env.ACP_AGE_IDENTITY_FILE;
  delete process.env.ACP_KEK_FILE;
  delete process.env.ACP_KEK_VERSION;
});

test("parseArgs applies documented defaults for every flag except the required --dir", () => {
  const args = parseArgs(["--dir", "/tmp/some-dir"]);
  assert.equal(args.db, "data/acp.db");
  assert.equal(args.dryRun, false);
  assert.equal(args.dir, "/tmp/some-dir");
});

test("parseArgs requires --dir", () => {
  const originalExit = process.exit;
  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error("process.exit called"); };
  try {
    assert.throws(() => parseArgs(["--db", "x.db"]));
    assert.equal(exitCode, 2);
  } finally {
    process.exit = originalExit;
  }
});

test("rotateKeys throws a clear error when the database file does not exist", () => {
  assert.throws(() => rotateKeys({ db: "/nonexistent/path/acp.db", dir: "/tmp" }), /Database not found/);
});

test("real age/KEK: rotateKeys reports nothing-to-rotate when secret_keys is empty", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-rotate-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    generateAndWrapKEK(dir, publicKey);
    const dbPath = join(dir, "acp.db");
    const db = createDatabase(dbPath);
    db.close();

    const result = rotateKeys({ db: dbPath, dir, dryRun: false });
    assert.equal(result.status, "nothing-to-rotate");
    assert.equal(result.rotated, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: rotateKeys --dry-run reports what would happen without writing anything", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-rotate-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    generateAndWrapKEK(dir, publicKey);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = join(dir, "kek.age");

    const dbPath = join(dir, "acp.db");
    const db = createDatabase(dbPath);
    upsertGuild(db, { guildId: "g1", guildName: "Test", consoleUrl: "https://x", adapterToken: "dry-run-token" });
    db.close();

    const result = rotateKeys({ db: dbPath, dir, dryRun: true });
    assert.equal(result.status, "dry-run");
    assert.equal(result.rowCount, 1);
    assert.equal(result.fromVersion, 1);
    assert.equal(result.toVersion, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: rotateKeys re-wraps DEKs under a real new KEK and the data remains readable", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-rotate-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    generateAndWrapKEK(dir, publicKey);
    const kekPath = join(dir, "kek.age");
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = kekPath;

    const dbPath = join(dir, "acp.db");
    const db = createDatabase(dbPath);
    upsertGuild(db, { guildId: "g1", guildName: "Test", consoleUrl: "https://x", adapterToken: "rotate-me-token" });
    const beforeKey = db.prepare("SELECT wrapped_dek, key_version FROM secret_keys WHERE row_key = 'g1'").get();
    db.close();

    const result = rotateKeys({ db: dbPath, dir, dryRun: false });
    assert.equal(result.status, "rotated");
    assert.equal(result.rotated, 1);
    assert.equal(result.failed, 0);
    assert.equal(result.fromVersion, 1);
    assert.equal(result.toVersion, 2);

    // Activate the new KEK exactly as an operator would, then confirm
    // the row is readable AND was genuinely re-wrapped (different
    // wrapped_dek than before), not left unchanged.
    _resetKEKCacheForTests();
    process.env.ACP_KEK_FILE = result.newKekPath;
    process.env.ACP_KEK_VERSION = "2";

    const db2 = createDatabase(dbPath);
    const afterKey = db2.prepare("SELECT wrapped_dek, key_version FROM secret_keys WHERE row_key = 'g1'").get();
    assert.notEqual(afterKey.wrapped_dek, beforeKey.wrapped_dek);
    assert.equal(afterKey.key_version, 2);

    const guild = getGuild(db2, "g1");
    assert.equal(guild.adapter_token, "rotate-me-token", "data must remain readable after rotation, under the new KEK");

    const versions = db2.prepare("SELECT version, retired_at FROM key_versions ORDER BY version").all();
    assert.equal(versions.length, 2);
    assert.notEqual(versions[0].retired_at, null, "the old key version must be marked retired, not deleted");
    assert.equal(versions[1].retired_at, null, "the new key version must not be retired");

    const rotateLog = db2.prepare("SELECT event, key_version FROM secret_access_log WHERE event = 'rotate'").all();
    assert.deepEqual(rotateLog, [{ event: "rotate", key_version: 2 }]);

    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: rotateKeys handles multiple rows across two tables in one run", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-rotate-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    generateAndWrapKEK(dir, publicKey);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = join(dir, "kek.age");

    const dbPath = join(dir, "acp.db");
    const db = createDatabase(dbPath);
    upsertGuild(db, { guildId: "g1", guildName: "Guild One", consoleUrl: "https://one.test", adapterToken: "token-one" });
    upsertGuild(db, { guildId: "g2", guildName: "Guild Two", consoleUrl: "https://two.test", adapterToken: "token-two" });
    db.close();

    const result = rotateKeys({ db: dbPath, dir, dryRun: false });
    assert.equal(result.rotated, 2);
    assert.equal(result.failed, 0);

    _resetKEKCacheForTests();
    process.env.ACP_KEK_FILE = result.newKekPath;
    process.env.ACP_KEK_VERSION = "2";
    const db2 = createDatabase(dbPath);
    assert.equal(getGuild(db2, "g1").adapter_token, "token-one");
    assert.equal(getGuild(db2, "g2").adapter_token, "token-two");
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: rotateKeys refuses to overwrite an already-existing target new-KEK file", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-rotate-keys-"));
  try {
    const { identityPath, publicKey } = generateAgeIdentity(dir);
    generateAndWrapKEK(dir, publicKey);
    process.env.ACP_AGE_IDENTITY_FILE = identityPath;
    process.env.ACP_KEK_FILE = join(dir, "kek.age");

    const dbPath = join(dir, "acp.db");
    const db = createDatabase(dbPath);
    upsertGuild(db, { guildId: "g1", guildName: "Test", consoleUrl: "https://x", adapterToken: "token" });
    db.close();

    // Pre-create the path rotateKeys() would generate for version 2, to
    // simulate a previous partially-completed rotation attempt.
    writeFileSync(join(dir, "kek-v2.age"), "not a real kek file");

    assert.throws(() => rotateKeys({ db: dbPath, dir, dryRun: false }), /already exists -- refusing to overwrite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
