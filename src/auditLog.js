// auditLog.js — records a durable, queryable audit event for every
// destructive/state-changing command this bot executes (not just the
// `write` group). See docs/audit-log-design.md for the full design and
// docs/audit-log-security-review.md for the FINDING-AUDIT-* items this
// implementation satisfies.
//
// Persists to the audit_log SQLite table (src/database.js) via
// insertAuditLog(). This table is populated regardless of
// config.multiTenant -- see index.js's Single-Tenant Audit Log Note for
// why SQLite is now opened unconditionally, not just in multi-tenant
// mode, specifically so this feature actually works for the majority of
// real (single-tenant) deployments rather than silently doing nothing.
//
// Reuses src/writes.js's writeAuditEvent() field shape (source,
// timestamp, actor, action, capability, idempotencyKey, result, detail)
// rather than inventing a new one -- several existing docs already
// reference that shape, and src/writes.js/broadcast.js/writeCommands.js
// already construct objects matching it (see FINDING-AUDIT-1 in the
// security review for why those three call sites never actually
// persisted anything before this feature).

import { insertAuditLog, getAuditLog, pruneAuditLog } from "./database.js";
import { redactSecrets } from "./format.js";
import { logError, logInfo } from "./logger.js";

// COMMAND_ACTIONS: maps a dispatch `key` (group:subcommand, matching
// commands.js's own key format) to the { action, capability } pair used
// in the audit record, for the command groups NOT already covered by
// src/writes.js's own action-naming convention (write:* commands already
// carry their own `action`/`capability` via WRITE_COMMANDS in
// writeHandler.js, and admin:broadcast already carries its own via
// broadcast.js -- both call recordAuditEvent() directly with those
// values rather than going through this lookup table). This table exists
// specifically for the player:* commands identified in
// docs/additional-features-roadmap.md's R2.x-FEAT-8 as the other
// destructive-command family with no audit coverage.
const COMMAND_ACTIONS = Object.freeze({
  "player:link": { action: "player:link", capability: "ACCOUNT_LINK_WRITE" },
  "player:unlink": { action: "player:unlink", capability: "ACCOUNT_LINK_WRITE" },
  "player:enable": { action: "player:enable", capability: "ACCOUNT_LINK_WRITE" },
  "player:disable": { action: "player:disable", capability: "ACCOUNT_LINK_WRITE" },
  "player:default": { action: "player:default", capability: "ACCOUNT_LINK_WRITE" },
  "player:faction": { action: "player:faction", capability: "ACCOUNT_LINK_WRITE" }
});

export function actionForCommand(key) {
  return COMMAND_ACTIONS[key] || null;
}

// recordAuditEvent: the single entry point every audit-worthy code path
// calls. Never throws -- a failure to write the audit record must never
// block or fail the underlying command it's describing (see
// FINDING-AUDIT-3: availability of the primary action always wins over
// audit-write success). Logs via logError if the write itself fails, so
// the failure is still visible in structured logs even though it isn't
// persisted to the table.
export function recordAuditEvent({
  db, source = "discord-command", guildId = "", discordUserId = "", discordUsername = "",
  channelId = "", command = "", action = "", capability = "", idempotencyKey = "",
  result = "unknown", detail = {}
} = {}) {
  const redactedDetail = redactSecrets(detail || {});

  if (!db) {
    // Defensive fallback only -- see index.js's Single-Tenant Audit Log
    // Note, db should always be available by the time this is called in
    // production. Still emit a structured log line so the event isn't
    // silently lost if this is ever reached (e.g. a future code path that
    // forgets to pass db, or a test harness that doesn't wire one up).
    logInfo("audit.unpersisted", {
      source, guildId, discordUserId, command, action, capability, idempotencyKey, result,
      detail: redactedDetail
    });
    return;
  }

  try {
    insertAuditLog(db, {
      source, guildId, discordUserId, discordUsername, channelId,
      command, action, capability, idempotencyKey, result, detail: redactedDetail
    });
  } catch (error) {
    logError("audit.write_failed", error, { command, action, result });
  }
}

// recordAuditEventForCommand: convenience wrapper for the player:*
// command family, deriving actor fields from the interaction directly
// (matching writes.js's writeAuditEvent()'s actor shape) and looking up
// action/capability from COMMAND_ACTIONS above -- callers only need to
// supply the command key, the outcome, and any command-specific detail.
export function recordAuditEventForCommand({ db, interaction, key, idempotencyKey = "", result, detail = {} } = {}) {
  const mapping = actionForCommand(key);
  if (!mapping) return; // Not a tracked command -- no-op, not an error.

  recordAuditEvent({
    db,
    guildId: interaction?.guildId || "",
    discordUserId: interaction?.user?.id || "",
    discordUsername: interaction?.user?.username || "",
    channelId: interaction?.channelId || "",
    command: key,
    action: mapping.action,
    capability: mapping.capability,
    idempotencyKey,
    result,
    detail
  });
}

// queryAuditLog / runAuditLogPruning: thin re-exports so callers (the
// /dune admin audit command, and index.js's periodic pruning timer) only
// ever need to import from this module, not reach into database.js
// directly for audit-specific concerns.
export function queryAuditLog(db, options = {}) {
  if (!db) return [];
  return getAuditLog(db, options);
}

export function runAuditLogPruning(db, maxAgeMs) {
  if (!db) return 0;
  try {
    return pruneAuditLog(db, maxAgeMs);
  } catch (error) {
    logError("audit.prune_failed", error);
    return 0;
  }
}
