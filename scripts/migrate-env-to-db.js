#!/usr/bin/env node
/**
 * migrate-env-to-db.js
 *
 * Reads guild configuration from .env and seeds the SQLite database
 * for multi-tenant mode. Run once when migrating from single-server
 * to multi-tenant mode.
 *
 * Usage: node scripts/migrate-env-to-db.js
 *
 * Reads these env vars:
 *   DISCORD_GUILD_ID, DUNE_CONSOLE_API_URL
 *   DISCORD_OBSERVER_ROLE_IDS, DISCORD_ADMIN_ROLE_IDS
 *   DUNE_POST_SCHEDULE_TYPE, DUNE_POST_ALLOWED_CHANNELS, DUNE_SCHEDULER_INTERVAL_MS
 *   ACP_DB_PATH (defaults to ./data/acp.db)
 */

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  guild_name TEXT NOT NULL DEFAULT '',
  console_url TEXT NOT NULL DEFAULT '',
  adapter_token TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guild_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  role_type TEXT NOT NULL CHECK(role_type IN ('observer', 'admin', 'owner', 'moderator')),
  role_id TEXT NOT NULL,
  UNIQUE(guild_id, role_type, role_id)
);

CREATE TABLE IF NOT EXISTS guild_settings (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
  rbac_mode TEXT NOT NULL DEFAULT 'restricted' CHECK(rbac_mode IN ('restricted', 'open')),
  default_ephemeral INTEGER NOT NULL DEFAULT 1,
  schedule_type TEXT NOT NULL DEFAULT 'none',
  schedule_channel TEXT NOT NULL DEFAULT '',
  schedule_interval_ms INTEGER NOT NULL DEFAULT 1800000,
  announcements_enabled INTEGER NOT NULL DEFAULT 0,
  announcements_channel TEXT NOT NULL DEFAULT '',
  cooldown_ms INTEGER NOT NULL DEFAULT 5000,
  admin_cooldown_ms INTEGER NOT NULL DEFAULT 1000
);

CREATE TABLE IF NOT EXISTS oauth_sessions (
  state TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT NOT NULL DEFAULT '',
  guild_id TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS player_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  character_name TEXT NOT NULL DEFAULT '',
  player_controller_id TEXT NOT NULL DEFAULT '',
  player_pawn_id TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(guild_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS bot_stats (
  key TEXT PRIMARY KEY,
  value INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_guild_roles_guild ON guild_roles(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_roles_type ON guild_roles(guild_id, role_type);
CREATE INDEX IF NOT EXISTS idx_player_links_guild_user ON player_links(guild_id, discord_user_id);
`;

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function loadEnv(filePath) {
  if (!existsSync(filePath)) {
    console.error(`❌ .env file not found: ${filePath}`);
    process.exit(1);
  }

  const env = {};
  const lines = readFileSync(filePath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.substring(0, eqIndex).trim();
    const value = trimmed.substring(eqIndex + 1).trim();
    env[key] = value;
  }
  return env;
}

function readSecretFile(env, valueName, fileName) {
  const directValue = env[valueName];
  if (directValue) return directValue;

  const filePath = env[fileName];
  if (!filePath) return "";
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function main() {
  const envFile = process.env.ENV_FILE || ".env";
  const env = loadEnv(envFile);

  const guildId = env.DISCORD_GUILD_ID || env.ACP_GUILD_ID;
  if (!guildId) {
    console.error("❌ DISCORD_GUILD_ID not found in .env — nothing to migrate.");
    process.exit(1);
  }

  const consoleUrl = env.DUNE_CONSOLE_API_URL;
  if (!consoleUrl) {
    console.error("❌ DUNE_CONSOLE_API_URL not found in .env — nothing to migrate.");
    process.exit(1);
  }

  const adapterToken = readSecretFile(env, "DUNE_DISCORD_ADAPTER_TOKEN", "DUNE_DISCORD_ADAPTER_TOKEN_FILE");
  const observerRoleIds = parseCsv(env.DISCORD_OBSERVER_ROLE_IDS);
  const adminRoleIds = parseCsv(env.DISCORD_ADMIN_ROLE_IDS);
  const rbacMode = env.DISCORD_RBAC_MODE || "restricted";
  const scheduleType = env.DUNE_POST_SCHEDULE_TYPE || "none";
  const scheduleChannels = parseCsv(env.DUNE_POST_ALLOWED_CHANNELS);
  const scheduleIntervalMs = Number.parseInt(env.DUNE_SCHEDULER_INTERVAL_MS || "1800000", 10) || 1800000;
  const cooldownMs = Number.parseInt(env.DUNE_COOLDOWN_MS || "5000", 10) || 5000;
  const adminCooldownMs = Number.parseInt(env.DUNE_ADMIN_COOLDOWN_MS || "1000", 10) || 1000;

  const dbPath = env.ACP_DB_PATH || "data/acp.db";
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  console.log("📦 Creating database at:", dbPath);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const currentVersion = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
  if (!currentVersion) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(1);
  }

  console.log("🏰 Migrating guild:", guildId);

  db.prepare(`
    INSERT OR REPLACE INTO guilds (guild_id, guild_name, console_url, adapter_token, status)
    VALUES (?, ?, ?, ?, 'active')
  `).run(guildId, "Migrated Guild", consoleUrl, adapterToken);

  db.prepare(`
    INSERT OR IGNORE INTO guild_settings (guild_id)
    VALUES (?)
  `).run(guildId);

  db.prepare(`
    UPDATE guild_settings SET
      rbac_mode = ?,
      schedule_type = ?,
      schedule_channel = ?,
      schedule_interval_ms = ?,
      cooldown_ms = ?,
      admin_cooldown_ms = ?
    WHERE guild_id = ?
  `).run(
    rbacMode,
    scheduleType,
    scheduleChannels[0] || "",
    scheduleIntervalMs,
    cooldownMs,
    adminCooldownMs,
    guildId
  );

  for (const roleId of observerRoleIds) {
    db.prepare(`
      INSERT OR IGNORE INTO guild_roles (guild_id, role_type, role_id)
      VALUES (?, 'observer', ?)
    `).run(guildId, roleId);
    console.log("  👁️  Observer role:", roleId);
  }

  for (const roleId of adminRoleIds) {
    db.prepare(`
      INSERT OR IGNORE INTO guild_roles (guild_id, role_type, role_id)
      VALUES (?, 'admin', ?)
    `).run(guildId, roleId);
    console.log("  🔧 Admin role:", roleId);
  }

  db.prepare("INSERT OR IGNORE INTO bot_stats (key, value) VALUES ('commands_total', 0)").run();

  db.close();

  console.log("");
  console.log("✅ Migration complete!");
  console.log("");
  console.log("Next steps:");
  console.log("  1. Set ACP_MULTI_TENANT=true in .env");
  console.log("  2. Set ACP_DB_PATH=" + dbPath + " in .env");
  console.log("  3. Remove DISCORD_GUILD_ID, DISCORD_OBSERVER_ROLE_IDS, DISCORD_ADMIN_ROLE_IDS from .env");
  console.log("  4. Set ACP_BASE_URL and ACP_OAUTH_REDIRECT_URI for the setup portal");
  console.log("  5. Set DISCORD_CLIENT_SECRET for OAuth2");
  console.log("  6. Restart the bot");
}

main();
