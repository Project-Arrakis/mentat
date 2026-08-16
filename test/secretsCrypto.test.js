import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
  secretsKeySource,
  checkSecretFilePermissions,
  activeKeyVersion,
  wrapDEK,
  unwrapDEK,
  generateDEK,
  encryptWithDEK,
  decryptWithDEK,
  _resetKeyCacheForTests,
  _resetKEKCacheForTests
} from "../src/secretsCrypto.js";

// Real age identity + KEK fixtures for the KEK/DEK tests below. These
// tests shell out to the real `age` binary (matching what loadKEK()
// itself does) rather than mocking it -- KEK loading is exactly the kind
// of external-process integration a mock would let pass silently wrong
// (e.g. a quoting bug in the execSync() command string that only shows
// up against the real binary). Skips gracefully (not a hard failure) if
// `age` isn't installed, matching this repo's own precedent for
// environment-dependent tests (see e.g. withIsolatedDatabase()'s
// Postgres-unavailable skip in dune-awakening-selfhost-docker, applied
// here for the equivalent case).
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
  return { identityPath, kekPath, kekHex };
}

const VALID_KEY_HEX = "a".repeat(64); // 32 bytes, all 0xaa -- any valid 64-hex-char string works here.
const OTHER_VALID_KEY_HEX = "b".repeat(64);

function envWithKey(hex) {
  return { ACP_SECRETS_KEY: hex };
}

test.beforeEach(() => {
  _resetKeyCacheForTests();
});

test("isEncryptionConfigured is false with no key configured", () => {
  assert.equal(isEncryptionConfigured({}), false);
});

test("isEncryptionConfigured is true once ACP_SECRETS_KEY is set", () => {
  assert.equal(isEncryptionConfigured(envWithKey(VALID_KEY_HEX)), true);
});

test("secretsKeySource reports ACP_SECRETS_KEY when set directly", () => {
  isEncryptionConfigured(envWithKey(VALID_KEY_HEX));
  assert.equal(secretsKeySource(envWithKey(VALID_KEY_HEX)), "ACP_SECRETS_KEY");
});

test("encryptSecret round-trips through decryptSecret with a configured key", () => {
  const env = envWithKey(VALID_KEY_HEX);
  const ciphertext = encryptSecret("my-adapter-token", env);
  assert.notEqual(ciphertext, "my-adapter-token");
  assert.equal(decryptSecret(ciphertext, env), "my-adapter-token");
});

test("ciphertext is not human-readable and does not contain the plaintext", () => {
  const env = envWithKey(VALID_KEY_HEX);
  const ciphertext = encryptSecret("super-secret-value-12345", env);
  assert.equal(ciphertext.includes("super-secret-value-12345"), false);
});

test("two encryptions of the same plaintext produce different ciphertext (random IV)", () => {
  const env = envWithKey(VALID_KEY_HEX);
  const a = encryptSecret("same-value", env);
  const b = encryptSecret("same-value", env);
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, env), "same-value");
  assert.equal(decryptSecret(b, env), "same-value");
});

test("decrypting with the wrong key throws instead of returning corrupted plaintext", () => {
  const ciphertext = encryptSecret("my-adapter-token", envWithKey(VALID_KEY_HEX));
  _resetKeyCacheForTests();
  assert.throws(() => decryptSecret(ciphertext, envWithKey(OTHER_VALID_KEY_HEX)));
});

test("without a configured key, encryptSecret returns a tagged-plaintext passthrough", () => {
  const stored = encryptSecret("my-adapter-token", {});
  assert.notEqual(stored, "my-adapter-token");
  assert.equal(decryptSecret(stored, {}), "my-adapter-token");
});

test("legacy untagged plaintext (written before this module existed) decrypts unchanged", () => {
  assert.equal(decryptSecret("some-legacy-plaintext-token", {}), "some-legacy-plaintext-token");
  assert.equal(decryptSecret("some-legacy-plaintext-token", envWithKey(VALID_KEY_HEX)), "some-legacy-plaintext-token");
});

test("decrypting ciphertext with no key configured throws a clear error", () => {
  const ciphertext = encryptSecret("my-adapter-token", envWithKey(VALID_KEY_HEX));
  _resetKeyCacheForTests();
  assert.throws(() => decryptSecret(ciphertext, {}), /ACP_SECRETS_KEY/);
});

test("empty string and nullish values pass through both functions unchanged", () => {
  assert.equal(encryptSecret("", envWithKey(VALID_KEY_HEX)), "");
  assert.equal(encryptSecret(null, envWithKey(VALID_KEY_HEX)), "");
  assert.equal(encryptSecret(undefined, envWithKey(VALID_KEY_HEX)), "");
  assert.equal(decryptSecret("", envWithKey(VALID_KEY_HEX)), "");
  assert.equal(decryptSecret(null, envWithKey(VALID_KEY_HEX)), null);
  assert.equal(decryptSecret(undefined, envWithKey(VALID_KEY_HEX)), undefined);
});

test("rejects a key that is not exactly 64 hex characters", () => {
  assert.throws(() => isEncryptionConfigured({ ACP_SECRETS_KEY: "too-short" }), /64 hex characters/);
});

test("reads the key from ACP_SECRETS_KEY_FILE when ACP_SECRETS_KEY is unset", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "acp-secrets-key-"));
  const filePath = join(dir, "key.hex");
  writeFileSync(filePath, `${VALID_KEY_HEX}\n`);

  const env = { ACP_SECRETS_KEY_FILE: filePath };
  assert.equal(isEncryptionConfigured(env), true);
  assert.equal(secretsKeySource(env), "ACP_SECRETS_KEY_FILE");

  const ciphertext = encryptSecret("file-key-token", env);
  assert.equal(decryptSecret(ciphertext, env), "file-key-token");
});

test("ACP_SECRETS_KEY takes precedence over ACP_SECRETS_KEY_FILE when both are set", () => {
  const env = { ACP_SECRETS_KEY: VALID_KEY_HEX, ACP_SECRETS_KEY_FILE: "/nonexistent/path" };
  assert.equal(secretsKeySource(env), "ACP_SECRETS_KEY");
});

// ── KEK/DEK hierarchy (issues #107/#108/#109) ──

test("wrapDEK/unwrapDEK round-trip a real 32-byte DEK", () => {
  const kek = randomBytes(32);
  const dek = generateDEK();
  const wrapped = wrapDEK(dek, kek);
  assert.notEqual(wrapped, dek.toString("base64"));
  const unwrapped = unwrapDEK(wrapped, kek);
  assert.deepEqual(unwrapped, dek);
});

test("unwrapDEK with the wrong KEK throws instead of returning corrupted bytes", () => {
  const kek = randomBytes(32);
  const wrongKek = randomBytes(32);
  const dek = generateDEK();
  const wrapped = wrapDEK(dek, kek);
  assert.throws(() => unwrapDEK(wrapped, wrongKek));
});

test("generateDEK produces a fresh, random 32-byte key each call", () => {
  const a = generateDEK();
  const b = generateDEK();
  assert.equal(a.length, 32);
  assert.equal(b.length, 32);
  assert.notDeepEqual(a, b);
});

test("checkSecretFilePermissions returns true for mode 0600 and 0400, false otherwise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-secrets-perm-"));
  try {
    const path600 = join(dir, "file600");
    writeFileSync(path600, "x", { mode: 0o600 });
    assert.equal(checkSecretFilePermissions(path600, "test"), true);

    const path400 = join(dir, "file400");
    writeFileSync(path400, "x", { mode: 0o400 });
    assert.equal(checkSecretFilePermissions(path400, "test"), true);

    const path644 = join(dir, "file644");
    writeFileSync(path644, "x", { mode: 0o644 });
    assert.equal(checkSecretFilePermissions(path644, "test"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkSecretFilePermissions returns true (nothing to warn about) for a missing file", () => {
  assert.equal(checkSecretFilePermissions("/nonexistent/path/for/this/test", "test"), true);
});

test("without ACP_KEK_FILE/ACP_AGE_IDENTITY_FILE configured, activeKeyVersion() returns null and encryptWithDEK() falls back to v1", () => {
  _resetKEKCacheForTests();
  assert.equal(activeKeyVersion({}), null);
  const { ciphertext, wrappedDEK } = encryptWithDEK("my-token", envWithKey(VALID_KEY_HEX));
  assert.equal(wrappedDEK, null);
  assert.ok(ciphertext.startsWith("enc:v1:"));
  assert.equal(decryptWithDEK(ciphertext, null, envWithKey(VALID_KEY_HEX)), "my-token");
});

test("real age/KEK round-trip: encryptWithDEK/decryptWithDEK produce and consume real v2 ciphertext", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-kek-fixture-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    _resetKEKCacheForTests();
    const env = { ACP_AGE_IDENTITY_FILE: identityPath, ACP_KEK_FILE: kekPath, ACP_KEK_VERSION: "1" };

    assert.equal(activeKeyVersion(env), 1);

    const { ciphertext, wrappedDEK } = encryptWithDEK("real-adapter-token-xyz", env);
    assert.ok(ciphertext.startsWith("enc:v2:1:"));
    assert.ok(wrappedDEK, "a real KEK must produce a wrapped DEK");
    assert.equal(ciphertext.includes("real-adapter-token-xyz"), false);

    const plaintext = decryptWithDEK(ciphertext, wrappedDEK, env);
    assert.equal(plaintext, "real-adapter-token-xyz");
  } finally {
    _resetKEKCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: decryptWithDEK throws a clear error when the wrapped DEK is missing for a v2 row", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-kek-fixture-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    _resetKEKCacheForTests();
    const env = { ACP_AGE_IDENTITY_FILE: identityPath, ACP_KEK_FILE: kekPath };
    const { ciphertext } = encryptWithDEK("some-token", env);
    assert.throws(() => decryptWithDEK(ciphertext, null, env), /no wrapped DEK/);
  } finally {
    _resetKEKCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: decryptWithDEK throws a clear error when no KEK is configured for a v2 row", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-kek-fixture-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    _resetKEKCacheForTests();
    const env = { ACP_AGE_IDENTITY_FILE: identityPath, ACP_KEK_FILE: kekPath };
    const { ciphertext, wrappedDEK } = encryptWithDEK("some-token", env);
    _resetKEKCacheForTests();
    assert.throws(() => decryptWithDEK(ciphertext, wrappedDEK, {}), /ACP_KEK_FILE/);
  } finally {
    _resetKEKCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: ACP_KEK_VERSION defaults to 1 when unset, and is read correctly when set to a different value", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-kek-fixture-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    _resetKEKCacheForTests();
    assert.equal(activeKeyVersion({ ACP_AGE_IDENTITY_FILE: identityPath, ACP_KEK_FILE: kekPath }), 1);

    _resetKEKCacheForTests();
    assert.equal(activeKeyVersion({ ACP_AGE_IDENTITY_FILE: identityPath, ACP_KEK_FILE: kekPath, ACP_KEK_VERSION: "7" }), 7);
  } finally {
    _resetKEKCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: decryptWithDEK transparently handles v1 ciphertext even when a KEK IS configured", { skip: !ageAvailable() && "age binary not installed" }, () => {
  // A row written before the KEK was ever configured (v1 format) must
  // still decrypt correctly after a KEK is added -- decryptWithDEK()'s
  // own format-sniffing (checking for the enc:v2: prefix) must not
  // assume "a KEK is configured" implies "every row is v2".
  const dir = mkdtempSync(join(tmpdir(), "acp-kek-fixture-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    _resetKeyCacheForTests();
    const v1Ciphertext = encryptSecret("legacy-v1-token", envWithKey(VALID_KEY_HEX));

    _resetKEKCacheForTests();
    const envWithBoth = { ACP_SECRETS_KEY: VALID_KEY_HEX, ACP_AGE_IDENTITY_FILE: identityPath, ACP_KEK_FILE: kekPath };
    assert.equal(decryptWithDEK(v1Ciphertext, null, envWithBoth), "legacy-v1-token");
  } finally {
    _resetKEKCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("real age/KEK: two different DEKs produce different wrapped output for the same plaintext (per-row isolation)", { skip: !ageAvailable() && "age binary not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-kek-fixture-"));
  try {
    const { identityPath, kekPath } = makeRealKEKFixture(dir);
    _resetKEKCacheForTests();
    const env = { ACP_AGE_IDENTITY_FILE: identityPath, ACP_KEK_FILE: kekPath };

    const first = encryptWithDEK("same-plaintext-value", env);
    const second = encryptWithDEK("same-plaintext-value", env);
    // Different DEKs (and different IVs) per call -- the wrapped DEK and
    // ciphertext must both differ even for identical plaintext, exactly
    // the point of per-row DEKs: compromising one row's wrapped DEK must
    // not help decrypt any other row.
    assert.notEqual(first.wrappedDEK, second.wrappedDEK);
    assert.notEqual(first.ciphertext, second.ciphertext);
    assert.equal(decryptWithDEK(first.ciphertext, first.wrappedDEK, env), "same-plaintext-value");
    assert.equal(decryptWithDEK(second.ciphertext, second.wrappedDEK, env), "same-plaintext-value");
  } finally {
    _resetKEKCacheForTests();
    rmSync(dir, { recursive: true, force: true });
  }
});
