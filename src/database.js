import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA_VERSION = 3;

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

-- audit_log: append-only record of every destructive/state-changing
-- command attempt (write:*, admin:broadcast, player:link/unlink/enable/
-- disable/default/faction) regardless of outcome (success, denied,
-- failed, scaffold-only). See docs/audit-log-design.md for the full
-- design and docs/audit-log-security-review.md for FINDING-AUDIT-*.
--
-- guild_id is intentionally NOT a foreign key to guilds(guild_id) --
-- single-tenant deployments (the majority of real installs) never
-- populate the guilds table at all (it's only written by onboarding.js/
-- setupServer.js, both multi-tenant-only code paths), so an FK here
-- would make every single-tenant audit write fail. guild_id is simply
-- an empty string in single-tenant mode, matching guild_settings'
-- existing convention for optional/inapplicable text fields elsewhere
-- in this schema.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'discord-command',
  guild_id TEXT NOT NULL DEFAULT '',
  discord_user_id TEXT NOT NULL DEFAULT '',
  discord_username TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  capability TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'unknown' CHECK(result IN ('success', 'denied', 'failed', 'pending', 'unknown')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guild_roles_guild ON guild_roles(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_roles_type ON guild_roles(guild_id, role_type);
CREATE INDEX IF NOT EXISTS idx_player_links_guild_user ON player_links(guild_id, discord_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_guild ON audit_log(guild_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_command ON audit_log(command);
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
  if (currentVersion && currentVersion.version < 3) {
    // audit_log is a brand-new table, not a new column on an existing
    // one -- CREATE TABLE IF NOT EXISTS in the schema above already
    // handles this idempotently for both fresh and pre-existing
    // databases, so there's no ALTER TABLE needed here. Just advance the
    // version marker.
    db.prepare("UPDATE schema_version SET version = 3").run();
  }

  return db;
}

export function getGuild(db, guildId) {
  return db.prepare("SELECT * FROM guilds WHERE guild_id = ?").get(guildId);
}

export function upsertGuild(db, { guildId, guildName, consoleUrl, adapterToken, status = "pending" }) {
  const existing = getGuild(db, guildId);
  if (existing) {
    db.prepare(`
      UPDATE guilds SET
        guild_name = ?,
        console_url = ?,
        adapter_token = ?,
        status = ?,
        updated_at = datetime('now')
      WHERE guild_id = ?
    `).run(guildName, consoleUrl, adapterToken, status, guildId);
  } else {
    db.prepare(`
      INSERT INTO guilds (guild_id, guild_name, console_url, adapter_token, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, guildName, consoleUrl, adapterToken, status);

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

export function getOauthSession(db, state) {
  return db.prepare("SELECT * FROM oauth_sessions WHERE state = ?").get(state);
}

export function updateOauthSession(db, state, { accessToken, expiresAt }) {
  db.prepare(`
    UPDATE oauth_sessions SET access_token = ?, expires_at = ? WHERE state = ?
  `).run(accessToken, expiresAt, state);
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

// insertAuditLog: append-only write, never updates or deletes an existing
// row (matching an audit trail's core property -- once written, a record
// is never silently altered). `detail` is JSON.stringify'd before storage;
// callers are responsible for redacting anything sensitive from `detail`
// BEFORE calling this function (see src/auditLog.js's buildAuditDetail()
// helper, which applies format.js's existing redactSecrets()) -- this
// function does not redact on your behalf, so a caller that skips that
// step would persist unredacted data permanently.
export function insertAuditLog(db, {
  source = "discord-command", guildId = "", discordUserId = "", discordUsername = "",
  channelId = "", command = "", action = "", capability = "", idempotencyKey = "",
  result = "unknown", detail = {}
} = {}) {
  db.prepare(`
    INSERT INTO audit_log (
      source, guild_id, discord_user_id, discord_username, channel_id,
      command, action, capability, idempotency_key, result, detail
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(source || "discord-command"),
    String(guildId || ""),
    String(discordUserId || ""),
    String(discordUsername || ""),
    String(channelId || ""),
    String(command || ""),
    String(action || ""),
    String(capability || ""),
    String(idempotencyKey || ""),
    String(result || "unknown"),
    JSON.stringify(detail || {})
  );
}

// getAuditLog: read-only query, newest first, capped at `limit` (default
// 50, hard max 200 to bound a single Discord embed/response). guildId
// filters to a single guild's records when provided (multi-tenant mode);
// pass null/undefined to return across all guilds (matches single-tenant
// mode's convention elsewhere in this file of using an empty-string
// guild_id for "not applicable").
export function getAuditLog(db, { guildId = null, limit = 50 } = {}) {
  // Number(limit) || 50 would silently treat a caller-supplied 0 as "use
  // the default" (0 is falsy in JS), not "clamp to the floor of 1" --
  // checked explicitly with Number.isFinite() instead so limit:0 and
  // other falsy-but-numeric inputs are still floored correctly rather
  // than surprising a caller who explicitly asked for 0.
  const parsedLimit = Number(limit);
  const cappedLimit = Math.max(1, Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 200));
  const rows = guildId
    ? db.prepare("SELECT * FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?").all(String(guildId), cappedLimit)
    : db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(cappedLimit);
  return rows.map((row) => ({ ...row, detail: safeParseJson(row.detail) }));
}

// pruneAuditLog: deletes audit rows older than `maxAgeMs` (default 14
// days, matching this feature's retention decision -- see
// docs/audit-log-design.md's Retention section). Returns the number of
// rows deleted. Called on a periodic timer from index.js, matching
// statsPusher.js's own setInterval+unref() convention for background
// maintenance tasks -- not on every command execution, since pruning is
// a maintenance concern independent of any single request.
export function pruneAuditLog(db, maxAgeMs = 14 * 24 * 60 * 60 * 1000) {
  const cutoffIso = new Date(Date.now() - maxAgeMs).toISOString();
  // audit_log.created_at is stored via SQLite's datetime('now') (UTC,
  // "YYYY-MM-DD HH:MM:SS" format, no "Z"/timezone suffix) -- compare
  // against an equivalently-formatted cutoff rather than the ISO-with-Z
  // string cutoffIso would otherwise produce, since SQLite's string
  // comparison of these two formats would not sort correctly.
  const cutoff = cutoffIso.replace("T", " ").replace(/\.\d+Z$/, "");
  const result = db.prepare("DELETE FROM audit_log WHERE created_at < ?").run(cutoff);
  return result.changes;
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
