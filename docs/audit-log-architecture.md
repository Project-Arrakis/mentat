# Persistent Audit Log for Destructive Commands — Architecture

## Overview

Single-repo change (`Arrakis-Control-Panel` only — no Core-side work,
unlike the Steam-link feature). No new database, no new external service.
One existing table added to the existing SQLite schema, one new module
(`src/auditLog.js`), small wiring changes across three existing files
(`src/writeHandler.js`, `src/broadcast.js`, `src/commands.js`), and one
config-level change (`src/index.js` opens SQLite unconditionally).

## New Files / Modified Files

```
src/auditLog.js               — new. recordAuditEvent() (the single entry
                                 point every audit-worthy code path
                                 calls), recordAuditEventForCommand()
                                 (convenience wrapper deriving actor
                                 fields from a Discord interaction
                                 directly, for the player:* command
                                 family), actionForCommand() (the
                                 dispatch-key -> {action, capability}
                                 lookup table), queryAuditLog()/
                                 runAuditLogPruning() (thin re-exports of
                                 database.js's equivalents, so callers
                                 only ever import from this module for
                                 audit-specific concerns).

src/database.js               — new audit_log table (SCHEMA_VERSION 2 ->
                                 3), plus insertAuditLog()/getAuditLog()/
                                 pruneAuditLog(). Since audit_log is a
                                 brand-new table (not a new column on an
                                 existing one), the version-3 migration
                                 branch does no ALTER TABLE work --
                                 CREATE TABLE IF NOT EXISTS in the schema
                                 string already handles both fresh and
                                 pre-existing databases idempotently; the
                                 migration branch only advances the
                                 version marker.

src/writeHandler.js           — handleWriteCommand() now accepts a `db`
                                 parameter and calls recordAuditEvent()
                                 at each of its three possible outcomes
                                 (writes disabled, unknown command, not
                                 authorized, or the scaffolded
                                 pending-upstream success path) -- was
                                 previously importing writeAuditEvent
                                 from writes.js but never calling it.

src/broadcast.js              — executeBroadcast() now accepts a `db`
                                 parameter and calls recordAuditEvent()
                                 at each of its three possible outcomes
                                 (disabled, not authorized, or the
                                 pending confirmation-required success
                                 path) -- was previously calling
                                 writeAuditEvent() but only attaching the
                                 result to its own return value, never
                                 persisting it or including it in the
                                 Discord-facing payload.

src/commands.js               — new admin:audit subcommand + dispatch
                                 case + embed selection; handleWriteCommand()
                                 and executeBroadcast() call sites updated
                                 to pass db through; two new
                                 recordAuditEventForCommand() call sites
                                 added to executeDuneCommand() itself (one
                                 after the main dispatch chain for
                                 success/failure, one in the catch block
                                 for thrown errors) covering the six
                                 player:* commands; player:link's
                                 Steam-connections branch records its own
                                 "pending" event directly, since the
                                 actual link completes later, out-of-band,
                                 in steamLinkServer.js's OAuth callback.

src/embedFormat.js            — new formatAuditLogEmbed(), matching
                                 formatEventsEmbed()'s existing style
                                 (result-icon-prefixed line list, capped
                                 at 15 rendered rows, entry-count field).

src/index.js                  — SQLite now opened UNCONDITIONALLY
                                 (previously config.multiTenant ? ... :
                                 null) -- see Design doc's Single-Tenant
                                 Persistence section for the full
                                 rationale. New periodic pruning timer
                                 (24h interval, unref'd, cleared in the
                                 shutdown handler alongside every other
                                 background timer in this file).

test/database.test.js         — new. Direct unit tests for
                                 insertAuditLog()/getAuditLog()/
                                 pruneAuditLog() against a real (in-memory)
                                 SQLite instance.
test/auditLog.test.js         — new. Unit tests for auditLog.js's
                                 recordAuditEvent()/recordAuditEventForCommand()/
                                 queryAuditLog()/runAuditLogPruning(),
                                 including redaction and
                                 never-throws-on-db-failure behavior.
test/discord-bot-test-harness.js — extended with real (not just
                                 response-shape) audit-persistence
                                 assertions for player:unlink/faction,
                                 a negative assertion that read commands
                                 write nothing, and admin:audit
                                 allow/deny cases.
test/fixtures/mockConfig.js   — added an admin:audit entry to
                                 commandRoleIds (was previously missing,
                                 which would have let an observer role
                                 fall through to the broader
                                 observer-or-admin allow-set instead of
                                 being correctly admin-only in this
                                 specific mock).
```

## Why `src/auditLog.js` Is a Separate Module From `src/writes.js`

`src/writes.js`'s existing `writeAuditEvent()` builds a plain in-memory
object shape and returns it — it has no knowledge of persistence, and
deliberately stays that way (it's still used, unchanged, by
`test/writes.test.js`'s own unit tests, and its shape is what
`recordAuditEvent()` mirrors). `src/auditLog.js` is the new module that
actually *persists* that shape — it owns the "how do I get this into
SQLite, and how do I read it back out" concern, which is a genuinely
different responsibility (and would have created a circular import if
folded into `writes.js`, since `database.js` doesn't import from
`writes.js` today and shouldn't start).

## Why `recordAuditEvent()` Never Throws

Every call site in this feature (`writeHandler.js`, `broadcast.js`,
`commands.js`) treats a failure to *write* the audit record as strictly
lower-priority than the primary action the record is describing —
`recordAuditEvent()` catches its own internal `insertAuditLog()` call and
logs via `logError()` on failure, rather than propagating. This mirrors
`src/scheduler.js`/`src/announcements.js`/`src/statsPusher.js`'s existing
`onError` callback convention throughout this codebase: background/
side-effect operations degrade to a structured log line on failure, they
never take down the primary request path. See
`docs/audit-log-security-review.md`'s FINDING-AUDIT-3 for the security
framing of this same decision (availability of the primary command always
wins over audit-write success).

## Why `player:link`'s Steam-Connections Branch Records Its Own Event Directly

Every other tracked `player:*` command's outcome (`success`/`failed`) is
knowable synchronously, within the same `executeDuneCommand()` call that
dispatched it — so the generic post-dispatch `recordAuditEventForCommand()`
call (right before `redactSecrets(payload)`) can record the real outcome
uniformly for all of them. `player:link`'s Steam-connections branch is
different: when a character has a Steam ID on file, this dispatch call
only *offers* a button — the actual link (or whisper-fallback, or
conflict) happens later, asynchronously, inside `steamLinkServer.js`'s
`/steam-link/callback` handler, which is a *different* Express request
entirely, with no `interaction`/`executeDuneCommand()` call stack in
common. Rather than thread a "pending Steam link" audit record's identity
through to that later, unrelated request (which `steamLinkServer.js`
currently has no wiring for at all), this feature records a `"pending"`
event with `{ path: "steam-offered" }` at the point the button is shown,
and leaves it there — a deliberate scope boundary, called out explicitly
in [Design's Non-Goals](audit-log-design.md#explicit-non-goals-v1) and
revisited only if a future session wires `steamLinkServer.js` into this
same audit table directly.

## Sources

- [Design](audit-log-design.md)
- [Security Review](audit-log-security-review.md)
- [GRC Review](audit-log-grc.md)
- `src/writes.js` — the pre-existing `writeAuditEvent()` shape this feature's persistence layer mirrors
- `src/statsPusher.js` — the `setInterval`+`.unref()` background-task convention this feature's pruning timer follows
- `src/scheduler.js`, `src/announcements.js` — the `onError`-callback / never-throw-from-background-work convention this feature's `recordAuditEvent()` follows
