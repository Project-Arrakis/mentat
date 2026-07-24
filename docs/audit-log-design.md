# Persistent Audit Log for Destructive Commands — Design

## Status

**Implemented** (2026-07-24), not a pre-implementation proposal — this
document was written alongside the code, matching this repo's convention
of documenting a feature's design regardless of whether the doc precedes
or follows the code (see `docs/calculator-*.md` for the pre-implementation
precedent this feature's doc set otherwise mirrors).

## Overview

Every command that mutates player, guild, or game-server state now
produces a durable, queryable audit record — not just the `write` group.
This closes a gap identified directly by the user during this session's
Steam-link work: `docs/steam-link-security-review.md`'s FINDING-STEAM-3
discussion of `linkAdditionalAccount()`'s existing "no structured audit
event for link/unlink" limitation (inherited from FINDING-LINK-6) was a
known, accepted gap — but nothing in this bot's own player-command dispatch
recorded who ran a destructive command, when, or with what outcome, and
the *existing* `write:*` audit-event scaffolding (`writeAuditEvent()` in
`src/writes.js`) was called in three places (`writeHandler.js`,
`writeCommands.js`, `broadcast.js`) but never actually persisted anywhere
in any of them.

## Problem Statement

Prior to this feature:

- `src/writeHandler.js` (the function actually wired into `commands.js`
  for every `/dune write *` command) imported `writeAuditEvent` but never
  called it.
- `src/writeCommands.js` calls `writeAuditEvent()` but is unreferenced
  dead code — nothing in `src/commands.js` imports or calls
  `executeWriteCommand()`.
- `src/broadcast.js`'s `executeBroadcast()` did call `writeAuditEvent()`,
  but only attached the resulting object to its own return value, which
  `commands.js`'s `admin:broadcast` dispatch case never included in the
  payload sent back to Discord, let alone persisted anywhere.
- The `player:link`/`unlink`/`enable`/`disable`/`default`/`faction`
  command family (identity/character-link mutations) had **zero** audit
  code anywhere — not even a discarded-object placeholder.

Net effect: every destructive command in this bot could be run with **no
durable record of who did it, when, or what happened** — not because of a
missing design, but because three separate partial implementations each
stopped short of actually writing anything down.

## In-Scope Command Set

Confirmed via direct read of `src/commands.js`'s subcommand definitions
(2026-07-24):

- `write:maintenance-note`, `write:maintenance-window`,
  `write:alert-channel`, `write:alert-threshold`, `write:digest-schedule`,
  `write:post-schedule`, `write:add-channel`, `write:remove-channel`,
  `write:backup`, `write:restart`, `write:update`, `write:cache` — all 12
  `write` subcommands, via `writeHandler.js`.
- `admin:broadcast` — via `broadcast.js`.
- `player:link`, `player:unlink`, `player:enable`, `player:disable`,
  `player:default`, `player:faction` — via `commands.js`'s dispatch
  chain directly (see [§Player Command Wiring](#player-command-wiring)).

**Explicitly not audited:** `player:verify`, `player:whoami`,
`player:characters` — these are read/confirm operations, not
state-mutating ones (`verify` completes a link a prior `link` call
already initiated; `whoami`/`characters` are pure reads). Also not
audited: every `core:*`, `server:*`, `data:*`, `ops:*`, `infra:*`,
`logs:*` command — none of these mutate state.

## Why Most `write:*` and `admin:broadcast` Attempts Are Logged as "pending", Not "success"

Most `write:*` commands (`restart`, `update`, `cache`, etc.) are
themselves still non-functional stubs as of this feature —
`handleWriteCommand()` returns a `"pending-upstream"` scaffold and never
calls the adapter (confirmed: no `adapterClient` call exists anywhere in
`writeHandler.js`). Similarly, `executeBroadcast()` never calls
`sendBroadcastToAdapter()` (confirmed unused/unreferenced from
`commands.js`) — it only gets as far as a confirmation-required response.

Audit logging is wired in **now**, recording the *attempt* (including
denied and scaffold-only outcomes) as `"pending"`, so this is already
correct once the upstream write-adapter contract work lands and these
commands start actually executing — no audit-logic changes will be needed
at that point, only a `"success"`/`"failed"` result once the adapter call
itself completes.

## Player Command Wiring

Unlike `write:*`/`admin:broadcast` (which call `recordAuditEvent()`
directly, with their own already-known `action`/`capability` values),
the six `player:*` commands are wired via a small lookup table
(`COMMAND_ACTIONS` in `src/auditLog.js`) mapping each dispatch `key` to
its `{ action, capability }` pair, plus two call sites in
`executeDuneCommand()`:

1. **Success/failure path:** immediately after the main dispatch
   `if/else if` chain (before `redactSecrets(payload)`), calling
   `recordAuditEventForCommand({ db, interaction, key, result:
   payload?.ok === false ? "failed" : "success", detail: { subcommand } })`.
   This is a no-op for every non-tracked command (the lookup table only
   contains the six `player:*` keys), so it's safe to call unconditionally
   for every command without special-casing.
2. **Thrown-error path:** in the outer `catch` block, calling the same
   function with `result: "failed"` — covers cases like `isAdminActor()`
   throwing, or the adapter call itself rejecting, that never reach step 1.

`player:link`'s Steam-connections branch (offering a "Link via Steam"
button — see `docs/steam-link-design.md`) records its own `"pending"`
event directly (before its early `return true`), since the actual link
completes later, asynchronously, in `steamLinkServer.js`'s OAuth callback
handler — not in this dispatch call at all. This is logged as a
`{ path: "steam-offered" }` detail so a future reader distinguishes it
from a fully-completed link.

## Single-Tenant Persistence

**This is the load-bearing design decision of this feature.** SQLite
(`src/database.js`) was, before this feature, only opened when
`config.multiTenant` is `true` (`src/index.js`:
`const db = config.multiTenant ? createDatabase(config.dbPath) : null;`).
Every doc from this session's Steam-link work repeatedly noted that
**single-tenant is the majority of real deployments** of this bot. If
audit persistence only worked in multi-tenant mode, it would silently do
nothing for most real installs — defeating the entire purpose of building
it.

**Decision: SQLite is now opened unconditionally**, regardless of
`config.multiTenant`. Verified this has no behavioral effect on any
*other* table: `guilds`, `guild_roles`, `guild_settings`,
`oauth_sessions`, `player_links` are only ever **written** from
multi-tenant-only code paths (`onboarding.js`, `setupServer.js`, both of
which are only invoked inside `if (config.multiTenant)` guards in
`index.js`) — opening the db object earlier doesn't cause those paths to
run in single-tenant mode, it only makes the db object itself available
for the one table (`audit_log`) that specifically needs to work in both
modes. A beneficial side effect: `bot_stats`' `commands_total` counter
(previously always `0` in single-tenant mode, since `incrementCommandCount()`
was gated behind `if (db)`) now also works correctly in single-tenant mode
— not a goal of this feature, but a natural consequence of the same fix.

`audit_log.guild_id` is deliberately **not** a foreign key to
`guilds(guild_id)`, because single-tenant mode never populates the
`guilds` table at all — an FK constraint would make every single-tenant
audit write fail with a constraint violation. `guild_id` is simply an
empty string in single-tenant mode, matching `guild_settings`' and other
tables' existing convention for optional/inapplicable text fields.

## Schema

New `audit_log` table (`SCHEMA_VERSION` bumped 2 → 3):

```sql
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
```

Field shape deliberately matches `src/writes.js`'s existing
`writeAuditEvent()` shape (`source`, `actor` fields flattened into
individual columns, `action`, `capability`, `idempotencyKey`, `result`,
`detail`) rather than inventing a new one — several pre-existing docs
(`docs/rw-adapter-contract.md`, `docs/rw-confirmation-flow.md`) already
reference that shape.

`detail` is stored as a JSON string (`TEXT`, `JSON.stringify`'d on write,
`JSON.parse`'d on read via a `safeParseJson()` helper that returns `{}`
rather than throwing on malformed content) — SQLite has no native JSON
column type, and `better-sqlite3` (already this bot's only SQL driver)
has no built-in JSON marshaling.

**Note on the `result` CHECK constraint:** the column's own `DEFAULT`
value (`'unknown'`) is included in the allowed set — a first draft of
this schema omitted it, which meant the column's own default would have
violated its own constraint (any insert relying on the default with no
explicit `result` would fail). Caught and fixed via a real
`node --test` failure during this feature's own test-writing, not by
inspection alone — see `docs/audit-log-security-review.md`'s
Verification section.

## Retention

**14 days, age-based**, matching this feature's explicit scope decision
(not the originally-considered fixed-row-count cap). Enforced by
`pruneAuditLog(db, maxAgeMs)` in `src/database.js`, called once at bot
startup and then every 24 hours via a `setInterval` in `src/index.js`,
matching `src/statsPusher.js`'s own `setInterval` + `.unref?.()`
background-task convention (unref'd so this timer never keeps the process
alive on its own during shutdown; cleared explicitly in the `SIGINT`/
`SIGTERM` handler alongside every other background timer in that file).

This directly begins closing `compliance/controls/soc2-matrix.md`'s
MD-03 ("Log retention (90 days)", currently `⚠️ Partial`) — 14 days is
this feature's own audit-log retention, not the full 90-day org-wide log
retention policy that control describes, but it is the first piece of
this bot's *own* logs (as opposed to CI logs) that has any retention
policy at all rather than growing unbounded.

## Read Command: `/dune admin audit [limit]`

New subcommand in the existing `admin` group (was 5 subcommands, now 6 —
well within Discord's 25-per-group cap). Admin/owner only (same
`isAdminActor()` gate `admin:doctor`/`admin:cooldowns` already use).
`limit` optional, default 20, hard-capped at 200 (matches
`getAuditLog()`'s own clamp). Output passes through the exact same
`redactSecrets()` call every other command's payload already goes
through — redaction-in-depth, since `detail` fields are *also* redacted
once already at write-time (see `src/auditLog.js`'s `recordAuditEvent()`)
before ever reaching the database.

In multi-tenant mode, scoped to the requesting guild
(`getAuditLog(db, { guildId })`); in single-tenant mode, returns across
"all guilds" (`guildId: null`), which in practice means every record,
since single-tenant installs never populate more than the implicit single
tenant anyway.

## Explicit Non-Goals (v1)

- **No `/dune audit` top-level command** (as originally sketched in
  `docs/additional-features-roadmap.md`'s pre-rescoping R2.x-FEAT-8 text)
  — placed under the existing `admin` group instead, matching
  `admin:cooldowns`/`admin:events`'s own precedent for "recent
  history/state" read commands, rather than adding a 9th top-level
  subcommand-group slot for a single command.
- **No write-side audit event for the write-adapter's own actual
  execution** once the upstream contract lands — this feature audits the
  *bot's* attempt/decision, not a second, redundant Core-side event for
  whatever Core itself does once a route actually executes. That's Core's
  own concern (see `docs/rw-adapter-contract.md`'s "Audit Events
  (Console-Side)" section, which already specifies this from the Core
  side).
- **No tamper-evidence** (hash chaining, signing, append-only
  filesystem permissions) beyond SQLite's own row-level guarantees. This
  is an operational accountability log, not a forensic/legal chain of
  custody artifact — see `docs/audit-log-grc.md`'s Non-Goals for the
  compliance-framing equivalent of this same point.
- **No cross-guild aggregation view for multi-tenant operators.** Each
  guild's admin sees only their own guild's records; there's no
  "all guilds" superuser view even for a hosted multi-tenant operator.

## Sources

- [Architecture](audit-log-architecture.md)
- [Security Review](audit-log-security-review.md)
- [GRC Review](audit-log-grc.md)
- [Implementation Prompt](audit-log-implementation-prompt.md)
- `src/writes.js` — `writeAuditEvent()`'s pre-existing field shape this feature reuses
- `docs/additional-features-roadmap.md`'s R2.x-FEAT-8 — the rescoped roadmap entry this feature implements
- `docs/steam-link-security-review.md` — FINDING-STEAM-3/FINDING-LINK-6's "no structured audit event" limitation this feature closes for the bot's own dispatch layer
- `compliance/controls/soc2-matrix.md` — MD-03 (log retention), the control this feature's 14-day pruning begins to address
