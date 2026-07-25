// Encrypts small, long-lived secrets (per-guild Core adapter tokens, and
// short-lived OAuth access tokens) before they are written to the bot's
// shared SQLite database (see database.js).
//
// Why this exists: in ACP_MULTI_TENANT mode, a single bot process/database
// serves many independent Dune Awakening operators, each with their own
// Core (dune-awakening-selfhost-docker) install and their own adapter
// token. That token is not player data -- it is a credential that lets
// its holder call that operator's Core adapter API with this bot's
// authority. Storing it in plaintext in guilds.adapter_token meant a
// single compromise of the shared SQLite file (backup exfiltration,
// misconfigured file permissions, a bug in an unrelated write path) would
// expose every connected operator's adapter credential at once, not just
// this bot's own configuration. The same reasoning applies to
// oauth_sessions.access_token, a real (if short-lived) Discord OAuth
// token captured during the setup wizard flow.
//
// This module encrypts at the database.js boundary only. Every other file
// in this project (index.js, onboarding.js, setupServer.js) continues to
// read/write plain adapterToken/accessToken strings exactly as before --
// they never see ciphertext, and this migration requires no changes to
// any caller.
//
// Algorithm: AES-256-GCM. Chosen over CBC/CTR because GCM is authenticated
// (tampering with ciphertext at rest is detected, not just decrypted
// wrongly) and is already a Node built-in with no new dependency.
//
// Key handling follows this project's existing VALUE / VALUE_FILE secret
// convention (see config.js's readSecret()): ACP_SECRETS_KEY (a 64-char
// hex string, i.e. 32 raw bytes) or ACP_SECRETS_KEY_FILE (a file
// containing that same hex string). Generate one with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
//
// If neither is set, encryption is a no-op passthrough (plaintext in,
// plaintext out) rather than a hard failure at startup. This is a
// deliberate backward-compatibility choice: single-tenant operators who
// never set ACP_MULTI_TENANT and have no adapter_token/access_token rows
// of real sensitivity should not be forced to provision a new secret just
// to start the bot. Multi-tenant hosts -- the actual threat model this
// module exists for -- are expected to set this key.
// isEncryptionConfigured() lets callers detect and warn about the no-op
// case explicitly rather than silently accepting it. See
// docs/security-secrets-at-rest.md for full operator guidance.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
// GCM's authentication tag; 16 bytes is the standard/default tag length
// for this algorithm and is not configurable per-call in Node's API.
const TAG_BYTES = 16;
const PLAINTEXT_PREFIX = "plain:";
const CIPHERTEXT_PREFIX = "enc:v1:";

let cachedKey;
let cachedKeySource;

function loadKey(env = process.env) {
  if (cachedKey !== undefined) return cachedKey;

  const direct = typeof env.ACP_SECRETS_KEY === "string" ? env.ACP_SECRETS_KEY.trim() : "";
  const filePath = typeof env.ACP_SECRETS_KEY_FILE === "string" ? env.ACP_SECRETS_KEY_FILE.trim() : "";

  let hex = direct;
  if (!hex && filePath) {
    try {
      hex = readFileSync(filePath, "utf8").trim();
    } catch (error) {
      throw new Error(`ACP_SECRETS_KEY_FILE is set to '${filePath}' but could not be read: ${error.message}`);
    }
  }

  if (!hex) {
    cachedKey = null;
    cachedKeySource = "none";
    return cachedKey;
  }

  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ACP_SECRETS_KEY/ACP_SECRETS_KEY_FILE must be exactly 64 hex characters (32 bytes). " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  cachedKey = Buffer.from(hex, "hex");
  cachedKeySource = direct ? "ACP_SECRETS_KEY" : "ACP_SECRETS_KEY_FILE";
  return cachedKey;
}

// Exposed for tests only, so each test can force a fresh loadKey() read
// after mutating process.env rather than reusing another test's cached key.
export function _resetKeyCacheForTests() {
  cachedKey = undefined;
  cachedKeySource = undefined;
}

export function isEncryptionConfigured(env = process.env) {
  return loadKey(env) !== null;
}

export function secretsKeySource(env = process.env) {
  loadKey(env);
  return cachedKeySource;
}

// Encrypts a plaintext secret for storage. Returns a string safe to store
// directly in a TEXT column. When no key is configured, returns the
// plaintext unchanged, tagged with a distinguishing prefix so
// decryptSecret() can round-trip it later even if a key is added
// afterward (existing plaintext rows are not silently broken by a later
// key rotation -- see migrateLegacyPlaintextSecret() below for the
// explicit, opt-in migration path instead).
export function encryptSecret(plaintext, env = process.env) {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return plaintext ?? "";
  }
  const key = loadKey(env);
  if (!key) {
    return `${PLAINTEXT_PREFIX}${plaintext}`;
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `${CIPHERTEXT_PREFIX}${payload}`;
}

// Decrypts a value previously produced by encryptSecret(). Transparently
// handles three cases: our own ciphertext (decrypt with the configured
// key), our own explicit plaintext tag (strip the tag, return as-is), and
// legacy untagged plaintext from before this module existed (returned
// unchanged) -- so this is safe to deploy against an existing database
// without a blocking migration step.
export function decryptSecret(stored, env = process.env) {
  if (stored === null || stored === undefined) {
    return stored;
  }
  if (stored === "") {
    return "";
  }
  const value = String(stored);

  if (value.startsWith(PLAINTEXT_PREFIX)) {
    return value.slice(PLAINTEXT_PREFIX.length);
  }

  if (!value.startsWith(CIPHERTEXT_PREFIX)) {
    // Legacy untagged plaintext, written before this module existed.
    return value;
  }

  const key = loadKey(env);
  if (!key) {
    throw new Error(
      "Encountered an encrypted secret in the database, but ACP_SECRETS_KEY/ACP_SECRETS_KEY_FILE " +
      "is not set in this process. The key used to write this value must be provided to read it back."
    );
  }

  const payload = Buffer.from(value.slice(CIPHERTEXT_PREFIX.length), "base64");
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export const _internal = { ALGORITHM, KEY_BYTES, IV_BYTES, TAG_BYTES };
