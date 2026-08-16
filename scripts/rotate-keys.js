#!/usr/bin/env node
/**
 * rotate-keys.js
 *
 * Non-breaking KEK rotation (design doc: "KEK rotation: Non-breaking.
 * Only DEKs (32 bytes each) re-wrapped. Old KEK retained for reading
 * rows during transition."). This script:
 *
 *   1. Loads the OLD KEK (via ACP_KEK_FILE/ACP_AGE_IDENTITY_FILE, exactly
 *      as the running bot would).
 *   2. Generates a brand-new KEK, age-encrypted to the SAME age identity
 *      (rotating the KEK does not require rotating the age identity
 *      itself -- those are separate concerns; see recover-keys.js for
 *      identity recovery).
 *   3. Walks every row in secret_keys, unwraps its DEK with the old KEK,
 *      re-wraps that SAME DEK with the new KEK, and updates key_version.
 *      The DEK itself never changes and no data row is re-encrypted --
 *      only the much smaller (32-byte) wrapped-DEK column is rewritten,
 *      which is what makes this "non-breaking" and fast even with many
 *      rows.
 *   4. Marks the old key_versions row retired_at, but does NOT delete it
 *      -- a row this script fails to reach for any reason (a crash
 *      mid-run, a row inserted concurrently by the live bot process)
 *      must remain readable under the old KEK until a future rotation
 *      run picks it up, not become silently unrecoverable.
 *
 * This script does NOT touch adapter_token/access_token/any other data
 * column -- only secret_keys.wrapped_dek and secret_keys.key_version.
 * Existing v1-encrypted rows (no wrapped_dek at all) are unaffected;
 * they continue to use ACP_SECRETS_KEY exactly as before and are only
 * ever upgraded to v2 on their own next write, not by this script.
 *
 * IMPORTANT: run this against a STOPPED bot, or expect a narrow race
 * where a row the live bot process writes between step 3's read and
 * this script's own commit uses whichever KEK version wins the race.
 * The live bot's own encryptColumn() always uses whatever KEK it has
 * loaded at process start, so if this script deploys a new KEK file
 * while the bot keeps running with the old one loaded in memory, new
 * writes continue under the old KEK until the bot is restarted -- which
 * is safe (the old KEK is retained, not deleted) but means "fully
 * migrated to the new KEK" isn't true until after that restart.
 *
 * Usage:
 *   node scripts/rotate-keys.js --db <path> --dir <path> [--dry-run]
 *
 * --dir is the same directory setup-keys.js was originally given (where
 * the current age-identity.txt and kek.age live); the new KEK is written
 * alongside them as kek-v<N>.age, and the OLD kek.age is left in place
 * untouched (never deleted by this script -- an operator who wants to
 * remove it after confirming the rotation succeeded may do so manually).
 */

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import Database from "better-sqlite3";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function parseArgs(argv) {
  const args = { db: "data/acp.db", dir: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--db") args.db = argv[++i];
    else if (arg === "--dir") args.dir = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  if (!args.dir) {
    console.error("--dir <path> is required (the directory containing the current age-identity.txt and kek.age).");
    process.exit(2);
  }
  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/rotate-keys.js --db <path> --dir <path> [--dry-run]

Rotates the KEK: generates a new one, re-wraps every existing DEK under
it, marks the old key_versions row retired. Does not re-encrypt any data
row and does not require ACP_SECRETS_KEY.

  --db <path>    Path to the bot's SQLite database (default: data/acp.db)
  --dir <path>   Directory containing the current age-identity.txt/kek.age
  --dry-run      Report what would change without writing anything
`);
}

export function loadOldKEK(dir) {
  const identityPath = join(dir, "age-identity.txt");
  const kekPath = join(dir, "kek.age");
  if (!existsSync(identityPath) || !existsSync(kekPath)) {
    console.error(`Expected both ${identityPath} and ${kekPath} to exist -- this directory doesn't look like a setup-keys.js output directory.`);
    process.exit(1);
  }
  const hex = execFileSync("age", ["--decrypt", "-i", identityPath, kekPath], { encoding: "utf8" }).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(`Old KEK file ${kekPath} did not decrypt to a valid 64-char hex key.`);
  }
  return { kek: Buffer.from(hex, "hex"), identityPath };
}

export function generateAndWrapNewKEK(dir, identityPath, newVersion) {
  const identityText = readFileSync(identityPath, "utf8");
  const publicKeyLine = identityText.split("\n").find((line) => line.startsWith("# public key:"));
  const publicKey = publicKeyLine ? publicKeyLine.replace("# public key:", "").trim() : null;
  if (!publicKey) {
    throw new Error(`Could not extract the public key from ${identityPath}.`);
  }

  const newKekHex = randomBytes(32).toString("hex");
  const newKekPath = join(dir, `kek-v${newVersion}.age`);
  if (existsSync(newKekPath)) {
    throw new Error(`${newKekPath} already exists -- refusing to overwrite. If a previous rotation run partially completed, investigate before retrying.`);
  }
  const kekPlainPath = join(dir, `.kek-v${newVersion}-plain-tmp.txt`);
  writeFileSync(kekPlainPath, newKekHex, { mode: 0o600 });
  try {
    execFileSync("age", ["-r", publicKey, "-o", newKekPath, kekPlainPath]);
  } finally {
    try { writeFileSync(kekPlainPath, ""); } catch {}
    try { execFileSync("rm", ["-f", kekPlainPath]); } catch {}
  }
  chmodSync(newKekPath, 0o600);
  return { kek: Buffer.from(newKekHex, "hex"), path: newKekPath };
}

export function unwrapDEK(wrappedBase64, kek) {
  const payload = Buffer.from(wrappedBase64, "base64");
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const encrypted = payload.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, kek, iv, { authTagLength: TAG_BYTES });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

export function wrapDEK(dek, kek) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, kek, iv, { authTagLength: TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

// rotateKeys(args): the core rotation logic, factored out of main() so
// it can be unit tested directly against a real (throwaway) database
// and real age/KEK fixtures without going through the CLI arg-parsing
// or process.exit()/console-logging layer. Throws on a genuine setup
// error (missing database, missing KEK fixture); returns a structured
// summary object on success (including the empty-secret_keys and
// dry-run cases) so a caller (test or CLI) can decide how to report it.
export function rotateKeys(args) {
  if (!existsSync(args.db)) {
    throw new Error(`Database not found: ${args.db}`);
  }

  const { kek: oldKek, identityPath } = loadOldKEK(args.dir);
  const db = new Database(args.db);

  try {
    const rows = db.prepare("SELECT table_name, row_key, column_name, wrapped_dek, key_version FROM secret_keys").all();
    if (rows.length === 0) {
      return { status: "nothing-to-rotate", rotated: 0, failed: 0 };
    }

    const maxVersion = db.prepare("SELECT MAX(version) AS v FROM key_versions").get()?.v || 1;
    const newVersion = maxVersion + 1;

    if (args.dryRun) {
      return {
        status: "dry-run",
        rowCount: rows.length,
        wouldCreateKekPath: join(args.dir, `kek-v${newVersion}.age`),
        fromVersion: maxVersion,
        toVersion: newVersion
      };
    }

    const { path: newKekPath } = generateAndWrapNewKEK(args.dir, identityPath, newVersion);
    const newKek = _internalTestOnly_loadJustWrittenKek(newKekPath, identityPath);

    const insertVersion = db.prepare("INSERT INTO key_versions (version) VALUES (?) ON CONFLICT(version) DO NOTHING");
    const updateRow = db.prepare("UPDATE secret_keys SET wrapped_dek = ?, key_version = ? WHERE table_name = ? AND row_key = ? AND column_name = ?");
    const logRotate = db.prepare("INSERT INTO secret_access_log (table_name, row_key, column_name, event, key_version) VALUES (?, ?, ?, 'rotate', ?)");
    const retireOld = db.prepare("UPDATE key_versions SET retired_at = datetime('now') WHERE version = ? AND retired_at IS NULL");

    const rotateAll = db.transaction((rowsToRotate) => {
      insertVersion.run(newVersion);
      const failures = [];
      let rotated = 0;
      for (const row of rowsToRotate) {
        try {
          const dek = unwrapDEK(row.wrapped_dek, oldKek);
          const rewrapped = wrapDEK(dek, newKek);
          updateRow.run(rewrapped, newVersion, row.table_name, row.row_key, row.column_name);
          logRotate.run(row.table_name, row.row_key, row.column_name, newVersion);
          rotated++;
        } catch (error) {
          // A single unreadable row (corrupted wrapped_dek, wrong old
          // KEK) must not abort the entire rotation for every other row
          // -- but it also must not be silently skipped without the
          // operator knowing. Reported in the returned summary; the row
          // is left exactly as it was (old key_version, old
          // wrapped_dek), still readable under the OLD KEK, which is
          // why the old KEK is never deleted by this script.
          failures.push({ table_name: row.table_name, row_key: row.row_key, column_name: row.column_name, message: error.message });
        }
      }
      retireOld.run(maxVersion);
      return { rotated, failures };
    });

    const { rotated, failures } = rotateAll(rows);

    return {
      status: "rotated",
      rotated,
      failed: failures.length,
      failures,
      fromVersion: maxVersion,
      toVersion: newVersion,
      newKekPath
    };
  } finally {
    db.close();
  }
}

// Re-decrypts the KEK this same function just wrote via
// generateAndWrapNewKEK(), rather than threading the in-memory KEK
// buffer back out of that function -- keeps generateAndWrapNewKEK()'s
// contract (write a file, return its path) simple and independently
// testable, at the cost of one extra `age --decrypt` shell-out per
// rotation run (negligible next to the per-row re-wrap work already
// happening).
function _internalTestOnly_loadJustWrittenKek(kekPath, identityPath) {
  const hex = execFileSync("age", ["--decrypt", "-i", identityPath, kekPath], { encoding: "utf8" }).trim();
  return Buffer.from(hex, "hex");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = rotateKeys(args);

  if (result.status === "nothing-to-rotate") {
    console.log("No rows in secret_keys -- nothing to rotate. (This is expected if no secret has ever been written with a KEK configured; v1-only deployments have nothing for this script to do.)");
    return;
  }
  if (result.status === "dry-run") {
    console.log(`Found ${result.rowCount} wrapped DEK(s) under key version(s) up to ${result.fromVersion}. Rotating to version ${result.toVersion}.`);
    console.log(`[dry run] Would generate a new KEK at ${result.wouldCreateKekPath} and re-wrap all ${result.rowCount} DEK(s). No files or database rows will be modified.`);
    return;
  }

  console.log(`Rotation complete: ${result.rotated} DEK(s) re-wrapped under key version ${result.toVersion}.`);
  if (result.failed > 0) {
    for (const f of result.failures) {
      console.error(`  Failed to rotate ${f.table_name}/${f.row_key}/${f.column_name}: ${f.message}`);
    }
    console.error(`${result.failed} row(s) could not be rotated (see errors above) -- they remain under the OLD key version and are still readable as long as the old KEK file is kept. Investigate before deleting the old KEK.`);
  }
  console.log(`\nNew KEK written to: ${result.newKekPath}`);
  console.log("\nTo activate, set these environment variables and restart the bot:\n");
  console.log(`  ACP_KEK_FILE=${result.newKekPath}`);
  console.log(`  ACP_KEK_VERSION=${result.toVersion}`);
  console.log(`\nKeep the OLD KEK file until you have confirmed the bot starts and reads secrets correctly with the new one -- do not delete it immediately.`);
}

// Guarded so this file can be imported for direct unit testing of the
// exported functions above without also running the full CLI flow --
// matches this repo's own established pattern (see reencrypt-secrets.js).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`rotate-keys.js failed: ${error.message}`);
    process.exit(1);
  }
}
