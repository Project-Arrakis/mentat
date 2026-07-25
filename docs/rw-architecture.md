# Write System Architecture

## Overview

The write system enables authorized Discord users to execute server-side actions
through the bot. Every write command follows a multi-layer security pipeline:
authentication → authorization → confirmation → idempotency → execution → audit.

All write paths are **disabled by default** (`DUNE_DISCORD_WRITES_ENABLED=false`).
Until an upstream write-adapter contract is approved and implemented, no write
command can execute — the system is scaffolding-only.

**Implementation status:** layers 1-9 below (feature flag through
confirmation/idempotency-key generation) are implemented, including a real
Discord button-based confirmation UI (`src/writeConfirmation.js`, wired into
`src/index.js`'s `InteractionCreate` listener). Layers 10-11 (adapter
execution and its audit trail) are **not implemented and not wired**:
confirming a write always reports a "scaffolded, awaiting upstream contract"
result and never calls `adapterClient.writeExecute()`/`writePreview()`. See
`docs/rw-confirmation-flow.md` for the current-vs-forward-looking split in
more detail.

## Architecture Diagram

```
Discord User                    Bot                        Upstream Adapter
───────────                     ───                        ────────────────
    │                            │                              │
    │  /dune admin broadcast    │                              │
    │  message:"restart in 5m"  │                              │
    │ ─────────────────────────►│                              │
    │                            │  writesEnabled()?            │
    │                            │  canWrite()?                 │
    │                            │  cooldown ok?                │
    │                            │                              │
    │  "Confirm: restart in 5m   │                              │
    │   to all players?         │                              │
    │   [Confirm] [Cancel]"     │                              │
    │ ◄─────────────────────────│                              │
    │                            │                              │
    │  [Confirm] click           │                              │
    │ ─────────────────────────►│                              │
    │                            │  generateIdempotencyKey()    │
    │                            │                              │
    │                            │  POST /write/preview  ──────►│
    │                            │  {action,params,idempotKey}  │
    │                            │                              │
    │                            │  ◄──── 200 {ok,preview}      │
    │                            │                              │
    │                            │  POST /write/execute ───────►│
    │                            │  {action,params,idempotKey,  │
    │                            │   confirmation, signature}   │
    │                            │                              │
    │                            │  ◄──── 200 {ok,auditId}      │
    │                            │                              │
    │  "✅ Broadcast sent"       │  writeAuditEvent()              │
    │ ◄─────────────────────────│                              │
    │                            │                              │
```

## Security Layers

Each layer must pass before the next one executes. Failure at any layer returns
an ephemeral error to the Discord user.

| Layer | Component | Gate | Status |
|-------|-----------|------|--------|
| 1. Feature Flag | `writes.js::writesEnabled()` | `DUNE_DISCORD_WRITES_ENABLED=true` required | Implemented |
| 2. Authentication | Discord interaction context | Valid Discord user, guild, and channel | Implemented |
| 3. Authorization | `writes.js::canWrite()` | User has write-admin or write-owner role | Implemented |
| 4. Tier Check | `writes.js::canWrite(interaction, config, requiredTier)`, called from `writeHandler.js` with each command's `tier` | Command tier ≤ user tier (write-admin cannot reach owner-tier actions: restart-service, trigger-update, create-backup, clear-cache) | Implemented. **Note:** `writeCommands.js` (an earlier, separate scaffold from the same PR #63 foundation) is not the live path — `commands.js` only calls `writeHandler.js::handleWriteCommand()`. Do not treat `writeCommands.js` as authoritative for tier enforcement. |
| 5. Cooldown | Per-command rate limiter | User hasn't exceeded rate limit for this command | **Not implemented.** `cooldown.js`'s `checkCooldown()`/`applyCooldown()` apply to all commands generically by `group:subcommand` key, but there is no write-specific rate limit distinct from the standard per-command cooldown. |
| 6. Concurrency | Global write semaphore | No conflicting write in progress | **Not implemented.** No semaphore or lock exists; moot today since no execution occurs, but must be added before any real `writeExecute()` wiring. |
| 7. Validation | Per-command validator | Parameters are safe and within bounds | **Partially implemented.** Discord slash-command option definitions enforce basic constraints (`maxLength`, `minValue`/`maxValue`, required) at the Discord API level (see `commands.js` `write` subcommand group). `writeHandler.js` does not re-validate parameter values against `WRITE_COMMANDS[].params` before returning the confirmation prompt. |
| 8. Confirmation | `writeConfirmation.js` (button-based UI, not `writes.js::requireConfirmation()`'s text prompt) | User explicitly confirms action/tier/risk via Discord buttons | Implemented. See `docs/rw-confirmation-flow.md`. |
| 9. Idempotency | `writes.js::generateIdempotencyKey()` | Key prevents duplicate execution | Key generation is implemented; there is no idempotency *store* to check against on retry, since there is no execution step yet to be idempotent about. |
| 10. Execution | `adapterClient.writeExecute()` | Adapter validates and executes | **Not implemented/not wired.** No code path calls this method. `write-execute`/`write-preview` are in `MISSING_ROUTES` (`adapterClient.js`) — no upstream contract exists. |
| 11. Audit | `writes.js::writeAuditEvent()` | Structured event recorded | Event *construction* is implemented and unit-tested; there is no sink that persists these events anywhere (no log write, no file, no console call) beyond the confirmation-timeout path in `writeConfirmation.js`, which is also in-memory only. |

## State Machine

```
  IDLE
    │
    ├─── user invokes write command ───► VALIDATING
    │                                      │
    │                    ┌─────────────────┤
    │                    │ auth fail       │ auth pass
    │                    ▼                 ▼
    │              ERROR (ephemeral)   PENDING_CONFIRMATION
    │                                      │
    │                    ┌─────────────────┤
    │                    │ cancel/timeout  │ confirm
    │                    ▼                 ▼
    │              CANCELLED           EXECUTING
    │                                      │
    │                    ┌─────────────────┤
    │                    │ adapter error   │ success
    │                    ▼                 ▼
    │              ERROR (ephemeral)   COMPLETED
    │                                      │
    │                                      ▼
    │                              AUDIT_RECORDED
    │
    └─── (returns to IDLE)
```

## Component Map

### Bot-Side Components

| Component | File | Role | Status |
|-----------|------|------|--------|
| Feature flag | `writes.js` | Master enable/disable | Implemented |
| Authorization + tier enforcement | `writes.js::canWrite(interaction, config, requiredTier)`, called from `writeHandler.js` | Admin vs owner command gating | Implemented. **`writeCommands.js` is not the live tier-enforcement path** — it is a separate, unused command-execution scaffold from the same PR #63 foundation; `commands.js` never imports it. |
| Confirmation | `writeConfirmation.js` (not `writes.js` → `embedFormat.js`) | Button-based confirmation UI | Implemented; see `docs/rw-confirmation-flow.md` |
| Idempotency | `writes.js` | Key generation (no collision store yet — nothing to collide with until execution exists) | Partially implemented |
| Audit schema | `writes.js::writeAuditEvent()` | Structured event object (construction only, no persistence sink) | Partially implemented |
| Rate limiting | `cooldown.js` | Generic per-user, per-command cooldowns (not write-specific) | Implemented generically, not write-specific |
| Adapter client | `adapterClient.js::writeExecute()`/`writePreview()` | HTTP calls to write routes | Method signatures exist; never called by any code path |
| Command registration | `commands.js` | Discord slash command builder | Implemented |
| Interaction handler | `index.js` | Button interaction routing to `writeConfirmation.js::handleWriteButtonInteraction()` | Implemented |

### Adapter-Side Components (Upstream)

| Component | Route | Role |
|-----------|-------|------|
| Capability discovery | `GET /api/integrations/discord/write/capabilities` | Advertise available actions |
| Preview | `POST /api/integrations/discord/write/preview` | Validate without side effects |
| Execute | `POST /api/integrations/discord/write/execute` | Execute with idempotency |
| Audit | Console-side | Record every write attempt |

## Data Flow — Confirmation Nonce Exchange

**Not implemented.** No nonce is generated, exchanged, or validated today
because no `POST /write/preview` or `POST /write/execute` call is ever made
(see the Implementation Status note above). The confirmation step today is
protected only by the idempotency key embedded in the button `customId` plus
the user-ID check in `handleWriteButtonInteraction()` — it is not a
replay-protected two-phase preview/execute exchange. The target design, for
once a real upstream write-adapter contract exists, is:

1. Bot calls `POST /write/preview` with the proposed action.
2. Adapter returns a confirmation nonce in the preview response.
3. Bot presents the confirmation UI to the user.
4. User clicks Confirm.
5. Bot calls `POST /write/execute` with the confirmation nonce.
6. Adapter validates the nonce (one-time use, short TTL) before executing.

This would ensure that only a confirmed preview can result in execution.

## Error Handling

The table below is the target design once real adapter execution exists.
Only "Not authorized" and "Confirmation timeout" are reachable today —
everything downstream of confirmation (rate limiting the write path
specifically, adapter calls, execution, idempotency collisions) does not
exist yet, so those rows are not currently reachable code paths.

| Error Category | HTTP | Bot Response | Audit | Reachable Today? |
|---------------|------|-------------|-------|-------|
| Not authorized | 403 | Ephemeral "not authorized" | Blocked event | Yes |
| Rate limited | 429 | Ephemeral "wait Ns" | Blocked event | No (no write-specific rate limit) |
| Validation failed | 400 | Ephemeral error message | Blocked event | No (no adapter-side validation call) |
| Confirmation timeout | N/A | Ephemeral "cancelled" | Timeout event | Partially — audit event fires; original message is not edited (see `docs/rw-confirmation-flow.md` known limitation) |
| Adapter unavailable | 503 | Ephemeral "adapter down" | Attempt event | No (no adapter call is made) |
| Execution failed | 500 | Ephemeral error | Failure event | No (no execution call is made) |
| Idempotency collision | 409 | Ephemeral "already executed" | Duplicate event | No (no idempotency store to collide against) |

## Rollback Paths

Every write command must have a documented rollback path. See
[Rollback & Recovery](rw-rollback-recovery.md) for per-command procedures.

## Sources

- [Upstream Write Adapter RFC](upstream-write-adapter-rfc.md)
- [Write Safety Primitives](../src/writes.js)
- [Write Command Handler (live path)](../src/writeHandler.js)
- [Write Confirmation UI](../src/writeConfirmation.js)
- [Write Command Stubs (dead code, not the live path)](../src/writeCommands.js)
- [Non-Read-Only Roadmap](non-readonly-roadmap.md)
- [Full Release Roadmap](full-release-roadmap.md)
- [Security Model](security-model.md)
