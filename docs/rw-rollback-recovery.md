# Write Rollback & Recovery

Every write-capable command must have a documented rollback path. Some
operations are irreversible (restart, update) — in these cases, the
rollback column documents the recovery procedure instead.

## Rollback Matrix

| Command | Rollback | Reversible? | Recovery Time |
|---------|----------|-------------|---------------|
| set-maintenance-note | Set note to empty string | ✅ Yes | Instant |
| set-maintenance-window | Clear window via same command | ✅ Yes | Instant |
| set-alert-channel | Remove channel from alert config | ✅ Yes | Instant |
| set-alert-threshold | Reset threshold to default value | ✅ Yes | Instant |
| set-digest-schedule | Disable digest schedule | ✅ Yes | Instant |
| set-post-schedule | Set scheduleType to "none" | ✅ Yes | Instant |
| add-post-channel | Remove channel from schedule | ✅ Yes | Instant |
| remove-post-channel | Re-add channel to schedule | ✅ Yes | Instant |
| create-backup | Delete backup file (manual) | ✅ Yes | Manual |
| restart-service | Wait for service to recover | ❌ No | 30-120s |
| trigger-update | Wait for update to complete | ❌ No | 5-30 min |
| clear-cache | Wait for cache rebuild | ❌ No | 1-10 min |

## Recovery Procedures

### restart-service Recovery

1. **Monitor:** Watch `/dune server status` for the service to return to READY.
2. **Timeout:** If service does not recover within 5 minutes, check container logs:
   ```bash
   docker logs dune-server-{survival|overmap|gateway}
   ```
3. **Manual intervention:** If the container is stuck restarting, stop and start it:
   ```bash
   docker restart dune-server-survival-1
   ```
4. **Escalation:** If the service fails to start, run `dune doctor` and check
   Docker daemon health. Check that required ports are available.
5. **Notify:** If recovery exceeds expected time, use `/dune admin broadcast` to
   notify players of extended downtime.

### trigger-update Recovery

1. **Monitor:** Watch `/dune server status` for the server to return to READY.
2. **Verify:** Run `dune update check` to confirm the update applied.
3. **Rollback (if possible):** If the update causes issues, use `dune self-update
   install <previous-tag>` to revert to the previous version.
4. **Fallback:** If the update fails and the server is in an unrecoverable state:
   - Stop all services: `dune stop`
   - Restore from latest backup: `dune db restore <latest-backup>`
   - Start services: `dune start`
5. **Notify:** Keep the community updated via announcements channel.

### clear-cache Recovery

Cache clears are self-healing. No manual intervention needed:
- Steam cache: rebuilds on next game server start.
- Map cache: regenerates on next map load.
- Derived data: recomputed within 5-10 minutes.

Monitor `/dune server status` for the server to return to READY.

## Emergency Disable

All write commands can be disabled immediately by setting:

```bash
DUNE_DISCORD_WRITES_ENABLED=false
```

Then restart the bot container. All write commands return "disabled" errors.
No pending writes are executed. The idempotency lock is cleared on restart.

## Audit Trail Reconstruction

After a write-related incident, reconstruct the sequence of events:

1. Check the adapter's audit log (console-side):
   ```bash
   cat runtime/generated/web-admin-audit.jsonl | grep discord-write
   ```

2. Check the bot's logs for write events:
   ```bash
   docker logs dune-discord-bot | grep write
   ```

3. Cross-reference idempotency keys across both logs to verify execution.

4. Check Discord audit logs for user action timestamps.

## Post-Incident Review Template

After any write-related incident:

```markdown
### Incident Summary
- Date/Time:
- Command:
- Actor:
- What happened:
- Impact:

### Root Cause
- Why did it happen:
- Was confirmation bypassed?:
- Was idempotency violated?:

### Recovery
- Steps taken:
- Recovery time:
- Data loss (if any):

### Prevention
- What needs to change:
- New rollback procedure:
- Updated documentation:
- Test case added:
```

## Sources

- [Write Architecture](rw-architecture.md)
- [Command Reference](rw-command-reference.md)
- [Adapter Contract](rw-adapter-contract.md)
- [Full Release Roadmap](full-release-roadmap.md)
