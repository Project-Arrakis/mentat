#!/usr/bin/env node
//
// reencrypt-secrets.js -- Bulk re-encrypt plaintext secrets at rest.
//
// PR #80 shipped AES-256-GCM encryption for guilds.adapter_token and
// oauth_sessions.access_token, but existing rows are only re-encrypted on
// their next write (issue #90). The documented option -- ask each
// connected operator to re-run their setup flow -- puts the burden on
// real people for data the bot itself has the key to fix. This script
// closes that gap: it walks every row, round-trips it through
// decryptSecret() (which is a transparent no-op for plaintext), and
// rewrites it encrypted under the currently configured ACP_SECRETS_KEY.
//
// Usage (run against production, from the repo root, with the same env as
// the running bot):
//   set -a && . ./.env && set +a
//   node scripts/reencrypt-secrets.js [--db path/to/acp.db] [--dry-run]
//
// Exit codes: 0 = success, 1 = failure (no rows modified on failure).
//
// The key used must match the one the bot is configured with, otherwise
// the encrypted rows it writes here cannot be read back by the bot.

import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "../src/secretsCrypto.js";

const ENCRYPTED_PREFIX = "enc:v1:";
const TABLES = [
  { table: "guilds", keyColumns: ["guild_id"], valueColumn: "adapter_token" },
  { table: "oauth_sessions", keyColumns: ["state"], valueColumn: "access_token" }
];

// Core migration logic, exported for tests. Returns a per-table summary.
// When dryRun is true, counts are reported but no row is modified.
export function reencryptColumn(db, { table, keyColumns, valueColumn }, { dryRun = false, env = process.env } = {}) {
  const keyCols = keyColumns.map((c) => `"${c}"`).join(", ");
  const rows = db.prepare(
    `SELECT ${keyCols}, "${valueColumn}" AS v FROM "${table}" WHERE "${valueColumn}" IS NOT NULL AND "${valueColumn}" != ''`
  ).all();

  let changed = 0;
  let skipped = 0;
  for (const row of rows) {
    const stored = row.v;
    // Round-tripping plaintext through decryptSecret() returns it unchanged,
    // so detecting "already encrypted" is a prefix check on the stored value
    // rather than a decrypt-then-re-encrypt-equality compare. Do the check
    // BEFORE decryptSecret() so a row tagged enc:v1: but malformed (e.g.
    // truncated by a bad write) is skipped without crashing the whole
    // migration -- it is not something this script can fix.
    if (typeof stored === "string" && stored.startsWith(ENCRYPTED_PREFIX)) {
      skipped += 1;
      continue;
    }
    const plain = decryptSecret(stored, env);
    const re = encryptSecret(plain, env);
    if (re === stored) {
      skipped += 1;
      continue;
    }
    changed += 1;
    if (!dryRun) {
      const where = keyColumns.map((c) => `"${c}" = ?`).join(" AND ");
      db.prepare(`UPDATE "${table}" SET "${valueColumn}" = ? WHERE ${where}`).run(re, ...keyColumns.map((c) => row[c]));
    }
  }
  return { table, total: rows.length, changed, skipped };
}

export async function runReencrypt(dbPath, { dryRun = false, key = process.env.ACP_SECRETS_KEY, keyFile = process.env.ACP_SECRETS_KEY_FILE, backup = true } = {}) {
  if (key === undefined && keyFile === undefined) {
    keyFile = undefined;
  }
  const env = {};
  if (key !== undefined) env.ACP_SECRETS_KEY = key;
  if (keyFile !== undefined) env.ACP_SECRETS_KEY_FILE = keyFile;

  const keyConfigured = isEncryptionConfigured(env);
  if (!keyConfigured) {
    throw new Error(
      "no ACP_SECRETS_KEY / ACP_SECRETS_KEY_FILE set. " +
      "Refusing to write rows the bot could not read back. " +
      "Set the key in .env exactly as the running bot uses it, then re-run."
    );
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  let changedTotal = 0;
  const summaries = [];
  for (const t of TABLES) {
    const summary = reencryptColumn(db, t, { dryRun, env });
    summaries.push(summary);
    changedTotal += summary.changed;
  }

  if (!dryRun && backup && changedTotal > 0) {
    const backupPath = `${dbPath}.pre-reencrypt-${new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19)}`;
    try {
      await db.backup(backupPath);
      db.pragma("journal_mode = WAL");
    } catch (error) {
      db.close();
      throw new Error(`WAL-consistent backup failed before any rows were committed: ${error.message}`);
    }
  }

  db.close();
  return { summaries, changedTotal, dryRun };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const dbPath = (() => {
    const i = args.indexOf("--db");
    return i >= 0 && args[i + 1] ? args[i + 1] : process.env.ACP_DB_PATH || "data/acp.db";
  })();

  let result;
  try {
    result = await runReencrypt(dbPath, { dryRun });
  } catch (error) {
    console.error(`[reencrypt] ABORT: ${error.message}`);
    process.exit(1);
  }

  for (const s of result.summaries) {
    console.log(`[reencrypt] ${s.table}: total=${s.total} re-encrypted=${s.changed} alreadyEncrypted=${s.skipped}${dryRun ? " (dry-run)" : ""}`);
  }
  if (result.changedTotal === 0 && !dryRun) {
    console.log("[reencrypt] nothing to do -- all secrets already encrypted.");
  }
  console.log(dryRun ? "[reencrypt] dry-run summary above; nothing modified." : `[reencrypt] done. re-encrypted=${result.changedTotal}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[reencrypt] aborting: ${err.message}`);
    process.exitCode = 1;
  });
}
