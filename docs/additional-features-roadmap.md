# Additional Features Roadmap

**Date:** 2026-07-04
**Context:** After reviewing the current implementation across all 13 release
branches, these additional features are recommended to strengthen the bot's
security and operator value.

## Current Implementation Status

| Release | Version | Key Features | Test Status |
|---------|---------|-------------|-------------|
| R1.0.0 | v1.0.0 | 7 read-only commands (about/ping/health/status/status-summary/readiness/services) | 88/88 pass |
| R1.1 | v1.1.0 | Operator validation script (`validate:operator`) | 88/88 pass |
| R1.2 | v1.2.0 | Population command (aggregate-only) | 88/88 pass |
| R1.3 | v1.3.0 | Notification scheduler + alert digests | 99/99 pass |
| R1.4 | v1.4.0 | Adapter compatibility check (`compat:check`) | 88/88 pass |
| R1.5 | v1.5.0 | R2 readiness documentation | 88/88 pass |
| R2.0.0 | v2.0.0 | Write-safety foundation framework (disabled) | 97/97 pass |
| R2.1 | v2.1.0 | Maintenance metadata write stubs (disabled) | 88/88 pass |
| R2.2 | v2.2.0 | Notification config write stubs (disabled) | 88/88 pass |
| R2.3 | v2.3.0 | Schedule config write stubs (disabled) | 88/88 pass |
| R2.4 | v2.4.0 | R3 readiness documentation | 88/88 pass |
| R3.0.0 | v3.0.0 | Operational write stubs (backup/restart/update/cache, disabled) | 88/88 pass |
| R4.0.0 | v4.0.0 | Highest-risk operations planning | 88/88 pass |

Core modules: `adapterClient.js`, `commands.js`, `config.js`, `format.js`,
`healthState.js`, `healthcheck.js`, `index.js`, `logger.js`, `notifications.js`,
`scheduler.js`, `writes.js`, `writeCommands.js`

## Suggested Additional Features (R1.x — Read-Only)

These can be added to R1.x release branches without any adapter changes.
All remain read-only and within the current adapter contract.

### R1.x-FEAT-1: Bot command cooldowns (PRIORITY: HIGH)

**Branch:** `release/v1.1.0` or `release/v1.2.0`
**Risk:** A user flooding commands could cause adapter load.
**Implementation:**
- Per-user cooldown map (in-memory, keyed by `userId:commandName`)
- Configurable cooldown via `DUNE_COOLDOWN_MS` env (default 5000ms)
- Ephemeral "please wait" response when cooling down
- Cooldown exempt for admin/owner roles

### R1.x-FEAT-2: Admin diagnostic status mode (PRIORITY: MEDIUM)

**Branch:** `release/v1.2.0`
**Description:** `/dune status diagnostic:true` exposes richer output to
admin/owner roles only. Currently all status output is public-safe.
**Implementation:** Add `diagnostic` boolean option to the status subcommand;
gate with admin role check; sanitize before public response.

### R1.x-FEAT-3: Read-only backup list (PRIORITY: MEDIUM)

**Branch:** `release/v1.3.0`
**Description:** `/dune backups` shows backup list metadata (name, size, date).
No create/restore/delete. Requires adapter route `GET /api/integrations/discord/backups/list`.
**Implementation:** Add `backups` subcommand; add route to adapterClient/config;
requires moderator+ capability.

### R1.x-FEAT-4: Read-only logs view (PRIORITY: MEDIUM)

**Branch:** `release/v1.3.0`
**Description:** `/dune logs service:<name>` shows recent logs for a service.
Capped at 50 lines, redacted, admin/owner only.
Requires adapter route `POST /api/integrations/discord/logs`.
**Implementation:** Add `logs` subcommand with service name option;
cap output, redact secrets/ips, admin-only RBAC.

### R1.x-FEAT-5: Graceful adapter degradation (PRIORITY: LOW)

**Branch:** `release/v1.4.0`
**Description:** When the adapter is unreachable, instead of returning errors
on every command, the bot should track failure state and return a cached
"adapter unavailable" message with last known status timestamp.
**Implementation:** Add `adapterHealthTracker` module that caches health state;
commands check before making adapter calls; clear when adapter recovers.

### R1.x-FEAT-6: Bot status/activity display (PRIORITY: LOW)

**Branch:** `release/v1.1.0`
**Description:** Set Discord bot presence to show server status summary
(e.g., "Playing Dune | 8/128 players online").
**Implementation:** Update presence in ClientReady event using population data;
read-only; can be disabled via env.

## Suggested Additional Features (R2.x — Write-Capable, Disabled by Default)

These require `DUNE_DISCORD_WRITES_ENABLED=true` and write-role authorization.
All are built on the write-safety foundation introduced in v2.0.0.

### R2.x-FEAT-7: Button-based confirmations (PRIORITY: HIGH)

**Branch:** `release/v2.0.0`
**Description:** Replace text-based confirmation ("reply with confirm") with
Discord message components (Confirm / Cancel buttons). Ephemeral response
contains the buttons; confirmation is a button interaction, not a text match.
**Implementation:** Add Discord `ActionRowBuilder`/`ButtonBuilder` support;
handle button interactions in InteractionCreate; non-iinteractive timeout.

### R2.x-FEAT-8: Persistent audit log for destructive/state-changing commands (PRIORITY: HIGH — rescoped 2026-07-24)

**Branch:** TBD — separate feature branch/PR, own design/architecture/
security/GRC docs, planned for **after** the Steam-link feature
(`feat/steam-link-bot-side`) ships. Not folded into that PR.

**Description:** Every command that mutates player, guild, or game-server
state must produce a durable, queryable audit record — not just the
`write` group. Confirmed in-scope command set as of this rescoping (grep
of `src/commands.js`'s subcommand definitions, 2026-07-24):
- `write:restart`, `write:update`, `write:cache`, `write:backup` — restart
  a game service, trigger an update, clear caches, create a DB backup.
- `write:maintenance-note`, `write:maintenance-window` — player-visible
  maintenance state.
- `write:alert-channel`, `write:alert-threshold`, `write:digest-schedule`,
  `write:post-schedule`, `write:add-channel`, `write:remove-channel` — bot
  config mutations.
- `admin:broadcast` — sends a message to all in-game players.
- `player:link`, `player:unlink`, `player:enable`, `player:disable`,
  `player:default`, `player:faction` — player identity/link state
  (includes the Steam-connections branch of `player:link` once that
  feature ships — this closes FINDING-LINK-6's known, accepted audit gap
  cited in `docs/steam-link-security-review.md`).

**Implementation (superseding the original in-memory-ring-buffer idea):**
Persist to a new append-only table in this bot's existing `database.js`
SQLite schema (guild-scoped, following the existing
`SCHEMA_VERSION`/`ALTER TABLE` migration pattern — see `database.js`'s
current schema, which has no existing event/audit-shaped table to extend).
Reuse the existing `writeAuditEvent()` field shape from `src/writes.js`
(`source`, `timestamp`, `actor`, `action`, `capability`, `idempotencyKey`,
`result`, `detail`) rather than inventing a new schema — several docs
already reference that shape. Actually wire it in: today `writeHandler.js`
imports `writeAuditEvent` but never calls it, `writeCommands.js` calls it
but is dead code (unreferenced), and `broadcast.js` calls it but discards
the result after building the Discord reply payload — none of the three
live/dead paths persist anything anywhere today. `/dune audit [limit]`
(admin/owner only, redacted output) becomes a read query against the new
table instead of an in-memory ring buffer, so history survives a bot
restart.

**Note:** most `write:*` commands (`restart`, `update`, `cache`, etc.) are
themselves still non-functional stubs today — `handleWriteCommand()`
returns a `"pending-upstream"` scaffold and never calls the adapter. Audit
logging should still be wired in now (logging the *attempt*, including
denied/scaffold-only outcomes), so it's already correct once the
write-adapter contract work lands and these commands start actually
executing.

### R2.x-FEAT-9: Webhook integration (PRIORITY: MEDIUM)

**Branch:** `release/v2.3.0`
**Description:** Send adapter status changes to external webhooks
(Slack, Teams, custom HTTP endpoints). Programmable payload format.
**Implementation:** Webhook URL list in config; POST on status change;
deduplication; rate limiting; disabled by default.

### R2.x-FEAT-10: Structured event log (PRIORITY: LOW)

**Branch:** `release/v2.4.0`
**Description:** Write structured JSON events to a file or stdout for
collection by log aggregators (ELK, Loki, Datadog).
**Implementation:** `logger.js` already produces JSON lines; add optional
file output path (`DUNE_EVENT_LOG_FILE`) and structured field schema.

## Suggested Additional Features (R3.x — Operational)

### R3.x-FEAT-11: Maintenance window awareness (PRIORITY: HIGH)

**Branch:** `release/v3.0.0`
**Description:** Commands affected by maintenance windows (restart, update)
should check whether a maintenance window is active before executing.
Non-maintenance-window commands should warn or block.
**Implementation:** Read maintenance window state from adapter; gate
operational commands behind window check.

### R3.x-FEAT-12: Dry-run / preview mode (PRIORITY: HIGH)

**Branch:** `release/v3.0.0`
**Description:** All operational commands should support `--dry-run` to show
what would happen without executing. Returns the planned action, affected
services, and estimated impact.
**Implementation:** `dryRun` option in command definitions; execute flow
with `if (!dryRun) { ... }` guard; audit event notes dry run.

### R3.x-FEAT-13: Cooldown and concurrency limits (PRIORITY: MEDIUM)

**Branch:** `release/v3.0.0`
**Description:** Operational commands must not be spammed. Per-command
cooldown (e.g., restart cooldown = 5 min, backup cooldown = 1 hour).
Concurrent operation limit (e.g., max 1 restart at a time).
**Implementation:** Extend cooldown map from R1.x-FEAT-1; add concurrency
semaphore; configurable per command family.

## Suggested Additional Features (R4.x — Highest Risk)

These require enhanced privacy and abuse-case review before implementation.
All are blocked until R3.x operational writes are proven.

### R4.x-FEAT-14: Player moderation bridge (PRIORITY: MEDIUM, BLOCKED)

**Description:** `/dune kick <player-id> [reason]` with moderator capability,
confirmation, audit, and cooldown. Requires upstream adapter action.
**Blocked by:** upstream game-server integration.

### R4.x-FEAT-15: Two-way chat bridge (PRIORITY: LOW, BLOCKED)

**Description:** Discord ← → game chat relay. Requires loop prevention,
sanitization, rate limiting, and separate threat model.
**Blocked by:** upstream game-server integration, STRIDE review.

### R4.x-FEAT-16: Restore execution (PRIORITY: LOW, BLOCKED)

**Description:** `/dune restore <backup-id>` with owner-only authorization,
out-of-band approval, rollback plan, and enhanced audit retention.
**Blocked by:** upstream adapter support, data-integrity review.

## Roadmap Integration

| Feature | Train | After |
|---------|-------|-------|
| Command cooldowns | R1.1 | security merge |
| Admin diagnostic status | R1.2 | population merge |
| Backup list, logs view | R1.3 | scheduler merge |
| Graceful degradation | R1.4 | compat check merge |
| Button confirmations | R2.0 | R1.x complete |
| Webhook integration | R2.3 | writes foundation |
| Audit view, structured events | R2.4 | R3 readiness |
| Maintenance window, dry-run | R3.0 | R2.x complete |
| Player moderation | R4.0+ | R3.x complete + upstream |

## Next Local Steps

1. Merge security branches into `main`: `security/bot-dependabot-cooldown`,
   `security/bot-gitleaks-allowlist`, `security/bot-health-state-permissions`.
2. Merge in release train order: v1.0.0 → v1.1.0 → v1.2.0 → v1.3.0 → v1.4.0 → v1.5.0.
3. Run the full scanner suite after each merge.
4. Implement R1.x-FEAT-1 (command cooldowns) and R1.x-FEAT-3 (backup list) as
   the highest-priority additional features.
5. Create local feature branches for each additional feature.
6. Update staged PR bodies in `releases/` with completed implementation evidence.
7. Only open upstream PRs after all tests and security gates pass on the merged
   branch (which will be v1.5.0 or v2.0.0 after sequential merging).

## Additional Features — Phase 2 (Zero Upstream Dependency)

These features can be implemented entirely within the bot with no adapter changes.
All are read-only.

### P2-FEAT-17: Role-aware help command (`/dune help`) — PRIORITY: HIGH

**Branch:** `feature/dune-help`
**Complexity:** Low
**Description:** Shows available `/dune` subcommands filtered by the invoking user's role.
Unavailable commands shown as locked. Zero upstream dependency.
**Implementation:** Reads `commandRoleIds` from `config.js` and user's role set from the interaction.
Filters the 19 subcommands into "available" and "locked" lists.

### P2-FEAT-18: Comprehensive diagnostic (`/dune doctor`) — PRIORITY: HIGH

**Branch:** `feature/dune-doctor`
**Complexity:** Low-Medium
**Description:** Aggregates health, status (diagnostic), readiness, and services into
a single diagnostic view. Admin/owner only. Zero upstream dependency.
**Implementation:** Fires multiple existing adapter calls (`health`, `status` with diagnostic,
`readiness`, `services`) in parallel and merges results into one compact report.

### P2-FEAT-19: Cooldown status viewer (`/dune cooldowns`) — PRIORITY: MEDIUM

**Branch:** `feature/dune-cooldowns`
**Complexity:** Low
**Description:** Shows active cooldowns across all users and commands (admin/owner only).
Zero upstream dependency.
**Implementation:** Uses existing `cooldownStats()` export from `src/cooldown.js`.

### P2-FEAT-20: Adapter latency history (`/dune latency`) — PRIORITY: LOW

**Branch:** `feature/dune-latency`
**Complexity:** Low
**Description:** Shows recent adapter response times with route and timing data.
Zero upstream dependency.
**Implementation:** Ring buffer wrapper around `adapterClient.request()` captures
last N requests with route, method, duration, and status.

### P2-FEAT-21: Command usage statistics (`/dune stats`) — PRIORITY: LOW

**Branch:** `feature/dune-stats`
**Complexity:** Low
**Description:** Shows bot command usage metrics (counts per command, error rates).
Admin/owner only. Zero upstream dependency.
**Implementation:** Counter tracking in `commands.js` interaction handler.

### P2-FEAT-22: Recent incident log (`/dune events`) — PRIORITY: MEDIUM

**Branch:** `feature/dune-events`
**Complexity:** Low-Medium
**Description:** Shows recent server events captured by the scheduler (readiness
failures, service down, status degradation) with timestamps. Admin/owner only.
**Implementation:** Ring buffer in scheduler/notifications module; exposes last
N alerts with event type, timestamp, and description.

## Additional Features — Phase 3 (Existing Upstream Route Definitions)

These leverage upstream `DISCORD_ADAPTER_ROUTES` that are defined in the adapter
but lack handler implementations. Minimal upstream changes needed.

### P3-FEAT-23: Map state viewer (`/dune maps`) — PRIORITY: HIGH

**Branch:** `feature/dune-maps`
**Complexity:** Medium
**Description:** Shows running game maps: state (READY/STARTING/DOWN), uptime, metadata.
Upstream route `POST /api/integrations/discord/map-state` is defined in
`DISCORD_ADAPTER_ROUTES` with `MAPS_READ` capability. Needs handler wiring.

### P3-FEAT-24: Container logs viewer (`/dune logs`) — PRIORITY: HIGH

**Branch:** `feature/dune-logs`
**Complexity:** Medium
**Description:** Shows recent container logs for a named service. Capped at 50 lines,
redacted, admin/owner only. Upstream route `POST /api/integrations/discord/logs` is
defined with `LOGS_READ` capability. Needs handler wiring.

## Additional Features — Phase 4 (New Upstream Routes Required)

These require entirely new upstream adapter routes. The underlying `dune` CLI
operations exist in `runner.js` but need adapter exposure.

### P4-FEAT-25: Server config viewer (`/dune config`) — PRIORITY: HIGH

**Branch:** `feature/dune-config`
**Complexity:** High
**Description:** Shows server title, mode, memory, map modes, automation status,
restart schedules, backup auto-status in one view. Requires new aggregate
`POST /api/integrations/discord/config` route.

### P4-FEAT-26: Server ports viewer (`/dune ports`) — PRIORITY: MEDIUM

**Branch:** `feature/dune-ports`
**Complexity:** Low
**Description:** Shows open ports, protocols, and listener status. Requires new
`POST /api/integrations/discord/ports` route. Upstream runner has `ports` operation.

### P4-FEAT-27: Update availability check (`/dune updates`) — PRIORITY: MEDIUM

**Branch:** `feature/dune-updates`
**Complexity:** Medium
**Description:** Shows whether server or self-updates are available, current version,
auto-update status. Requires new `POST /api/integrations/discord/updates` route.

### P4-FEAT-28: Scheduled operations viewer (`/dune schedule`) — PRIORITY: MEDIUM

**Branch:** `feature/dune-schedule`
**Complexity:** Medium
**Description:** Shows restart schedule, backup auto-schedule, update auto-schedule,
IP-change-restart, shutdown-protection status. Requires new
`POST /api/integrations/discord/schedule` aggregate route.

### P4-FEAT-29: Population history (`/dune pop-history`) — PRIORITY: LOW

**Branch:** `feature/dune-pop-history`
**Complexity:** Medium
**Description:** Shows population over time using bot-local cached snapshots from
the scheduler or on-demand polling. Uses existing `POST /api/integrations/discord/population`
route with bot-side time-series cache. No upstream changes needed for the simplest implementation.

## Summary Matrix

| # | Command | Upstream Dep | Complexity | Priority |
|---|---------|-------------|------------|----------|
| P2-17 | `/dune help` | None | Low | HIGH |
| P2-18 | `/dune doctor` | None | Low-Med | HIGH |
| P2-19 | `/dune cooldowns` | None | Low | MEDIUM |
| P2-22 | `/dune events` | None | Low-Med | MEDIUM |
| P2-20 | `/dune latency` | None | Low | LOW |
| P2-21 | `/dune stats` | None | Low | LOW |
| P3-23 | `/dune maps` | Route defined | Medium | HIGH |
| P3-24 | `/dune logs` | Route defined | Medium | HIGH |
| P4-25 | `/dune config` | New route | High | HIGH |
| P4-26 | `/dune ports` | New route | Low | MEDIUM |
| P4-27 | `/dune updates` | New route | Medium | MEDIUM |
| P4-28 | `/dune schedule` | New route | Medium | MEDIUM |
| P4-29 | `/dune pop-history` | None | Medium | LOW |
