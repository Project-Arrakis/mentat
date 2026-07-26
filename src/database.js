import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { encryptSecret, decryptSecret } from "./secretsCrypto.js";

const SCHEMA_VERSION = 2;

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
  admin_cooldown_ms INTEGER NOT NULL DEFAULT 1000,
  faction TEXT NOT NULL DEFAULT '' CHECK(faction IN ('', 'atreides', 'harkonnen', 'fremen'))
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

function ensureDataDir(dbPath) {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function createDatabase(dbPath = "./data/acp.db") {
  ensureDataDir(dbPath);

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(SCHEMA);

  const currentVersion = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
  if (!currentVersion) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  } else if (currentVersion.version < 2) {
    try {
      db.prepare("ALTER TABLE guild_settings ADD COLUMN faction TEXT NOT NULL DEFAULT '' CHECK(faction IN ('', 'atreides', 'harkonnen', 'fremen'))").run();
      db.prepare("UPDATE schema_version SET version = 2").run();
    } catch {
      // Column may already exist from a previous migration attempt
    }
  }

  return db;
}

// adapter_token is a credential (not player data): it authenticates this
// bot process to a specific operator's Core adapter API. In
// ACP_MULTI_TENANT mode, one shared guilds table holds one row per
// connected operator, so this column is encrypted at rest (see
// secretsCrypto.js) -- a single compromise of the SQLite file should not
// hand over every connected operator's adapter credential at once.
// getGuild() transparently decrypts; every existing caller (index.js,
// onboarding.js) continues to receive a plain adapterToken string exactly
// as before.
export function getGuild(db, guildId) {
  const row = db.prepare("SELECT * FROM guilds WHERE guild_id = ?").get(guildId);
  if (!row) return row;
  return { ...row, adapter_token: decryptSecret(row.adapter_token) };
}

export function upsertGuild(db, { guildId, guildName, consoleUrl, adapterToken, status = "pending" }) {
  const encryptedToken = encryptSecret(adapterToken);
  // Compare against the raw stored row, not the decrypting getGuild(), so
  // an UPDATE vs INSERT decision never depends on successfully decrypting
  // an existing row (e.g. after a key rotation where old rows can't be
  // read back yet -- this must still be able to overwrite them).
  const existing = db.prepare("SELECT guild_id FROM guilds WHERE guild_id = ?").get(guildId);
  if (existing) {
    db.prepare(`
      UPDATE guilds SET
        guild_name = ?,
        console_url = ?,
        adapter_token = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE guild_id = ?
    `).run(guildName, consoleUrl, encryptedToken, status, guildId);
  } else {
    db.prepare(`
      INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, guildName, consoleUrl, encryptedToken, status);

    db.prepare(`
      INSERT OR IGNORE INTO guild_settings (guild_id)
      VALUES (?)
    `).run(guildId);
  }
}

export function getGuildSettings(db, guildId) {
  return db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get(guildId);
}

export function updateGuildSettings(db, guildId, settings) {
  const fields = Object.keys(settings).filter(k => k !== "guild_id");
  if (fields.length === 0) return;

  const setClause = fields.map(f => `${f} = ?`).join(", ");
  const values = fields.map(f => settings[f]);
  values.push(guildId);

  db.prepare(`UPDATE guild_settings SET ${setClause} WHERE guild_id = ?`).run(...values);
}

export function getGuildRoles(db, guildId) {
  return db.prepare("SELECT * FROM guild_roles WHERE guild_id = ?").all(guildId);
}

export function addGuildRole(db, guildId, roleType, roleId) {
  db.prepare(`
    INSERT OR IGNORE INTO guild_roles (guild_id, role_type, role_id)
    VALUES (?, ?, ?)
  `).run(guildId, roleType, roleId);
}

export function removeGuildRole(db, guildId, roleType, roleId) {
  db.prepare(`
    DELETE FROM guild_roles WHERE guild_id = ? AND role_type = ? AND role_id = ?
  `).run(guildId, roleType, roleId);
}

export function getGuildRoleIds(db, guildId, roleType) {
  return db.prepare("SELECT role_id FROM guild_roles WHERE guild_id = ? AND role_type = ?")
    .all(guildId, roleType)
    .map(r => r.role_id);
}

export function createOauthSession(db, { state, discordUserId, discordUsername, guildId = "" }) {
  db.prepare(`
    INSERT INTO oauth_sessions (state, discord_user_id, discord_username, guild_id)
    VALUES (?, ?, ?, ?)
  `).run(state, discordUserId, discordUsername, guildId);
}

// access_token is a live Discord OAuth token captured during the setup
// wizard flow. It is short-lived (expires_at is checked by callers) but
// still a real bearer credential for that Discord user's account, so it
// is encrypted at rest for the same reason adapter_token is -- see the
// comment on getGuild()/upsertGuild() above.
export function getOauthSession(db, state) {
  const row = db.prepare("SELECT * FROM oauth_sessions WHERE state = ?").get(state);
  if (!row) return row;
  return { ...row, access_token: decryptSecret(row.access_token) };
}

export function updateOauthSession(db, state, { accessToken, expiresAt }) {
  db.prepare(`
    UPDATE oauth_sessions SET access_token = ?, expires_at = ? WHERE state = ?
  `).run(encryptSecret(accessToken), expiresAt, state);
}

export function deleteOauthSession(db, state) {
  db.prepare("DELETE FROM oauth_sessions WHERE state = ?").run(state);
}

export function getPlayerLink(db, guildId, discordUserId) {
  return db.prepare("SELECT * FROM player_links WHERE guild_id = ? AND discord_user_id = ?")
    .get(guildId, discordUserId);
}

export function upsertPlayerLink(db, { guildId, discordUserId, characterName, playerControllerId, playerPawnId }) {
  db.prepare(`
    INSERT INTO player_links (guild_id, discord_user_id, character_name, player_controller_id, player_pawn_id)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET
      character_name = excluded.character_name,
      player_controller_id = excluded.player_controller_id,
      player_pawn_id = excluded.player_pawn_id,
      linked_at = datetime('now')
  `).run(guildId, discordUserId, characterName, playerControllerId, playerPawnId);
}

export function deletePlayerLink(db, guildId, discordUserId) {
  db.prepare("DELETE FROM player_links WHERE guild_id = ? AND discord_user_id = ?")
    .run(guildId, discordUserId);
}

export function getAllGuilds(db) {
  return db.prepare("SELECT * FROM guilds").all();
}

export function getActiveGuilds(db) {
  return db.prepare("SELECT * FROM guilds WHERE status = 'active'").all();
}

export function initBotStats(db) {
  db.prepare("INSERT OR IGNORE INTO bot_stats (key, value) VALUES ('commands_total', 0)").run();
}

export function incrementCommandCount(db) {
  db.prepare("UPDATE bot_stats SET value = value + 1 WHERE key = 'commands_total'").run();
}

export function getCommandCount(db) {
  const row = db.prepare("SELECT value FROM bot_stats WHERE key = 'commands_total'").get();
  return row ? row.value : 0;
}

export function getBotStats(db) {
  return db.prepare("SELECT key, value FROM bot_stats").all();
}

export function getGuildFaction(db, guildId) {
  const row = db.prepare("SELECT faction FROM guild_settings WHERE guild_id = ?").get(guildId);
  return row?.faction || "";
}

export function setGuildFaction(db, guildId, faction) {
  db.prepare("UPDATE guild_settings SET faction = ? WHERE guild_id = ?").run(faction, guildId);
}
