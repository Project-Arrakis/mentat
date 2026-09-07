import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { timingSafeEqual } from "node:crypto";
import { encryptWithDEK, decryptWithDEK, activeKeyVersion } from "./secretsCrypto.js";

const SCHEMA_VERSION = 6;

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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- stats_push_secret (schema v6, mentat#276): deliberately nullable with
  -- NO default, unlike adapter_token/access_token above -- NULL means
  -- "this operator has not opted into live-stats sharing," and the
  -- inbound push route's auth check treats NULL/empty identically as
  -- "not configured." A NOT NULL DEFAULT '' column (this table's usual
  -- convention) would blur that distinction. See the v5->v6 migration
  -- below for why a fresh CREATE TABLE here is not sufficient on its own
  -- for existing installs.
  stats_push_secret TEXT,
  -- Minimal audit trail of the consent decision itself (Layer 1 GRC
  -- finding #15) -- set on opt-in/opt-out, NOT touched on every push, so
  -- these are genuinely "when did this operator make this choice," not a
  -- last-activity timestamp.
  stats_sharing_opted_in_at TEXT,
  stats_sharing_opted_out_at TEXT
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

-- guild_member_activity (schema v5, mentat#251/dune-awakening-selfhost-docker#699):
-- records which Discord users have actually used the bot in which guild,
-- upserted on every /dune command (executeDuneCommand()). Exists because
-- this bot only holds the Guilds gateway intent, not the privileged
-- GuildMembers intent -- guild.members.fetch() cannot return a real
-- member list, and enabling that privileged intent (with its bot-
-- verification implications) was rejected in favor of this low-privilege
-- alternative. Used by guildFactionSync.js to source the member-ID list
-- for Core's guilds/faction-summary aggregate, so the per-guild themed-
-- embed faction (guild_settings.faction) can auto-derive from real
-- membership. Naturally reflects active users, not silent lurkers --
-- arguably more relevant for a "who's actually engaging with this bot"
-- signal than raw (and unobtainable) guild membership would be anyway.
CREATE TABLE IF NOT EXISTS guild_member_activity (
  guild_id TEXT NOT NULL REFERENCES guilds(guild_id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, discord_user_id)
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

-- guild_stats_snapshot (schema v6, mentat#276): last-write-wins cache of
-- one opted-in guild's most recently pushed aggregate stats (players
-- online, spice fields, sietch count), replacing statsPusher.js's broken
-- synthetic-actor pull of Core's admin-tier ops:activity/ops:resources
-- routes. Not a history/log -- one row per guild, overwritten on every
-- push. ON DELETE CASCADE matches every other guild-scoped table in this
-- schema (guild_roles, guild_settings, player_links,
-- guild_member_activity). A brand-new table, so (unlike guilds' new
-- columns above) CREATE TABLE IF NOT EXISTS alone is correct here for
-- both fresh installs and upgrades -- no ALTER TABLE migration needed.
CREATE TABLE IF NOT EXISTS guild_stats_snapshot (
  guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
  players_online INTEGER NOT NULL,
  spice_fields INTEGER NOT NULL,
  sietches INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_guild_stats_snapshot_updated_at ON guild_stats_snapshot(updated_at);
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

  // v5->v6 (mentat#276): stats_push_secret / stats_sharing_opted_in_at /
  // stats_sharing_opted_out_at are new columns on the pre-existing guilds
  // table -- unlike v3/v4/v5's purely additive new *tables* below,
  // SCHEMA's own CREATE TABLE IF NOT EXISTS is a no-op for any operator
  // upgrading from an earlier version (it only fires on first creation),
  // so without this explicit ALTER TABLE step the columns would silently
  // never reach an existing install and the first
  // `SELECT stats_push_secret FROM guilds` would throw
  // "no such column" (Layer 1 DBA/Architect/Cloud-Security audit finding
  // #11). Follows the same guarded-ALTER-TABLE pattern as the v1->v2
  // migration above. guild_stats_snapshot itself is a brand-new table and
  // needs no migration here -- SCHEMA's CREATE TABLE IF NOT EXISTS
  // already handles it correctly for both fresh and upgraded installs.
  if (currentVersion && currentVersion.version < 6) {
    for (const ddl of [
      "ALTER TABLE guilds ADD COLUMN stats_push_secret TEXT",
      "ALTER TABLE guilds ADD COLUMN stats_sharing_opted_in_at TEXT",
      "ALTER TABLE guilds ADD COLUMN stats_sharing_opted_out_at TEXT",
    ]) {
      try {
        db.prepare(ddl).run();
      } catch {
        // Column may already exist (fresh install via SCHEMA's own
        // CREATE TABLE, or a previous migration attempt).
      }
    }
  }

  if (currentVersion && currentVersion.version < SCHEMA_VERSION) {
    // v3->v4, v4->v5 are purely additive (stats_snapshot, key_versions/
    // secret_keys/secret_access_log, guild_member_activity, all via
    // CREATE TABLE IF NOT EXISTS in SCHEMA above); v5->v6's real work
    // (the guilds ALTER TABLE migration) happens in the block above, not
    // here -- this block just records the version once every step up to
    // SCHEMA_VERSION has run. Existing enc:v1: rows remain readable
    // unchanged; they are only ever upgraded to v2 (per-row DEK) on their
    // next write, exactly like the v0(plaintext)->v1 migration this same
    // pattern already established (see reencrypt-secrets.js for the
    // equivalent bulk-upgrade tool for that earlier transition).
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

// ── Cross-console live-stats push (schema v6, mentat#276) ──────────────
//
// Replaces statsPusher.js's broken pull of Core's admin-tier ops:activity/
// ops:resources routes (a synthetic actor with no real Discord identity
// can never legitimately pass that authorization check) with an opt-in
// push model: each operator's own Core instance pushes its own aggregate
// stats to POST /api/stats/push, authenticated by a per-guild secret only
// that operator's console holds. See mentat#276's Layer 1 Eight-Hats
// design audit for the full rationale behind every choice below.

const STATS_PUSH_DECOY_PLACEHOLDER_PREFIX = "stats-push-decoy-";

function constantTimeStringsEqual(a, b) {
  const aBuf = Buffer.from(String(a ?? ""), "utf8");
  const bBuf = Buffer.from(String(b ?? ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

// A single, process-lifetime decoy ciphertext (never persisted to the
// database, never tied to any real guild_id) used to give the "no real
// secret to check" branch of verifyGuildStatsPushSecret() the same
// decrypt-then-compare cost as the "real secret, wrong value" branch --
// closing the timing side-channel the Layer 1 Security Architect audit
// flagged (finding #2). Lazily generated on first use rather than at
// module load so importing this module never has a KEK-dependent side
// effect.
let _statsPushDecoy;
function statsPushDecoySecret() {
  if (_statsPushDecoy === undefined) {
    _statsPushDecoy = encryptWithDEK(`${STATS_PUSH_DECOY_PLACEHOLDER_PREFIX}${Date.now()}-${Math.random()}`);
  }
  return _statsPushDecoy;
}

// verifyGuildStatsPushSecret: constant-shape, constant-cost auth check for
// POST /api/stats/push. Deliberately does NOT short-circuit on "no such
// guild," "guild exists but never opted in," or "decrypt failed" -- every
// one of those and a genuinely wrong secret all pay the identical
// lookup+decrypt+compare cost and return the identical `false`, so none
// of them are distinguishable to a caller by response shape or timing
// (Layer 1 Security Architect / QA audit findings #1/#2).
export function verifyGuildStatsPushSecret(db, guildId, providedSecret) {
  const row = db.prepare("SELECT stats_push_secret FROM guilds WHERE guild_id = ?").get(guildId);

  if (row && row.stats_push_secret) {
    let plaintext = null;
    try {
      plaintext = decryptColumn(db, "guilds", guildId, "stats_push_secret", row.stats_push_secret);
    } catch {
      // decrypt_failed is already logged by decryptColumn(); fall through
      // to the uniform-cost decoy comparison below rather than returning
      // early, so a decrypt failure isn't itself distinguishable.
    }
    if (plaintext !== null) {
      return constantTimeStringsEqual(providedSecret, plaintext);
    }
  }

  const { ciphertext, wrappedDEK } = statsPushDecoySecret();
  let decoyPlaintext = "";
  try {
    decoyPlaintext = decryptWithDEK(ciphertext, wrappedDEK);
  } catch {
    // Should never happen against our own freshly-generated decoy.
  }
  constantTimeStringsEqual(providedSecret, decoyPlaintext);
  return false;
}

// setGuildStatsSharingSecret: records an operator's opt-in. Called from
// the setup portal once the operator pastes back the secret their own
// Core instance generated (see docs/design -- secret generation is
// server-side, on Core, mirroring publicDirectory.js's
// getOrCreateIdentity(), NOT browser-generated; Layer 1 audit finding #5
// found the originally-proposed browser-generated pattern doesn't exist
// in this codebase and was already tried and removed, mentat#194).
export function setGuildStatsSharingSecret(db, guildId, secretPlaintext) {
  const encrypted = encryptColumn(db, "guilds", guildId, "stats_push_secret", secretPlaintext);
  db.prepare(`
    UPDATE guilds SET
      stats_push_secret = ?,
      stats_sharing_opted_in_at = datetime('now'),
      stats_sharing_opted_out_at = NULL
    WHERE guild_id = ?
  `).run(encrypted, guildId);
}

// clearGuildStatsSharingSecret: records an operator's revocation. Deletes
// the guild's guild_stats_snapshot row in the same transaction, rather
// than relying on the staleness window alone to stop it being read --
// Layer 1 GRC/DBA audit findings #14/#26 both flagged that a
// revoke-just-stops-display (not delete) semantic leaves an operator with
// no basis to believe their last-known data was actually erased.
export function clearGuildStatsSharingSecret(db, guildId) {
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE guilds SET
        stats_push_secret = NULL,
        stats_sharing_opted_out_at = datetime('now')
      WHERE guild_id = ?
    `).run(guildId);
    db.prepare("DELETE FROM guild_stats_snapshot WHERE guild_id = ?").run(guildId);
  });
  tx();
}

export function getGuildStatsSharingStatus(db, guildId) {
  const row = db.prepare(
    "SELECT stats_push_secret, stats_sharing_opted_in_at, stats_sharing_opted_out_at FROM guilds WHERE guild_id = ?"
  ).get(guildId);
  if (!row) return { enabled: false, optedInAt: null, optedOutAt: null };
  return {
    enabled: Boolean(row.stats_push_secret),
    optedInAt: row.stats_sharing_opted_in_at || null,
    optedOutAt: row.stats_sharing_opted_out_at || null,
  };
}

// Rejects any value the payload-validation layer wouldn't trust anyway --
// mirrors statsPusher.js's own isValidNumber(), plus explicit bounds
// (Layer 1 Security Architect audit finding #4): a compromised or
// buggy operator console must not be able to write a negative or
// absurdly large value into the shared public aggregate.
const MAX_PLAUSIBLE_STAT_VALUE = 10000;

export function isValidStatsPushValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_PLAUSIBLE_STAT_VALUE;
}

// upsertGuildStatsSnapshot: writes one guild's most recent push. updated_at
// is always stamped by this process's own clock (datetime('now')), never
// taken from the pushed payload -- a client-supplied timestamp would let
// a Core host with clock skew make stale data look perpetually fresh (or
// vice versa), defeating the staleness window entirely (Layer 1 Architect
// audit finding #10). Returns false (and writes nothing) if any field
// fails validation, leaving the previous snapshot value in place rather
// than overwriting it with garbage.
export function upsertGuildStatsSnapshot(db, guildId, { playersOnline, spiceFields, sietches }) {
  if (![playersOnline, spiceFields, sietches].every(isValidStatsPushValue)) {
    return false;
  }
  db.prepare(`
    INSERT INTO guild_stats_snapshot (guild_id, players_online, spice_fields, sietches, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(guild_id) DO UPDATE SET
      players_online = excluded.players_online,
      spice_fields = excluded.spice_fields,
      sietches = excluded.sietches,
      updated_at = excluded.updated_at
  `).run(guildId, playersOnline, spiceFields, sietches);
  return true;
}

// Matches the existing 20-minute staleness concept from
// yacketrj/acp-landing:docs/kv-stats-schema.md.
const STATS_SNAPSHOT_STALENESS_MINUTES = 20;

// getActiveGuildStatsAggregate: sums players_online/spice_fields/sietches
// across every opted-in guild whose snapshot is still fresh AND whose
// guild is currently 'active' -- the explicit status filter is Layer 1
// Architect audit finding #6: without it, a guild the bot was removed
// from (status: 'suspended') would keep contributing to the public
// aggregate indefinitely, since its own Core console has no way to know
// it was removed and would keep pushing regardless.
export function getActiveGuildStatsAggregate(db) {
  return db.prepare(`
    SELECT
      COALESCE(SUM(s.players_online), 0) AS players_online,
      COALESCE(SUM(s.spice_fields), 0) AS spice_fields,
      COALESCE(SUM(s.sietches), 0) AS sietches,
      COUNT(*) AS contributing_guilds
    FROM guild_stats_snapshot s
    INNER JOIN guilds g ON g.guild_id = s.guild_id
    WHERE g.status = 'active'
      AND s.updated_at > datetime('now', '-' || ? || ' minutes')
  `).get(STATS_SNAPSHOT_STALENESS_MINUTES);
}

export function getGuildFaction(db, guildId) {
  const row = db.prepare("SELECT faction FROM guild_settings WHERE guild_id = ?").get(guildId);
  return row?.faction || "";
}

export function setGuildFaction(db, guildId, faction) {
  db.prepare("UPDATE guild_settings SET faction = ? WHERE guild_id = ?").run(faction, guildId);
}

// guild_member_activity (schema v5) -- see the table's own comment in
// SCHEMA above for why this exists instead of a real Discord member-list
// fetch. Called from executeDuneCommand() on every /dune command, so it
// stays best-effort and silent on failure (a broken activity log must
// never break the command it's attached to).
export function recordGuildMemberActivity(db, guildId, discordUserId) {
  if (!guildId || !discordUserId) return;
  try {
    db.prepare(`
      INSERT INTO guild_member_activity (guild_id, discord_user_id, last_seen_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(guild_id, discord_user_id) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).run(guildId, discordUserId);
  } catch { /* best-effort -- never break the command this is attached to */ }
}

// Capped well above DEFAULT_MAX_MEMBERS_PER_GUILD's in-game 32-member
// guild cap (dune-awakening-selfhost-docker's own duneDb.js constant) --
// this is a Discord community's bot-activity roster, not an in-game
// guild roster, so it can legitimately be much larger.
const MAX_GUILD_MEMBER_ACTIVITY_IDS = 1000;

export function getGuildMemberActivityIds(db, guildId) {
  const rows = db.prepare(`
    SELECT discord_user_id FROM guild_member_activity
    WHERE guild_id = ?
    ORDER BY last_seen_at DESC
    LIMIT ?
  `).all(guildId, MAX_GUILD_MEMBER_ACTIVITY_IDS);
  return rows.map((row) => row.discord_user_id);
}
