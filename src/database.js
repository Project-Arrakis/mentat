import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { encryptWithDEK, decryptWithDEK, activeKeyVersion } from "./secretsCrypto.js";

const SCHEMA_VERSION = 4;

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

-- Local live-stats snapshot, replacing the Cloudflare KV
-- acp-stats-aggregate write (issue #83.2 / kv-replacement-evaluation).
-- Single row (id is pinned to 1); statsPusher.js upserts it on its push
-- interval and setupServer.js serves it as GET /api/live-stats behind
-- the existing free Cloudflare Tunnel (no KV involved). Schema change is
-- additive-only (CREATE TABLE IF NOT EXISTS); existing operators' DBs
-- gain this table on next start, no data migration required.
CREATE TABLE IF NOT EXISTS stats_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- KEK/DEK hierarchy (schema v4, Phase 1 of the ecosystem-wide secrets
-- management epic -- see docs/design/pki-cmk-secrets-l1-design-audit-2026-08-08.md,
-- issues #107/#108/#109). Purely additive (CREATE TABLE IF NOT EXISTS);
-- existing operators' databases gain these three empty tables on next
-- start with zero data migration required, and every row remains
-- readable exactly as before (see secretsCrypto.js's decryptWithDEK(),
-- which transparently falls back to v1 single-key decryption for any
-- row that isn't v2-tagged).
--
-- key_versions: one row per KEK ever activated. Rotating the KEK
-- inserts a new row and marks the previous one retired_at (but never
-- deletes it -- old DEKs wrapped under a retired KEK must remain
-- unwrappable until every row using that version has been re-wrapped,
-- see rotate-keys.js).
CREATE TABLE IF NOT EXISTS key_versions (
  version INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  retired_at TEXT
);

-- secret_keys: the wrapped (KEK-encrypted) DEK for one specific
-- encrypted row/column, keyed by (table_name, row_key, column_name) so
-- one guild's adapter_token and one oauth_session's access_token each
-- get their own independent DEK -- compromising one wrapped DEK (or the
-- KEK used to unwrap it, absent the age identity) exposes only that one
-- row, not every secret in the database. row_key is stored as TEXT so
-- it can hold guilds.guild_id or oauth_sessions.state, both TEXT primary
-- keys, without a separate column per table.
CREATE TABLE IF NOT EXISTS secret_keys (
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  column_name TEXT NOT NULL,
  wrapped_dek TEXT NOT NULL,
  key_version INTEGER NOT NULL REFERENCES key_versions(version),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (table_name, row_key, column_name)
);

-- secret_access_log: append-only audit trail (GRC-2, issue #111) of
-- every decrypt/encrypt/rotate event against a KEK/DEK-protected
-- secret. Deliberately does NOT store the secret value itself, the DEK,
-- or the KEK -- only which row was touched, by which operation, and
-- when. event must be one of a fixed set so a bug elsewhere can't
-- silently write an unrecognized, unqueryable event name into this
-- table.
CREATE TABLE IF NOT EXISTS secret_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_key TEXT NOT NULL,
  column_name TEXT NOT NULL,
  event TEXT NOT NULL CHECK(event IN ('encrypt', 'decrypt', 'rotate', 'decrypt_failed')),
  key_version INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_secret_access_log_row ON secret_access_log(table_name, row_key, column_name);
CREATE INDEX IF NOT EXISTS idx_secret_access_log_created ON secret_access_log(created_at);
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

  if (currentVersion && currentVersion.version < SCHEMA_VERSION) {
    // v3->v4 and v4 itself are purely additive (stats_snapshot,
    // key_versions/secret_keys/secret_access_log all via CREATE TABLE IF
    // NOT EXISTS in SCHEMA above) -- nothing to migrate, just record the
    // version. Existing enc:v1: rows remain readable unchanged; they are
    // only ever upgraded to v2 (per-row DEK) on their next write, exactly
    // like the v0(plaintext)->v1 migration this same pattern already
    // established (see reencrypt-secrets.js for the equivalent bulk-
    // upgrade tool for that earlier transition).
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }

  return db;
}

// adapter_token is a credential (not player data): it authenticates this
// bot process to a specific operator's Core adapter API. In
// ── KEK/DEK per-row secret helpers (schema v4, issues #107/#108/#109) ──
//
// secret_keys holds the wrapped DEK for one (table, row, column) triple.
// These helpers centralize that lookup/write so getGuild()/upsertGuild()/
// getOauthSession()/updateOauthSession() below don't each reimplement the
// same three-column primary key logic. Every call is a no-op (wrappedDEK
// stays null, nothing is written) when no KEK is configured -- see
// secretsCrypto.js's encryptWithDEK(), which itself falls back to v1
// single-key encryption in that case.
function getWrappedDEK(db, tableName, rowKey, columnName) {
  const row = db.prepare(
    "SELECT wrapped_dek, key_version FROM secret_keys WHERE table_name = ? AND row_key = ? AND column_name = ?"
  ).get(tableName, rowKey, columnName);
  return row || null;
}

function putWrappedDEK(db, tableName, rowKey, columnName, wrappedDEK, keyVersion) {
  db.prepare(
    "INSERT INTO key_versions (version) VALUES (?) ON CONFLICT(version) DO NOTHING"
  ).run(keyVersion);
  db.prepare(`
    INSERT INTO secret_keys (table_name, row_key, column_name, wrapped_dek, key_version)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(table_name, row_key, column_name) DO UPDATE SET
      wrapped_dek = excluded.wrapped_dek,
      key_version = excluded.key_version,
      created_at = datetime('now')
  `).run(tableName, rowKey, columnName, wrappedDEK, keyVersion);
}

// logSecretAccess() is best-effort: a logging failure must never block the
// actual encrypt/decrypt operation it's describing (an audit trail that
// can crash the feature it's auditing is worse than no audit trail).
function logSecretAccess(db, tableName, rowKey, columnName, event, keyVersion = null) {
  try {
    db.prepare(`
      INSERT INTO secret_access_log (table_name, row_key, column_name, event, key_version)
      VALUES (?, ?, ?, ?, ?)
    `).run(tableName, rowKey, columnName, event, keyVersion);
  } catch {
    // Never let audit logging break the caller's real operation.
  }
}

// Encrypts a value for storage using the per-row DEK hierarchy when a KEK
// is configured, or the legacy v1 single-key path otherwise (see
// encryptWithDEK()'s own fallback). Persists the wrapped DEK to
// secret_keys when one is produced, and records the event in
// secret_access_log either way.
function encryptColumn(db, tableName, rowKey, columnName, plaintext) {
  const { ciphertext, wrappedDEK } = encryptWithDEK(plaintext);
  if (wrappedDEK) {
    const version = activeKeyVersion() || 1;
    putWrappedDEK(db, tableName, rowKey, columnName, wrappedDEK, version);
    logSecretAccess(db, tableName, rowKey, columnName, "encrypt", version);
  } else {
    logSecretAccess(db, tableName, rowKey, columnName, "encrypt");
  }
  return ciphertext;
}

// Decrypts a value previously written by encryptColumn(). Looks up the
// wrapped DEK for this row (if any -- v1-encrypted rows have none) and
// delegates to decryptWithDEK(), which transparently handles both v1 and
// v2 ciphertext formats. Logs decrypt/decrypt_failed either way so a
// pattern of failed decrypts (e.g. after a botched key rotation) is
// visible in the audit trail, not just an exception the caller happens
// to catch.
function decryptColumn(db, tableName, rowKey, columnName, stored) {
  const keyRow = getWrappedDEK(db, tableName, rowKey, columnName);
  try {
    const plaintext = decryptWithDEK(stored, keyRow ? keyRow.wrapped_dek : null);
    logSecretAccess(db, tableName, rowKey, columnName, "decrypt", keyRow ? keyRow.key_version : null);
    return plaintext;
  } catch (error) {
    logSecretAccess(db, tableName, rowKey, columnName, "decrypt_failed", keyRow ? keyRow.key_version : null);
    throw error;
  }
}

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
  return { ...row, adapter_token: decryptColumn(db, "guilds", guildId, "adapter_token", row.adapter_token) };
}

export function upsertGuild(db, { guildId, guildName, consoleUrl, adapterToken, status = "pending" }) {
  const encryptedToken = encryptColumn(db, "guilds", guildId, "adapter_token", adapterToken);
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
  return { ...row, access_token: decryptColumn(db, "oauth_sessions", state, "access_token", row.access_token) };
}

export function updateOauthSession(db, state, { accessToken, expiresAt }) {
  const encryptedToken = encryptColumn(db, "oauth_sessions", state, "access_token", accessToken);
  db.prepare(`
    UPDATE oauth_sessions SET access_token = ?, expires_at = ? WHERE state = ?
  `).run(encryptedToken, expiresAt, state);
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

// Local live-stats snapshot (replaces the Cloudflare KV
// acp-stats-aggregate write). Single-row table, id pinned to 1.
// statsPusher.js calls saveStatsSnapshot on its push interval;
// setupServer.js serves the stored payload as GET /api/live-stats.
export function saveStatsSnapshot(db, stats) {
  const payload = JSON.stringify(stats);
  db.prepare(
    "INSERT INTO stats_snapshot (id, payload, updated_at) VALUES (1, ?, datetime('now')) " +
    "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at"
  ).run(payload);
}

export function getStatsSnapshot(db) {
  const row = db.prepare("SELECT payload FROM stats_snapshot WHERE id = 1").get();
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

export function getGuildFaction(db, guildId) {
  const row = db.prepare("SELECT faction FROM guild_settings WHERE guild_id = ?").get(guildId);
  return row?.faction || "";
}

export function setGuildFaction(db, guildId, faction) {
  db.prepare("UPDATE guild_settings SET faction = ? WHERE guild_id = ?").run(faction, guildId);
}
