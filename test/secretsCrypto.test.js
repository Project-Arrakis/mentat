import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
  secretsKeySource,
  wrapDEK,
  unwrapDEK,
  generateDEK,
  encryptWithDEK,
  decryptWithDEK,
  _resetKeyCacheForTests,
  _resetKEKCacheForTests,
  _internal
} from "../src/secretsCrypto.js";

const VALID_KEY_HEX = "a".repeat(64); // 32 bytes, all 0xaa -- any valid 64-hex-char string works here.
const OTHER_VALID_KEY_HEX = "b".repeat(64);

function envWithKey(hex) {
  return { ACP_SECRETS_KEY: hex };
}

test.beforeEach(() => {
  _resetKeyCacheForTests();
  _resetKEKCacheForTests();
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

// ── KEK/DEK hierarchy tests (Phase 1, v2 encryption) ──
//
// These tests exercise the *real* `age` CLI binary via loadKEK()'s own
// execSync call -- not a mock. This is deliberate: loadKEK() shells out to
// a real external process, and a mocked/stubbed age would only prove the
// JS-side plumbing is correct, not that this module actually interoperates
// with the real age binary an operator would install. Per this repo's own
// testing discipline (Requirement 8 in the Arrakis-Project meta-repo:
// "never assume, always verify" -- verified against real command output,
// not assumed), skipping these entirely when age is unavailable makes the
// gap visible (a skip message), not silent.
//
// If `age`/`age-keygen` are not on PATH, these tests are skipped with an
// explicit message rather than failing the whole suite -- CI environments
// that haven't yet installed age (see the design doc's own note that no
// CI currently installs it) will see this as a visible skip, not a
// silent pass or a hard failure unrelated to what's being tested.

function ageAvailable() {
  try {
    execFileSync("age", ["--version"], { stdio: "ignore" });
    execFileSync("age-keygen", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const AGE_AVAILABLE = ageAvailable();
const kekTest = AGE_AVAILABLE ? test : test.skip;

if (!AGE_AVAILABLE) {
  test("(age binary unavailable -- KEK/DEK tests skipped, not silently omitted)", () => {
    console.error(
      "[test] age/age-keygen not found on PATH -- skipping KEK/DEK tests. " +
      "Install with: apt install age (or see https://github.com/FiloSottile/age)."
    );
  });
}

// Generates a real age identity + a real age-encrypted KEK file in a fresh
// temp directory, mirroring exactly what `dune secrets setup`/ACP's
// setup-keys.js would produce, using the real age-keygen and age binaries.
function makeRealAgeFixture() {
  const dir = mkdtempSync(join(tmpdir(), "acp-kek-fixture-"));
  const identityPath = join(dir, "age-identity.txt");
  const kekPath = join(dir, "kek.age");

  execFileSync("age-keygen", ["-o", identityPath]);
  chmodSync(identityPath, 0o400);

  const publicKey = execFileSync("age-keygen", ["-y", identityPath], { encoding: "utf8" }).trim();

  const kekHex = generateDEK().toString("hex"); // 32 bytes -> 64 hex chars, matches loadKEK()'s expected shape
  execFileSync("age", ["--encrypt", "-r", publicKey, "-o", kekPath], { input: kekHex });
  chmodSync(kekPath, 0o400);

  return { dir, identityPath, kekPath, kekHex, publicKey };
}

kekTest("1. loadKEK loads a real KEK from a real age-encrypted file (valid age key)", () => {
  const { identityPath, kekPath, kekHex } = makeRealAgeFixture();
  const env = { ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: identityPath };

  assert.equal(isEncryptionConfigured(env), true);
  assert.equal(secretsKeySource(env), "ACP_KEK_FILE");

  // loadKEK() is not exported directly from the public API, but is
  // reachable via the _internal export for direct verification -- confirm
  // the decrypted KEK actually equals the plaintext hex we encrypted,
  // not just that "something" decrypted without error.
  const kek = _internal.loadKEK(env);
  assert.ok(Buffer.isBuffer(kek));
  assert.deepEqual(kek, Buffer.from(kekHex, "hex"));
});

kekTest("2. loadKEK fails to load KEK with the wrong age identity (returns null, does not throw)", () => {
  const { kekPath } = makeRealAgeFixture();
  const wrongIdentityDir = mkdtempSync(join(tmpdir(), "acp-wrong-identity-"));
  const wrongIdentityPath = join(wrongIdentityDir, "wrong-identity.txt");
  execFileSync("age-keygen", ["-o", wrongIdentityPath]);

  const env = { ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: wrongIdentityPath };

  // loadKEK() catches age's decrypt failure internally and returns null --
  // isEncryptionConfigured() surfaces that as "not configured" rather than
  // throwing, which is the documented, deliberate behavior (see the
  // catch block's comment: "age not installed, file missing, wrong
  // identity, or corrupted file").
  assert.equal(isEncryptionConfigured(env), false);
});

kekTest("3. falls back to ACP_SECRETS_KEY (v1 mode) when ACP_KEK_FILE is not set", () => {
  const env = { ACP_SECRETS_KEY: VALID_KEY_HEX };
  assert.equal(isEncryptionConfigured(env), true);
  assert.equal(secretsKeySource(env), "ACP_SECRETS_KEY");

  const { ciphertext, wrappedDEK } = encryptWithDEK("fallback-token", env);
  assert.equal(wrappedDEK, null);
  assert.ok(ciphertext.startsWith("enc:v1:"));
  assert.equal(decryptWithDEK(ciphertext, wrappedDEK, env), "fallback-token");
});

kekTest("4. wrapDEK/unwrapDEK round-trip: unwrapping a wrapped DEK recovers the exact original bytes", () => {
  const { identityPath, kekPath } = makeRealAgeFixture();
  const env = { ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: identityPath };

  // Force a real loadKEK() call via the internal export so this test can
  // get the actual decrypted KEK buffer to wrap/unwrap against directly.
  const kek = _internal.loadKEK(env);
  assert.ok(Buffer.isBuffer(kek));
  assert.equal(kek.length, 32);

  const dek = generateDEK();
  const wrapped = wrapDEK(dek, kek);
  const unwrapped = unwrapDEK(wrapped, kek);
  assert.deepEqual(unwrapped, dek);
});

kekTest("5. unwrapDEK detects a tampered wrapped DEK (auth tag failure, throws)", () => {
  const { identityPath, kekPath } = makeRealAgeFixture();
  const env = { ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: identityPath };
  const kek = _internal.loadKEK(env);

  const dek = generateDEK();
  const wrapped = wrapDEK(dek, kek);

  // Flip a byte in the middle of the wrapped payload (inside the
  // ciphertext region, past the 12-byte IV + 16-byte tag prefix) to
  // simulate tampering at rest.
  const buf = Buffer.from(wrapped, "base64");
  buf[buf.length - 1] ^= 0xff;
  const tampered = buf.toString("base64");

  assert.throws(() => unwrapDEK(tampered, kek));
});

kekTest("6. encryptWithDEK/decryptWithDEK round-trip with a real KEK produces and consumes enc:v2: format", () => {
  const { identityPath, kekPath } = makeRealAgeFixture();
  const env = { ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: identityPath };

  const { ciphertext, wrappedDEK } = encryptWithDEK("per-row-secret-value", env);
  assert.ok(ciphertext.startsWith("enc:v2:"));
  assert.ok(wrappedDEK, "wrappedDEK must be present for a v2-encrypted row");
  assert.equal(ciphertext.includes("per-row-secret-value"), false);

  const recovered = decryptWithDEK(ciphertext, wrappedDEK, env);
  assert.equal(recovered, "per-row-secret-value");
});

kekTest("7. different rows (different encryptWithDEK calls) get different DEKs, even for identical plaintext", () => {
  const { identityPath, kekPath } = makeRealAgeFixture();
  const env = { ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: identityPath };

  const a = encryptWithDEK("identical-value", env);
  const b = encryptWithDEK("identical-value", env);

  // Different wrapped DEKs (each row's DEK is freshly generated per call).
  assert.notEqual(a.wrappedDEK, b.wrappedDEK);
  // Different ciphertext too (different DEK + different random IV).
  assert.notEqual(a.ciphertext, b.ciphertext);
  // But both still decrypt to the same original plaintext, each with its
  // own wrapped DEK -- proving they are genuinely independent per-row keys,
  // not just cosmetically different ciphertext from IV alone.
  assert.equal(decryptWithDEK(a.ciphertext, a.wrappedDEK, env), "identical-value");
  assert.equal(decryptWithDEK(b.ciphertext, b.wrappedDEK, env), "identical-value");
});

kekTest("8. rotate KEK: a DEK wrapped under the old KEK is not readable under a new, different KEK", () => {
  const { identityPath, kekPath: oldKekPath } = makeRealAgeFixture();
  const oldEnv = { ACP_KEK_FILE: oldKekPath, ACP_AGE_IDENTITY_FILE: identityPath };
  const oldKek = _internal.loadKEK(oldEnv);

  const dek = generateDEK();
  const wrappedUnderOldKek = wrapDEK(dek, oldKek);

  // Simulate KEK rotation: generate a brand-new KEK, re-encrypt it with
  // the SAME age identity (rotation only changes the KEK, not the
  // identity), and confirm the old wrapped DEK cannot be unwrapped with
  // the new KEK -- this is the exact property that makes "old KEK
  // version retained for reading rows encrypted during transition"
  // (per the design doc's rotate-keys.js spec) a real, necessary step,
  // not a nicety: without keeping the old KEK around, old rows become
  // permanently unreadable the instant the KEK rotates.
  const newKekHex = generateDEK().toString("hex"); // 32 bytes -> 64 hex chars, matches loadKEK()'s expected shape
  const publicKey = execFileSync("age-keygen", ["-y", identityPath], { encoding: "utf8" }).trim();
  const newKekPath = join(mkdtempSync(join(tmpdir(), "acp-new-kek-")), "kek.age");
  execFileSync("age", ["--encrypt", "-r", publicKey, "-o", newKekPath], { input: newKekHex });
  const newEnv = { ACP_KEK_FILE: newKekPath, ACP_AGE_IDENTITY_FILE: identityPath };
  _resetKEKCacheForTests();
  const newKek = _internal.loadKEK(newEnv);

  assert.notDeepEqual(newKek, oldKek);
  assert.throws(() => unwrapDEK(wrappedUnderOldKek, newKek));

  // But it IS still readable under the retained old KEK -- proving the
  // rotation-transition property the design doc requires actually holds.
  assert.deepEqual(unwrapDEK(wrappedUnderOldKek, oldKek), dek);
});

kekTest("9. forward compat: enc:v1: rows still decrypt via decryptWithDEK even when a KEK is configured", () => {
  const { identityPath, kekPath } = makeRealAgeFixture();
  // Write a v1 row using only ACP_SECRETS_KEY (no KEK involved at write time).
  const v1Env = { ACP_SECRETS_KEY: VALID_KEY_HEX };
  const v1Ciphertext = encryptSecret("legacy-v1-token", v1Env);
  assert.ok(v1Ciphertext.startsWith("enc:v1:"));

  // Now read it back via decryptWithDEK() with BOTH the v1 key AND a KEK
  // configured (the real-world "KEK configured, but this particular row
  // predates the KEK" scenario) -- must still work via the v1 fallback
  // path inside decryptWithDEK(), with no wrappedDEK needed.
  const mixedEnv = { ACP_SECRETS_KEY: VALID_KEY_HEX, ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: identityPath };
  assert.equal(decryptWithDEK(v1Ciphertext, null, mixedEnv), "legacy-v1-token");
});

kekTest("10. empty plaintext returns empty from encryptWithDEK with no DEK created (no wrappedDEK)", () => {
  const { identityPath, kekPath } = makeRealAgeFixture();
  const env = { ACP_KEK_FILE: kekPath, ACP_AGE_IDENTITY_FILE: identityPath };

  const emptyResult = encryptWithDEK("", env);
  assert.equal(emptyResult.ciphertext, "");
  assert.equal(emptyResult.wrappedDEK, null);

  const nullResult = encryptWithDEK(null, env);
  assert.equal(nullResult.ciphertext, "");
  assert.equal(nullResult.wrappedDEK, null);
});
