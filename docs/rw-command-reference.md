# Write Command Reference

Per-command specifications for all 12 write commands across 4 families.
All commands require `DUNE_DISCORD_WRITES_ENABLED=true` and write-specific RBAC.

## Maintenance Family

### set-maintenance-note

| Field | Value |
|-------|-------|
| Action | `maintenance:set-note` |
| Risk | Low |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `note` (string, 1-500 chars, printable only) |
| Side Effects | config-write |
| Rollback | Set note to empty string |

**Example:**
```
/dune admin set-maintenance-note note:"Scheduled restart at 02:00 UTC"
```

### set-maintenance-window

| Field | Value |
|-------|-------|
| Action | `maintenance:set-window` |
| Risk | Low |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `startTime` (ISO 8601), `durationMinutes` (1-1440), `reason` (string, 1-200 chars) |
| Side Effects | config-write, may suppress alerts |
| Rollback | Clear maintenance window |

**Example:**
```
/dune admin set-maintenance-window start:"2026-07-09T02:00:00Z" duration:120 reason:"Database migration"
```

---

## Notifications Family

### set-alert-channel

| Field | Value |
|-------|-------|
| Action | `notifications:set-alert-channel` |
| Risk | Low |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `channelId` (Discord channel ID), `alertTypes` (comma-separated: readiness,services,population) |
| Side Effects | config-write |
| Rollback | Remove channel from alert config |

### set-alert-threshold

| Field | Value |
|-------|-------|
| Action | `notifications:set-threshold` |
| Risk | Medium |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `metric` (readiness/services/population), `condition` (lt/gt/eq), `value` (integer) |
| Side Effects | config-write, may trigger existing alerts |
| Rollback | Reset threshold to default |

### set-digest-schedule

| Field | Value |
|-------|-------|
| Action | `notifications:set-digest-schedule` |
| Risk | Low |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `intervalMinutes` (5-1440), `channelId` (Discord channel ID) |
| Side Effects | config-write |
| Rollback | Disable digest schedule |

---

## Schedule Family

### set-post-schedule

| Field | Value |
|-------|-------|
| Action | `schedule:set-post-schedule` |
| Risk | Low |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `scheduleType` (status/status-summary/readiness/services/none), `intervalMinutes` (5-1440) |
| Side Effects | config-write, changes scheduler behavior |
| Rollback | Set scheduleType to "none" |

### add-post-channel

| Field | Value |
|-------|-------|
| Action | `schedule:add-channel` |
| Risk | Medium |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `channelId` (Discord channel ID) |
| Side Effects | config-write, posts begin appearing in channel |
| Rollback | Remove channel from schedule config |

### remove-post-channel

| Field | Value |
|-------|-------|
| Action | `schedule:remove-channel` |
| Risk | Medium |
| Tier | Admin |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `channelId` (Discord channel ID) |
| Side Effects | config-write, posts stop in channel |
| Rollback | Re-add channel |

---

## Operational Family

### create-backup

| Field | Value |
|-------|-------|
| Action | `operations:create-backup` |
| Risk | Medium |
| Tier | Owner |
| Dry-run | ✅ Supported |
| Confirmation | Required (strong wording) |
| Idempotency | Required |
| Parameters | `label` (string, 1-100 chars), `outputDir` (optional) |
| Side Effects | Disk I/O, game server may pause briefly |
| Rollback | Delete backup file (manual) |

**Confirmation wording:** "⚠️ CREATING A BACKUP may briefly pause the game server. This cannot be undone."

### restart-service

| Field | Value |
|-------|-------|
| Action | `operations:restart-service` |
| Risk | High |
| Tier | Owner |
| Dry-run | ✅ Supported |
| Confirmation | Required (strong wording) |
| Idempotency | Required |
| Parameters | `service` (gateway/survival-1/overmap/rmq-game/postgres), `reason` (string, 1-200 chars) |
| Side Effects | Service downtime, player disconnects |
| Rollback | None (restart is atomic) |

**Confirmation wording:** "🔴 RESTARTING `{service}` will disconnect players and cause downtime. Confirm only if maintenance window is active."

### trigger-update

| Field | Value |
|-------|-------|
| Action | `operations:trigger-update` |
| Risk | High |
| Tier | Owner |
| Dry-run | ✅ Supported |
| Confirmation | Required (strong wording) |
| Idempotency | Required |
| Parameters | `updateType` (game/steamcmd/self) |
| Side Effects | Server restart, extended downtime |
| Rollback | None (update is irreversible) |

**Confirmation wording:** "🔴 TRIGGERING UPDATE will restart the server and may cause extended downtime. Verify backups exist first."

### clear-cache

| Field | Value |
|-------|-------|
| Action | `operations:clear-cache` |
| Risk | Medium |
| Tier | Owner |
| Dry-run | ✅ Supported |
| Confirmation | Required |
| Idempotency | Required |
| Parameters | `cacheType` (steam/maps/derived) |
| Side Effects | Temporary performance degradation |
| Rollback | None (cache rebuilds automatically) |

## RBAC Matrix

| Command | Observer | Write Admin | Write Owner |
|---------|----------|-------------|-------------|
| set-maintenance-note | ❌ | ✅ | ✅ |
| set-maintenance-window | ❌ | ✅ | ✅ |
| set-alert-channel | ❌ | ✅ | ✅ |
| set-alert-threshold | ❌ | ✅ | ✅ |
| set-digest-schedule | ❌ | ✅ | ✅ |
| set-post-schedule | ❌ | ✅ | ✅ |
| add-post-channel | ❌ | ✅ | ✅ |
| remove-post-channel | ❌ | ✅ | ✅ |
| create-backup | ❌ | ❌ | ✅ |
| restart-service | ❌ | ❌ | ✅ |
| trigger-update | ❌ | ❌ | ✅ |
| clear-cache | ❌ | ❌ | ✅ |

## Parameter Validation

All parameters must be validated on the bot side before sending to the adapter:

| Type | Validation |
|------|-----------|
| Discord ID | 17-20 digit numeric string |
| ISO 8601 timestamp | Valid date, not in the past (>1 minute ago except for tests) |
| Free text | 1-500 chars, printable Unicode, no control characters |
| Enum | Must be one of the allowed values |
| Integer range | Within specified min/max, safe integer |

## Error Modes per Command

Every command must handle these error modes:

1. **Adapter timeout** (no response in 8s) → "Write adapter did not respond"
2. **Adapter 403** → "Not authorized for this action"
3. **Adapter 409** (idempotency collision) → "This action was already executed"
4. **Adapter 400** (validation) → "Invalid parameters: {details}"
5. **Adapter 500** (execution failure) → "Action failed: {details}"
6. **Confirmation timeout** (60s) → "Confirmation cancelled (timeout)"
7. **Confirmation cancelled** → "Action cancelled"

## Sources

- [Write Architecture](rw-architecture.md)
- [Adapter Contract](rw-adapter-contract.md)
- [Confirmation Flow](rw-confirmation-flow.md)
- [Rollback & Recovery](rw-rollback-recovery.md)
- [Write Command Stubs](../src/writeCommands.js)
- [Non-Read-Only Roadmap](non-readonly-roadmap.md)
