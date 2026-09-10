import Database from "better-sqlite3";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { encryptWithDEK, decryptWithDEK, activeKeyVersion, constantTimeStringsEqual } from "./secretsCrypto.js";

const SCHEMA_VERSION = 7;

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

CREATE INDEX IF NOT EXISTS idx_guild_roles_guild ON guild_roles(guild_id);
CREATE INDEX IF NOT EXISTS idx_guild_roles_type ON guild_roles(guild_id, role_type);

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
-- one guild's adapter_token and its stats_push_secret each get their own
-- independent DEK -- compromising one wrapped DEK (or the KEK used to
-- unwrap it, absent the age identity) exposes only that one row, not
-- every secret in the database. row_key is stored as TEXT so it can hold
-- guilds.guild_id without a separate column per table. (oauth_sessions'
-- access_token was encrypted the same way until schema v7, when that
-- table moved to in-memory-only storage -- see database hardening notes
-- below the schema -- and stopped needing a DEK at all.)
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

// ── Schema hardening (v7): what's NOT in the schema above, and why ──────
//
// Six tables that used to live here are gone as of v7 -- either deleted
// entirely or moved to in-memory JS state (see "Ephemeral in-memory
// state" below). None of this is data any operator needs to survive a
// process restart to be correct.
//
//   player_links            Confirmed dead code (zero callers anywhere in
//                            src/) -- see docs/multi-tenant-design.md.
//                            Player-linking has always actually lived in
//                            each operator's own Core Postgres
//                            (console.discord_account_links), reached via
//                            adapterClient.js. This table never needed to
//                            exist on this side at all.
//   guild_member_activity   Backed only guildFactionSync.js's cosmetic
//                            auto-detected themed-embed color -- the one
//                            table in this schema that read as "tracking
//                            who talks to the bot," for the least
//                            essential reason. Removed along with that
//                            feature; guild_settings.faction is still
//                            directly, manually settable.
//   oauth_sessions          Only needs to survive minutes during one live
//                            OAuth round-trip, never across a restart --
//                            now an in-memory Map with a short TTL.
//   bot_stats               A vanity command counter with no operational
//                            purpose -- now an in-memory counter that
//                            resets on restart, which is fine for a
//                            vanity counter.
//   stats_snapshot,         The public live-stats display cache. A
//   guild_stats_snapshot    restart means a brief "recomputing" gap, not
//                            lost data -- now in-memory Maps/values. The
//                            credential and consent state this feature
//                            depends on (guilds.stats_push_secret,
//                            stats_sharing_opted_in_at/opted_out_at)
//                            stays in SQLite, since THAT does need to
//                            survive a restart to mean anything.
//
// What's left on disk: schema_version, guilds (routing + the one real
// credential + the stats-sharing consent record), guild_roles,
// guild_settings, and the KEK/DEK bookkeeping tables backing whatever
// encrypted columns remain on guilds.

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

  // v6->v7 (schema hardening): player_links, guild_member_activity,
  // oauth_sessions, bot_stats, stats_snapshot, and guild_stats_snapshot
  // are all removed from SCHEMA above (deleted outright, or moved to
  // in-memory state -- see the "Schema hardening (v7)" comment there for
  // why each one). DROP TABLE for an existing install that already
  // created any of these; a no-op for a fresh v7 install that never did.
  // Safe unconditionally: none of these tables is referenced BY any
  // table that survives (guild_roles/guild_settings/guild_stats_snapshot
  // reference OUT to guilds via FK, not the reverse), so dropping them
  // cannot violate a foreign key on anything left behind.
  if (currentVersion && currentVersion.version < 7) {
    for (const table of ["player_links", "guild_member_activity", "oauth_sessions", "bot_stats", "stats_snapshot", "guild_stats_snapshot"]) {
      try {
        db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
      } catch {
        // Best-effort -- a table that resists dropping is not worth
        // failing startup over; it simply becomes unused, orphaned
        // schema, same as it already was before this migration existed.
      }
    }
  }

  if (currentVersion && currentVersion.version < SCHEMA_VERSION) {
    // v3->v4, v4->v5 are purely additive (stats_snapshot, key_versions/
    // secret_keys/secret_access_log, guild_member_activity, all via
    // CREATE TABLE IF NOT EXISTS in SCHEMA above -- both later removed in
    // v7, see above); v5->v6's real work (the guilds ALTER TABLE
    // migration) and v6->v7's (the DROP TABLEs) happen in the blocks
    // above, not here -- this block just records the version once every
    // step up to SCHEMA_VERSION has run. Existing enc:v1: rows remain
    // readable unchanged; they are only ever upgraded to v2 (per-row DEK)
    // on their next write, exactly like the v0(plaintext)->v1 migration
    // this same pattern already established (see reencrypt-secrets.js
    // for the equivalent bulk-upgrade tool for that earlier transition).
    db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);
  }

  return db;
}

// ── v7->v6 schema rollback (Requirement 26) ─────────────────────────────
//
// Recreates the six tables the v6->v7 hardening migration dropped, with
// their exact pre-v7 shape (see 5516a6b's diff to SCHEMA for the source of
// truth these CREATE TABLEs are copied from), and resets schema_version to
// 6 -- for the one scenario this matters: an operator upgrades to a mentat
// version carrying schema v7, then needs to roll the *code* back to a
// pre-v7 release for some unrelated reason (a regression found elsewhere,
// say) and that older code's queries (e.g. `SELECT * FROM bot_stats`) would
// otherwise throw "no such table" against an already-migrated database.
//
// IMPORTANT -- this restores SCHEMA SHAPE ONLY, not data. The v6->v7
// migration's DROP TABLE statements are destructive; whatever rows existed
// in player_links/guild_member_activity/oauth_sessions/bot_stats/
// stats_snapshot/guild_stats_snapshot at migration time are gone and this
// function cannot bring them back. None of that data needed to survive a
// restart to begin with (see the "Schema hardening (v7)" comment above the
// schema string for why each table was safe to drop), so an operator
// downgrading immediately after the v7 migration ran loses nothing they'd
// notice -- a vanity command counter resets, an in-flight OAuth session
// needs restarting, cosmetic guild-faction theming resets to blank. The
// one column with real, meaningful state (guilds.stats_push_secret /
// stats_sharing_opted_in_at/opted_out_at) was never one of the dropped
// tables and is untouched by both this function and the forward migration.
// If genuine data recovery is ever needed, it requires restoring a backup
// taken before the v6->v7 migration ran (Requirement 25), not this
// function -- see compliance/runbooks/backup-recovery.md.
//
// Exposed as a manual, operator-invoked recovery step (scripts/
// rollback-v7-schema.js) -- never called automatically. createDatabase()
// only ever migrates forward.
export function rollbackSchemaV7ToV6(db) {
  db.exec(`
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

    CREATE TABLE IF NOT EXISTS stats_snapshot (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS guild_stats_snapshot (
      guild_id TEXT PRIMARY KEY REFERENCES guilds(guild_id) ON DELETE CASCADE,
      players_online INTEGER NOT NULL,
      spice_fields INTEGER NOT NULL,
      sietches INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare("UPDATE schema_version SET version = 6").run();
}

// ── KEK/DEK per-row secret helpers (schema v4, issues #107/#108/#109) ──
//
// secret_keys holds the wrapped DEK for one (table, row, column) triple.
// These helpers centralize that lookup/write so getGuild()/upsertGuild()
// below don't reimplement the same three-column primary key logic.
// (oauth_sessions' access_token used this too before schema v7 moved that
// table to in-memory storage -- see the "Schema hardening (v7)" comment
// above the schema string.) Every call is a no-op (wrappedDEK stays null,
// nothing is written) when no KEK is configured -- see secretsCrypto.js's
// encryptWithDEK(), which itself falls back to v1 single-key encryption
// in that case.
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
// code-review high (hosted-bot OAuth registration, mentat#316): the new
// per-command "is this guild registered" gate in commands.js only ever
// needs `status`, but was calling getGuild() -- which unconditionally
// decrypts adapter_token and throws on a decrypt failure (e.g. mid key
// rotation, see upsertGuild()'s own comment on that below) -- for every
// single command dispatch, not just adapter-invoking ones. That widened a
// decrypt failure's blast radius from "adapter-dependent commands only" to
// "every command in the guild, including core:about/core:help", with no
// user-facing reply (the failure surfaces only as index.js's generic,
// reply-less interaction_failed log). This lightweight query never touches
// the encrypted column, so it can't fail for that reason.
export function getGuildStatus(db, guildId) {
  const row = db.prepare("SELECT status FROM guilds WHERE guild_id = ?").get(guildId);
  return row ? row.status : undefined;
}

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

// ── OAuth setup-wizard sessions (in-memory, schema v7) ──────────────────
//
// Only needs to survive minutes during one live OAuth round-trip, never
// across a process restart -- an in-memory Map with a short TTL replaces
// the old oauth_sessions table entirely (see the "Schema hardening (v7)"
// comment above the schema string). access_token is no longer run
// through encryptColumn()/decryptColumn(): it's never written to disk, so
// the KEK/DEK threat model (a stolen database file or backup) doesn't
// apply to it -- storing it as plain in-memory JS is not a regression
// from "encrypted at rest," there is no "rest" for it to be at anymore.
//
// SESSION_MAX_AGE_MS bounds both how long an abandoned setup attempt
// lingers in memory (swept lazily, on the next create/get call rather
// than a background timer) and matches the realistic window a person
// takes to read the config form and submit it.
const SESSION_MAX_AGE_MS = 30 * 60 * 1000;

// MAX_OAUTH_SESSIONS (Layer 3 /code-review ultra finding, CONFIRMED
// normal severity, mentat#277): GET /setup -- the only caller of
// createOauthSession() -- is fully public and unauthenticated, with no
// rate limit anywhere ahead of it (unlike POST /api/stats/push, which
// has statsPushRateLimit.js). Before this fix, the Map had no size cap
// at all, only the 30-minute TTL below -- sustained request volume R/sec
// could grow it to roughly R*1800 entries before the TTL ever reclaimed
// anything, all retained in the same Node process that also serves
// Discord command handlers and every other route in this file. 1000 is
// generous headroom over realistic concurrent legitimate setup-wizard
// usage (this is a low-traffic admin flow, not a public-facing feature)
// while keeping worst-case memory bounded regardless of attack volume.
const MAX_OAUTH_SESSIONS = 1000;

let oauthSessions = new Map();

// sweepExpiredOauthSessions (Layer 3 /code-review ultra finding, same as
// above): this used to scan and check EVERY entry in the Map on every
// single call, not just the expired ones. Map iterates in insertion
// order, every entry shares the identical SESSION_MAX_AGE_MS TTL, and
// createOauthSession()/updateOauthSession() never re-`.set()` an
// existing key (updateOauthSession mutates the session object in place;
// deletion never reorders what remains) -- so iteration order always
// matches creation-time order exactly, and the oldest (soonest-to-expire)
// entries are always first. Stopping at the first still-fresh entry
// turns this from an O(N) full-Map scan into O(actually-expired-count)
// on every call, instead of paying the whole Map's size on the shared
// Node event loop regardless of how few (or zero) entries actually
// expired.
function sweepExpiredOauthSessions() {
  const cutoff = Date.now() - SESSION_MAX_AGE_MS;
  for (const [state, session] of oauthSessions) {
    if (session.createdAtMs >= cutoff) break;
    oauthSessions.delete(state);
  }
}

export function createOauthSession({ state, discordUserId, discordUsername, guildId = "" }) {
  sweepExpiredOauthSessions();
  // Hard cap, independent of the TTL sweep above -- see
  // MAX_OAUTH_SESSIONS's own comment for why this is needed even with
  // the sweep in place. Evicts the single oldest entry (Map's insertion
  // order, which is also creation-time order -- see
  // sweepExpiredOauthSessions()'s comment) rather than rejecting the new
  // session, so sustained abuse degrades old, likely-already-abandoned
  // sessions instead of blocking a legitimate new setup attempt.
  if (oauthSessions.size >= MAX_OAUTH_SESSIONS) {
    const oldestState = oauthSessions.keys().next().value;
    oauthSessions.delete(oldestState);
  }
  oauthSessions.set(state, {
    state,
    discord_user_id: discordUserId,
    discord_username: discordUsername,
    guild_id: guildId,
    access_token: "",
    expires_at: "",
    createdAtMs: Date.now()
  });
}

// Callers that already treat "no session" as "Session Expired" (the
// oauth callback route) get that exact behavior for free once a session
// ages past SESSION_MAX_AGE_MS -- expired-but-present and never-existed
// are handled identically, both as undefined.
export function getOauthSession(state) {
  const session = oauthSessions.get(state);
  if (!session) return undefined;
  if (session.createdAtMs < Date.now() - SESSION_MAX_AGE_MS) {
    oauthSessions.delete(state);
    return undefined;
  }
  const { createdAtMs, ...publicShape } = session;
  return publicShape;
}

export function updateOauthSession(state, { accessToken, expiresAt }) {
  const session = oauthSessions.get(state);
  if (!session) return;
  session.access_token = accessToken;
  session.expires_at = expiresAt;
}

export function deleteOauthSession(state) {
  oauthSessions.delete(state);
}

// ─── Hosted-bot auto-invite: pending-state stores ──────────────────────
// mentat#343 (Phase 1 of dune-awakening-selfhost-docker#832's design,
// docs/design/hosted-bot-auto-invite-and-role-picker-l1-design-2026-09-10.md
// §4.5) -- two stores, deliberately separate from oauthSessions above and
// from each other, since each stage of the flow has a genuinely different
// lifetime and a different party responsible for advancing it (design
// doc's own §4.5 "why three stores instead of fewer" -- the third,
// hostedBotAutoInvitePendingStates, lives in Core, not here).

// autoInviteSessions: stage 1, bridges POST /auto-invite/start (stages
// {consoleUrl, adapterToken}) to GET /auto-invite/callback (the Discord
// redirect target). 2-minute TTL -- much shorter than oauthSessions' 30
// minutes, since the design doc's issue #844 explicitly shortens this to
// minimize the phishing-link viability window for the FIRST leg of the
// flow, before Discord ownership is even verified. Unlike oauthSessions'
// own deleteOauthSession() (confirmed dead code -- never called from
// setupServer.js), this store's delete-on-consume is REAL: the
// /auto-invite/callback handler must call deleteAutoInviteSession() on
// EVERY terminal path (success, operator-cancelled, ownership-check-
// failed, expired/already-consumed, and discord_unreachable), per design
// doc issue #836.
const AUTO_INVITE_SESSION_MAX_AGE_MS = 2 * 60 * 1000;
const MAX_AUTO_INVITE_SESSIONS = 1000;

let autoInviteSessions = new Map();

function sweepExpiredAutoInviteSessions() {
  const cutoff = Date.now() - AUTO_INVITE_SESSION_MAX_AGE_MS;
  for (const [state, session] of autoInviteSessions) {
    if (session.createdAtMs >= cutoff) break;
    autoInviteSessions.delete(state);
  }
}

export function createAutoInviteSession({ state, consoleUrl, adapterToken }) {
  sweepExpiredAutoInviteSessions();
  if (autoInviteSessions.size >= MAX_AUTO_INVITE_SESSIONS) {
    const oldestState = autoInviteSessions.keys().next().value;
    autoInviteSessions.delete(oldestState);
  }
  autoInviteSessions.set(state, {
    state,
    console_url: consoleUrl,
    adapter_token: adapterToken,
    createdAtMs: Date.now()
  });
}

// Inline expiry recheck on read (design doc issue #852, matching this
// same file's getOauthSession() precedent above) -- without it, a
// low-traffic period could let a stale entry linger past its nominal TTL
// until the next create() call's lazy sweep, which matters more here
// given this store's deliberately short 2-minute TTL.
export function getAutoInviteSession(state) {
  const session = autoInviteSessions.get(state);
  if (!session) return undefined;
  if (session.createdAtMs < Date.now() - AUTO_INVITE_SESSION_MAX_AGE_MS) {
    autoInviteSessions.delete(state);
    return undefined;
  }
  const { createdAtMs, ...publicShape } = session;
  return publicShape;
}

export function deleteAutoInviteSession(state) {
  autoInviteSessions.delete(state);
}

// pendingOwnerConfirmations: stage 2 (Phase 1 writes to this store once
// Discord ownership is verified; Phase 2 -- mentat#344+ -- adds the
// DM/slash-command machinery that reads it and is the only thing that may
// call upsertGuild() off the back of it). 15-minute TTL, matching
// writeConfirmation.js's own confirmation-window pattern extended for a
// human checking Discord, per design doc §4.5. Keyed by a fresh opaque
// confirmationId (NOT the same as the auto-invite `state` above --
// deliberately a different value, so a leaked/replayed auto-invite state
// can't be reused to probe or forge a pending owner-confirmation record).
const OWNER_CONFIRMATION_MAX_AGE_MS = 15 * 60 * 1000;
const MAX_PENDING_OWNER_CONFIRMATIONS = 1000;

let pendingOwnerConfirmations = new Map();

function sweepExpiredPendingOwnerConfirmations() {
  const cutoff = Date.now() - OWNER_CONFIRMATION_MAX_AGE_MS;
  for (const [confirmationId, entry] of pendingOwnerConfirmations) {
    if (entry.createdAtMs >= cutoff) break;
    pendingOwnerConfirmations.delete(confirmationId);
  }
}

export function createPendingOwnerConfirmation({ confirmationId, guildId, guildName, consoleUrl, adapterToken, ownerId }) {
  sweepExpiredPendingOwnerConfirmations();
  if (pendingOwnerConfirmations.size >= MAX_PENDING_OWNER_CONFIRMATIONS) {
    const oldestId = pendingOwnerConfirmations.keys().next().value;
    pendingOwnerConfirmations.delete(oldestId);
  }
  pendingOwnerConfirmations.set(confirmationId, {
    confirmation_id: confirmationId,
    guild_id: guildId,
    guild_name: guildName,
    console_url: consoleUrl,
    adapter_token: adapterToken,
    owner_id: ownerId,
    createdAtMs: Date.now()
  });
}

export function getPendingOwnerConfirmation(confirmationId) {
  const entry = pendingOwnerConfirmations.get(confirmationId);
  if (!entry) return undefined;
  if (entry.createdAtMs < Date.now() - OWNER_CONFIRMATION_MAX_AGE_MS) {
    pendingOwnerConfirmations.delete(confirmationId);
    return undefined;
  }
  const { createdAtMs, ...publicShape } = entry;
  return publicShape;
}

export function deletePendingOwnerConfirmation(confirmationId) {
  pendingOwnerConfirmations.delete(confirmationId);
}

export function getAllGuilds(db) {
  return db.prepare("SELECT * FROM guilds").all();
}

export function getActiveGuilds(db) {
  return db.prepare("SELECT * FROM guilds WHERE status = 'active'").all();
}

// A vanity command counter with no operational purpose -- in-memory,
// schema v7. Resets on restart, which is fine for a vanity counter.
let commandCount = 0;

export function incrementCommandCount() {
  commandCount += 1;
}

export function getCommandCount() {
  return commandCount;
}

// Local live-stats snapshot (replaces the Cloudflare KV
// acp-stats-aggregate write, and the on-disk stats_snapshot table before
// it -- schema v7). In-memory only: a restart means a brief "no data
// yet" gap until the next push interval repopulates it, not lost data.
// statsPusher.js calls saveStatsSnapshot on its push interval;
// setupServer.js serves the stored payload as GET /api/live-stats.
let statsSnapshotCache = null;

export function saveStatsSnapshot(stats) {
  statsSnapshotCache = stats;
}

export function getStatsSnapshot() {
  return statsSnapshotCache;
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

// constantTimeStringsEqual is imported from secretsCrypto.js (L2
// /code-review high finding on mentat#276: this used to be a duplicate,
// byte-identical local copy -- setupServer.js's tokenMatches() had the
// exact same implementation. One shared helper now, see that file's
// definition for the full rationale.

// A single, process-lifetime decoy ciphertext used to give the "no real
// secret to check" branch of verifyGuildStatsPushSecret() the same
// decrypt-then-compare cost as the "real secret, wrong value" branch --
// closing the timing side-channel the Layer 1 Security Architect audit
// flagged (finding #2). Lazily generated on first use rather than at
// module load so importing this module never has a KEK-dependent side
// effect.
//
// STATS_PUSH_DECOY_ROW_KEY is a fixed, reserved secret_keys/
// secret_access_log row_key -- never a real Discord guild_id (those are
// numeric snowflakes; this deliberately isn't) -- used ONLY by the decoy
// path below, never written by any real guild's data.
//
// FIX (Layer 3 /code-review ultra, mentat#276/#277 -- CONFIRMED normal):
// the previous version of this decoy only equalized the two branches' DB
// round-trip COUNT (both call decryptColumn() once), but in KEK-configured
// deployments left a real crypto-op divergence: the decoy's wrappedDEK was
// never persisted anywhere, so decryptColumn()'s getWrappedDEK() lookup for
// an arbitrary (non-opted-in or nonexistent) guild_id correctly found
// nothing, and decryptWithDEK() throws immediately on a v2-format
// ciphertext with no wrappedDEK -- 0 AES-GCM operations -- while the
// opted-in path's real per-guild wrappedDEK let decryptWithDEK() proceed
// through unwrapDEK() + the actual secret decrypt, 2 AES-GCM operations.
// An attacker could still time that gap to enumerate which of many
// (publicly known) guild IDs have opted into stats sharing. Fixed by
// persisting the decoy's own wrappedDEK into secret_keys, once, under
// STATS_PUSH_DECOY_ROW_KEY the first time it's generated -- so the
// never-opted-in path's getWrappedDEK() lookup (keyed on this fixed row
// key, not the caller-supplied guild_id) finds a real row too, and
// decryptWithDEK() pays the identical unwrapDEK()+decrypt cost either way.
const STATS_PUSH_DECOY_ROW_KEY = "__stats_push_decoy__";
let _statsPushDecoy;
function statsPushDecoySecret(db) {
  if (_statsPushDecoy === undefined) {
    const { ciphertext, wrappedDEK } = encryptWithDEK(`${STATS_PUSH_DECOY_PLACEHOLDER_PREFIX}${Date.now()}-${Math.random()}`);
    if (wrappedDEK) {
      const version = activeKeyVersion() || 1;
      putWrappedDEK(db, "guilds", STATS_PUSH_DECOY_ROW_KEY, "stats_push_secret", wrappedDEK, version);
    }
    _statsPushDecoy = { ciphertext, wrappedDEK };
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
//
// FIX (Layer 2 /code-review high, mentat#276): the two branches used to
// diverge in real DB cost, not just outcome -- an opted-in guild's branch
// called decryptColumn(), which does its own getWrappedDEK() SELECT on
// secret_keys plus a logSecretAccess() INSERT on secret_access_log; the
// "no secret to check" branch skipped both and only touched the
// in-memory-cached decoy ciphertext. That's 2 extra DB round-trips only
// the opted-in path ever paid -- a real, measurable timing side-channel
// letting an attacker distinguish "this guild opted in" from "it didn't"
// by request latency alone, even though the *comparison* itself was
// already constant-time. Fixed by routing BOTH cases through the exact
// same decryptColumn() call (same table/columnName, so the same index
// lookups happen either way) -- real ciphertext when a secret exists, the
// decoy ciphertext otherwise -- so the getWrappedDEK SELECT and
// logSecretAccess INSERT happen unconditionally, once, regardless of
// which guild_id was requested or whether it ever opted in.
//
// FIX 2 (Layer 3 /code-review ultra): fix 1 above still keyed the decoy
// path's decryptColumn() call on the caller-supplied guild_id, so its
// getWrappedDEK() lookup correctly found nothing for a never-opted-in or
// nonexistent guild -- leaving a real crypto-op divergence in
// KEK-configured deployments (see statsPushDecoySecret()'s own comment
// for the full mechanism). Fixed by keying the decoy path's lookup on the
// fixed STATS_PUSH_DECOY_ROW_KEY instead of guildId, so it finds the
// decoy's own persisted wrappedDEK and pays the identical
// unwrapDEK()+decrypt cost as a real opted-in guild.
export function verifyGuildStatsPushSecret(db, guildId, providedSecret) {
  const row = db.prepare("SELECT stats_push_secret FROM guilds WHERE guild_id = ?").get(guildId);
  const hasRealSecret = Boolean(row && row.stats_push_secret);
  const ciphertextToDecrypt = hasRealSecret ? row.stats_push_secret : statsPushDecoySecret(db).ciphertext;
  const rowKeyForLookup = hasRealSecret ? guildId : STATS_PUSH_DECOY_ROW_KEY;

  let plaintext = null;
  try {
    plaintext = decryptColumn(db, "guilds", rowKeyForLookup, "stats_push_secret", ciphertextToDecrypt);
  } catch {
    // decrypt_failed is logged by decryptColumn() -- not expected to
    // actually trigger on the decoy path anymore now that its wrappedDEK
    // is real and persisted, but still possible (though rare) for a real
    // row with corrupted ciphertext. Either way, fall through to the
    // uniform-cost comparison below.
  }

  if (hasRealSecret && plaintext !== null) {
    return constantTimeStringsEqual(providedSecret, plaintext);
  }

  constantTimeStringsEqual(providedSecret, plaintext ?? "");
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
// the guild's in-memory snapshot entry too, rather than relying on the
// staleness window alone to stop it being read -- Layer 1 GRC/DBA audit
// findings #14/#26 both flagged that a revoke-just-stops-display (not
// delete) semantic leaves an operator with no basis to believe their
// last-known data was actually erased. The secret/consent update still
// needs to be durable (SQLite); the snapshot delete is an in-memory Map
// delete with no persistence concern, so the two no longer need a shared
// transaction -- there's nothing left to keep atomic between them.
export function clearGuildStatsSharingSecret(db, guildId) {
  db.prepare(`
    UPDATE guilds SET
      stats_push_secret = NULL,
      stats_sharing_opted_out_at = datetime('now')
    WHERE guild_id = ?
  `).run(guildId);
  guildStatsSnapshots.delete(guildId);
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

// guildStatsSnapshots: in-memory Map, guild_id -> { playersOnline,
// spiceFields, sietches, updatedAtMs }. Replaces the on-disk
// guild_stats_snapshot table (schema v7) -- same last-write-wins, one
// entry per guild semantics, just never persisted. The credential and
// consent state this feature depends on (guilds.stats_push_secret,
// stats_sharing_opted_in_at/opted_out_at) stays in SQLite; only the
// numeric values themselves moved to memory.
let guildStatsSnapshots = new Map();

// upsertGuildStatsSnapshot: writes one guild's most recent push.
// updatedAtMs is always stamped by this process's own clock (Date.now()),
// never taken from the pushed payload -- a client-supplied timestamp
// would let a Core host with clock skew make stale data look perpetually
// fresh (or vice versa), defeating the staleness window entirely (Layer 1
// Architect audit finding #10). Returns false (and writes nothing) if any
// field fails validation, leaving the previous snapshot value in place
// rather than overwriting it with garbage.
// nowMs is an optional override purely for test injection (backdating a
// snapshot to exercise the staleness window in getActiveGuildStatsAggregate
// without a real 20-minute wait) -- matches the same `now` dependency-
// injection convention already used in steamLinkRateLimit.js/
// statsPushRateLimit.js. Production callers never pass it.
export function upsertGuildStatsSnapshot(guildId, { playersOnline, spiceFields, sietches }, { nowMs = Date.now() } = {}) {
  if (![playersOnline, spiceFields, sietches].every(isValidStatsPushValue)) {
    return false;
  }
  guildStatsSnapshots.set(guildId, { playersOnline, spiceFields, sietches, updatedAtMs: nowMs });
  return true;
}

// Matches the existing 20-minute staleness concept from
// yacketrj/acp-landing:docs/kv-stats-schema.md.
const STATS_SNAPSHOT_STALENESS_MS = 20 * 60 * 1000;

// getActiveGuildStatsAggregate: sums players_online/spice_fields/sietches
// across every opted-in guild whose snapshot is still fresh AND whose
// guild is currently 'active' -- the explicit status filter is Layer 1
// Architect audit finding #6: without it, a guild the bot was removed
// from (status: 'suspended') would keep contributing to the public
// aggregate indefinitely, since its own Core console has no way to know
// it was removed and would keep pushing regardless. Still takes `db`:
// guild status is the one piece of this check that IS persisted (it
// lives on the guilds table), so this is the one place the in-memory
// snapshot Map and SQLite meet.
//
// activeGuilds is optional (L2 /code-review high finding on mentat#276):
// pushStats() already fetches getActiveGuilds(db) once for its own
// payload fields and was making this function run the identical query a
// second time on every push cycle. Callers that already have a fresh
// active-guilds list (pushStats()) should pass it directly; every other
// caller (tests, any future one-off caller) can omit it and this
// function queries it itself exactly as before.
export function getActiveGuildStatsAggregate(db, activeGuilds = getActiveGuilds(db)) {
  const activeGuildIds = new Set(activeGuilds.map((g) => g.guild_id));
  const cutoff = Date.now() - STATS_SNAPSHOT_STALENESS_MS;
  let playersOnline = 0, spiceFields = 0, sietches = 0, contributingGuilds = 0;
  for (const [guildId, snapshot] of guildStatsSnapshots) {
    if (!activeGuildIds.has(guildId)) continue;
    if (snapshot.updatedAtMs < cutoff) continue;
    playersOnline += snapshot.playersOnline;
    spiceFields += snapshot.spiceFields;
    sietches += snapshot.sietches;
    contributingGuilds += 1;
  }
  return { players_online: playersOnline, spice_fields: spiceFields, sietches, contributing_guilds: contributingGuilds };
}

export function getGuildFaction(db, guildId) {
  const row = db.prepare("SELECT faction FROM guild_settings WHERE guild_id = ?").get(guildId);
  return row?.faction || "";
}

export function setGuildFaction(db, guildId, faction) {
  db.prepare("UPDATE guild_settings SET faction = ? WHERE guild_id = ?").run(faction, guildId);
}

// Resets every piece of ephemeral, in-memory-only state introduced by the
// schema v7 hardening pass (oauth sessions, the command counter, the
// live-stats caches). Test-only -- production code has no reason to ever
// clear these mid-process.
//
// _statsPushDecoy (Layer 3 /code-review ultra nit, mentat#276/#277): this
// used to be omitted here, so a decoy ciphertext/wrappedDEK minted under
// one test's crypto configuration (ACP_SECRETS_KEY/ACP_KEK_FILE, toggled
// per test elsewhere in this suite's beforeEach) was silently reused by
// later tests with a DIFFERENT configuration -- masking exactly the
// timing/crypto-cost invariants those tests exist to check. Resetting it
// here is now also load-bearing for correctness, not just hygiene: each
// test's fresh (`:memory:`) database needs its OWN persisted decoy
// secret_keys row (see statsPushDecoySecret()'s comment), and resetting
// `_statsPushDecoy` is what forces that row to be (re)persisted against
// the current test's db on its next call, instead of silently reusing a
// value -- and the DB row that came with it -- from a previous test's
// now-discarded database.
export function _resetEphemeralStateForTests() {
  oauthSessions = new Map();
  autoInviteSessions = new Map();
  pendingOwnerConfirmations = new Map();
  commandCount = 0;
  statsSnapshotCache = null;
  guildStatsSnapshots = new Map();
  _statsPushDecoy = undefined;
}
