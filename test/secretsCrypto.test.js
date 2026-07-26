import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encryptSecret,
  decryptSecret,
  isEncryptionConfigured,
  secretsKeySource,
  _resetKeyCacheForTests
} from "../src/secretsCrypto.js";

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
