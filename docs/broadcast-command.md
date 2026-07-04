# Broadcast Command (Write-Capable)

`/dune broadcast <message>` — Send a message to all in-game players.
Requires write-enabled mode and moderator or admin role. Disabled by default.

## Usage

```
/dune broadcast message:"Server restart in 10 minutes"
```

The command requires:
1. `DUNE_DISCORD_WRITES_ENABLED=true` at the bot level
2. User has a role in `DISCORD_WRITE_ADMIN_ROLE_IDS` or `DISCORD_WRITE_OWNER_ROLE_IDS`
3. Confirmation of the broadcast before execution
4. 60-second per-user cooldown between broadcasts

## Confirmation Flow

After entering the command, the bot returns a confirmation prompt:

```
**Confirm write action:** broadcast
Target: "Server restart in 10 minutes"
Risk: low

Reply with confirm to execute, or cancel to abort.
```

The broadcast is only sent after the operator confirms.

## Response

```json
{
  "ok": true,
  "idempotencyKey": "dune-idem-...",
  "message": "Server restart in 10 minutes",
  "needsConfirmation": true,
  "confirmationMessage": "..."
}
```

## RBAC

| Role | Access |
|------|--------|
| Observer | Denied |
| Admin with write role | Allowed |
| Owner with write role | Allowed |
| Public | Denied |

## Adapter Route

| Method | Path |
|--------|------|
| POST | `/api/integrations/discord/broadcast` |

Configurable via `DUNE_ADAPTER_BROADCAST_PATH` and `DUNE_ADAPTER_BROADCAST_METHOD`.

## Security Controls

| Control | Implementation |
|---------|---------------|
| Disabled by default | `DUNE_DISCORD_WRITES_ENABLED=true` required |
| RBAC | Write-specific roles (`DISCORD_WRITE_ADMIN_ROLE_IDS`, `DISCORD_WRITE_OWNER_ROLE_IDS`) |
| Confirmation | Action, target, and risk displayed; cannot be bypassed |
| Idempotency | Per-request key prevents duplicate execution |
| Cooldown | 60 seconds per user |
| Audit | Structured audit event with actor, action, result |
| Validation | Message must be 1–500 printable characters |
| Ephemeral | Confirmation prompt is ephemeral (only visible to broadcaster) |

## Implementation

Source: `src/broadcast.js` (`executeBroadcast`, `sendBroadcastToAdapter`),
`src/writes.js` (`writesEnabled`, `canWrite`, `requireConfirmation`,
`generateIdempotencyKey`, `writeAuditEvent`). Added in v1.5.0.
