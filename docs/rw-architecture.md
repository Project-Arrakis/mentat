# Write System Architecture

## Overview

The write system enables authorized Discord users to execute server-side actions
through the bot. Every write command follows a multi-layer security pipeline:
authentication → authorization → confirmation → idempotency → execution → audit.

All write paths are **disabled by default** (`DUNE_DISCORD_WRITES_ENABLED=false`).
Until an upstream write-adapter contract is approved and implemented, no write
command can execute — the system is scaffolding-only.

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

| Layer | Component | Gate |
|-------|-----------|------|
| 1. Feature Flag | `writes.js::writesEnabled()` | `DUNE_DISCORD_WRITES_ENABLED=true` required |
| 2. Authentication | Discord interaction context | Valid Discord user, guild, and channel |
| 3. Authorization | `writes.js::canWrite()` | User has write-admin or write-owner role |
| 4. Tier Check | `writeCommands.js` | Command tier ≤ user tier (admin cannot do owner ops) |
| 5. Cooldown | Per-command rate limiter | User hasn't exceeded rate limit for this command |
| 6. Concurrency | Global write semaphore | No conflicting write in progress |
| 7. Validation | Per-command validator | Parameters are safe and within bounds |
| 8. Confirmation | `writes.js::requireConfirmation()` | User explicitly confirms action/target/risk |
| 9. Idempotency | `writes.js::generateIdempotencyKey()` | Key prevents duplicate execution |
| 10. Execution | `adapterClient.writeExecute()` | Adapter validates and executes |
| 11. Audit | `writes.js::writeAuditEvent()` | Structured event recorded |

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

| Component | File | Role |
|-----------|------|------|
| Feature flag | `writes.js` | Master enable/disable |
| Authorization | `writes.js` | Role-based access check |
| Tier enforcement | `writeCommands.js` | Admin vs owner command gating |
| Confirmation | `writes.js` → `embedFormat.js` | Button-based confirmation UI |
| Idempotency | `writes.js` | Key generation and collision detection |
| Audit schema | `writes.js` | Structured event object |
| Rate limiting | `cooldown.js` (extend) | Per-user, per-command cooldowns |
| Adapter client | `adapterClient.js` (extend) | HTTP calls to write routes |
| Command registration | `commands.js` (extend) | Discord slash command builder |
| Interaction handler | `index.js` (extend) | Button interaction routing |

### Adapter-Side Components (Upstream)

| Component | Route | Role |
|-----------|-------|------|
| Capability discovery | `GET /api/integrations/discord/write/capabilities` | Advertise available actions |
| Preview | `POST /api/integrations/discord/write/preview` | Validate without side effects |
| Execute | `POST /api/integrations/discord/write/execute` | Execute with idempotency |
| Audit | Console-side | Record every write attempt |

## Data Flow — Confirmation Nonce Exchange

To prevent replay attacks on the confirmation step, a confirmation nonce is
exchanged between bot and adapter:

1. Bot calls `POST /write/preview` with the proposed action.
2. Adapter returns a confirmation nonce in the preview response.
3. Bot presents the confirmation UI to the user.
4. User clicks Confirm.
5. Bot calls `POST /write/execute` with the confirmation nonce.
6. Adapter validates the nonce (one-time use, short TTL) before executing.

This ensures that only a confirmed preview can result in execution.

## Error Handling

| Error Category | HTTP | Bot Response | Audit |
|---------------|------|-------------|-------|
| Not authorized | 403 | Ephemeral "not authorized" | Blocked event |
| Rate limited | 429 | Ephemeral "wait Ns" | Blocked event |
| Validation failed | 400 | Ephemeral error message | Blocked event |
| Confirmation timeout | N/A | Ephemeral "cancelled" | Timeout event |
| Adapter unavailable | 503 | Ephemeral "adapter down" | Attempt event |
| Execution failed | 500 | Ephemeral error | Failure event |
| Idempotency collision | 409 | Ephemeral "already executed" | Duplicate event |

## Rollback Paths

Every write command must have a documented rollback path. See
[Rollback & Recovery](rw-rollback-recovery.md) for per-command procedures.

## Sources

- [Upstream Write Adapter RFC](upstream-write-adapter-rfc.md)
- [Write Safety Primitives](../src/writes.js)
- [Write Command Stubs](../src/writeCommands.js)
- [Non-Read-Only Roadmap](non-readonly-roadmap.md)
- [Full Release Roadmap](full-release-roadmap.md)
- [Security Model](security-model.md)
