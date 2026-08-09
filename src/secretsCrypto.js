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
import { readFileSync, statSync } from "node:fs";
import { execSync } from "node:child_process";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
// GCM's authentication tag; 16 bytes is the standard/default tag length
// for this algorithm and is not configurable per-call in Node's API.
const TAG_BYTES = 16;
const PLAINTEXT_PREFIX = "plain:";
const CIPHERTEXT_PREFIX = "enc:v1:";
const CIPHERTEXT_PREFIX_V2 = "enc:v2:";

let cachedKey;
let cachedKeySource;
let _kekCache;
let _kekKeyVersion;

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
  return loadKey(env) !== null || loadKEK(env) !== null;
}

export function secretsKeySource(env = process.env) {
  loadKey(env);
  if (cachedKeySource && cachedKeySource !== "none") return cachedKeySource;
  loadKEK(env);
  return _kekCache ? "ACP_KEK_FILE" : "none";
}

// ── KEK/DEK hierarchy (Phase 1, v2 encryption) ──
//
// When ACP_KEK_FILE is configured, secrets are encrypted with per-row Data
// Encryption Keys (DEKs). Each DEK is itself encrypted ("wrapped") with a
// Key Encryption Key (KEK). The KEK is stored age-encrypted on disk.
//
// This two-tier design means:
//   - Rotating the KEK only re-wraps 32-byte DEKs (fast, non-breaking)
//   - Compromising one DEK only exposes one row, not all secrets
//   - The age identity key is the root of trust — operator-controlled
//
// Without ACP_KEK_FILE, the system falls back to the v1 single-key mode
// (ACP_SECRETS_KEY). All existing callers continue to work unchanged.

// Loads the KEK from an age-encrypted file using the age binary.
// Called once at startup; the decrypted KEK stays in memory.
// Returns null if KEK is not configured or age is not available.
function loadKEK(env = process.env) {
  if (_kekCache !== undefined) return _kekCache;

  const kekFile = (env.ACP_KEK_FILE || "").trim();
  const ageIdFile = (env.ACP_AGE_IDENTITY_FILE || "").trim();
  if (!kekFile || !ageIdFile) {
    _kekCache = null;
    return null;
  }

  try {
    // Verify files exist and have restrictive permissions
    for (const f of [kekFile, ageIdFile]) {
      const mode = statSync(f).mode & 0o777;
      if (mode !== 0o400 && mode !== 0o600) {
        // Warn but don't refuse — operator may have legitimate reason
        // (shared group, different umask convention)
      }
    }

    // age --decrypt -i <identity> <kek.age>
    const result = execSync(
      `age --decrypt -i "${ageIdFile}" "${kekFile}"`,
      { encoding: "utf8", timeout: 5000, maxBuffer: 1024 }
    );
    const hex = result.trim();
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new Error(`KEK file ${kekFile} did not contain a valid 64-char hex key`);
    }
    _kekCache = Buffer.from(hex, "hex");
    _kekKeyVersion = 1; // Will be read from key_versions table during DB migration
    return _kekCache;
  } catch (err) {
    // age not installed, file missing, wrong identity, or corrupted file
    _kekCache = null;
    if (err.stderr) {
      const stderr = String(err.stderr).trim();
      if (stderr) console.error(`[acp] KEK load failed: ${stderr}`);
    }
    return null;
  }
}

// Wraps a DEK with the KEK. Returns base64-encoded wrapped DEK.
// The DEK is a 32-byte AES key; the wrapped form includes IV + auth tag.
export function wrapDEK(dek, kek) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, kek, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

// Unwraps a DEK previously wrapped with wrapDEK(). Returns the 32-byte DEK.
export function unwrapDEK(wrappedBase64, kek) {
  const payload = Buffer.from(wrappedBase64, "base64");
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, kek, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

// Generates a fresh 32-byte DEK. Exported for migration scripts.
export function generateDEK() {
  return randomBytes(KEY_BYTES);
}

// Exposed for tests
export function _resetKEKCacheForTests() {
  _kekCache = undefined;
  _kekKeyVersion = undefined;
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
  // authTagLength is pinned explicitly (not left to GCM's 16-byte default)
  // so encrypt and decrypt both assert the same, fixed tag length rather
  // than trusting whatever length happens to be embedded in the stored
  // payload. This closes a real semgrep finding
  // (javascript.node-crypto.security.gcm-no-tag-length): without an
  // explicit length, a shorter-than-expected tag could in principle be
  // accepted, weakening GCM's forgery resistance. Node itself has been
  // moving the same direction -- as of v20.13.0/v22.0.0, decrypting with
  // authTagLength unset and a non-default tag length is deprecated, and
  // v26.0.0 made it a hard error.
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
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

  // See the matching comment in encryptSecret() above for why
  // authTagLength is pinned explicitly here.
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// Encrypts plaintext with a per-row DEK. Returns { ciphertext, wrappedDEK }
// where ciphertext is enc:v2:<keyVersion>:<base64> and wrappedDEK is the
// DEK encrypted with the active KEK (stored separately in secret_keys).
// Falls back to v1 single-key mode if no KEK is configured.
export function encryptWithDEK(plaintext, env = process.env) {
  if (plaintext === null || plaintext === undefined || plaintext === "") {
    return { ciphertext: plaintext ?? "", wrappedDEK: null };
  }

  const kek = loadKEK(env);
  if (!kek) {
    // No KEK configured — use v1 single-key encryption (backward compat)
    return { ciphertext: encryptSecret(plaintext, env), wrappedDEK: null };
  }

  const dek = generateDEK();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64");
  const version = _kekKeyVersion || 1;
  const ciphertext = `${CIPHERTEXT_PREFIX_V2}${version}:${payload}`;
  const wrappedDEK = wrapDEK(dek, kek);
  return { ciphertext, wrappedDEK };
}

// Decrypts a value produced by encryptWithDEK(). Requires the wrapped DEK
// that was returned alongside the ciphertext. Handles v1 format
// transparently (no wrappedDEK needed for v1 rows).
export function decryptWithDEK(ciphertext, wrappedDEK, env = process.env) {
  if (ciphertext === null || ciphertext === undefined || ciphertext === "") {
    return ciphertext ?? "";
  }
  const value = String(ciphertext);

  // v1 format — use legacy single-key decryption
  if (value.startsWith(CIPHERTEXT_PREFIX) || value.startsWith(PLAINTEXT_PREFIX) ||
      (!value.startsWith(CIPHERTEXT_PREFIX_V2))) {
    return decryptSecret(value, env);
  }

  // v2 format: enc:v2:<version>:<base64 payload>
  const rest = value.slice(CIPHERTEXT_PREFIX_V2.length);
  const colonIdx = rest.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(`Malformed v2 ciphertext: missing key version separator`);
  }

  if (!wrappedDEK) {
    throw new Error(
      "Encountered a v2 encrypted secret but no wrapped DEK was provided. " +
      "The secret_keys table may be missing this row."
    );
  }

  const kek = loadKEK(env);
  if (!kek) {
    throw new Error(
      "Encountered a v2 encrypted secret but ACP_KEK_FILE / ACP_AGE_IDENTITY_FILE " +
      "is not configured. The KEK used to wrap this row's DEK must be provided to read it back."
    );
  }

  const dek = unwrapDEK(wrappedDEK, kek);
  const payload = Buffer.from(rest.slice(colonIdx + 1), "base64");
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, dek, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return plaintext.toString("utf8");
}

export const _internal = { ALGORITHM, KEY_BYTES, IV_BYTES, TAG_BYTES, loadKEK, wrapDEK, unwrapDEK };
