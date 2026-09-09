#!/usr/bin/env node
//
// rollback-v7-schema.js -- Manual recovery tool for downgrading a mentat
// database from schema v7 back to schema v6 (Requirement 26).
//
// The v6->v7 hardening migration (5516a6b) drops six tables
// (player_links, guild_member_activity, oauth_sessions, bot_stats,
// stats_snapshot, guild_stats_snapshot) the first time a v7-aware bot
// starts against an older database. That migration only ever runs
// forward -- createDatabase() has no downgrade path -- so an operator who
// upgrades to a v7 release and then needs to roll the *bot's code* back
// to a pre-v7 release (for an unrelated regression, say) would otherwise
// hit "no such table" errors the moment old code queries any of the six.
//
// This script recreates those six tables' pre-v7 shape and resets
// schema_version to 6, so old code can run against the database again.
//
// IMPORTANT: this restores SCHEMA SHAPE ONLY, not data. Whatever rows
// existed in those six tables at the time the v6->v7 migration dropped
// them are gone -- this cannot bring them back. See
// src/database.js's rollbackSchemaV7ToV6() doc comment and
// compliance/runbooks/backup-recovery.md for what's actually recoverable
// (a backup taken before the v6->v7 migration ran) versus what isn't
// (anything only ever available via THIS script).
//
// Usage:
//   node scripts/rollback-v7-schema.js [--db path/to/acp.db] [--dry-run]
//
// Exit codes: 0 = success (or dry-run), 1 = failure / refused.

import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { rollbackSchemaV7ToV6 } from "../src/database.js";

export function runRollback(dbPath, { dryRun = false } = {}) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'").get();
  if (!hasTable) {
    db.close();
    throw new Error(`${dbPath} has no schema_version table -- this doesn't look like a mentat database. Refusing to guess its state.`);
  }
  const before = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
  if (!before) {
    db.close();
    throw new Error(`${dbPath} has no schema_version row -- refusing to guess this database's state.`);
  }
  if (before.version !== 7) {
    db.close();
    throw new Error(`${dbPath} is at schema_version ${before.version}, not 7 -- this script only rolls back a v7 database to v6.`);
  }

  if (dryRun) {
    db.close();
    return { dryRun: true, before: before.version, after: before.version };
  }

  rollbackSchemaV7ToV6(db);
  const after = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
  db.close();
  return { dryRun: false, before: before.version, after: after.version };
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
    result = runRollback(dbPath, { dryRun });
  } catch (error) {
    console.error(`[rollback-v7-schema] ABORT: ${error.message}`);
    process.exit(1);
  }

  if (result.dryRun) {
    console.log(`[rollback-v7-schema] dry-run: ${dbPath} is at schema_version 7 and would be rolled back to 6. Nothing modified.`);
    console.log("[rollback-v7-schema] reminder: this restores table SHAPE only, not the data those tables held before the v6->v7 migration dropped them.");
    return;
  }

  console.log(`[rollback-v7-schema] ${dbPath}: schema_version ${result.before} -> ${result.after}. Six pre-v7 tables recreated empty.`);
  console.log("[rollback-v7-schema] reminder: this restored table SHAPE only, not data -- see compliance/runbooks/backup-recovery.md for real data recovery.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`[rollback-v7-schema] aborting: ${err.message}`);
    process.exitCode = 1;
  });
}
