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

import { readFileSync, existsSync } from "node:fs";
import { createDatabase } from "../src/database.js";

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

  console.log("📦 Creating database at:", dbPath);
  // Uses the real, current schema from src/database.js instead of a
  // hand-rolled copy (Layer 3 /code-review ultra nit, mentat#276/#277):
  // this script previously carried its own stale SCHEMA constant that
  // still created oauth_sessions/player_links/bot_stats -- three tables
  // the v6->v7 hardening migration drops the very next time the real bot
  // starts against the resulting database, making this script's own
  // output (and its bot_stats seed row below) immediately wrong. Calling
  // createDatabase() directly means this script can never drift from the
  // real schema again, on this or any future migration.
  const db = createDatabase(dbPath);

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

  // No bot_stats seed: it's an in-memory-only vanity counter as of schema
  // v7 (see src/database.js's "Schema hardening (v7)" comment) -- there
  // is no table to seed, and commandCount already starts at 0.

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
