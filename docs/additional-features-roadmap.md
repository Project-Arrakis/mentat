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

### R2.x-FEAT-8: Command usage audit view (PRIORITY: MEDIUM)

**Branch:** `release/v2.4.0`
**Description:** `/dune audit [limit]` shows recent command executions
(who ran what, when, result) for operator accountability. Admin/owner only.
**Implementation:** In-memory audit log ring buffer (last N events);
queryable via audit command; output redacted.

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
