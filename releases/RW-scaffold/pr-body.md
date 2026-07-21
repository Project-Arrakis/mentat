# RW Command Scaffold — 12 Write Commands

## Summary

Adds `/dune write` subcommand group with 12 write commands across 4 families.
All commands return "disabled" until `DUNE_DISCORD_WRITES_ENABLED=true` and
the upstream write-adapter contract is implemented.

## Command Families

| Family | Commands | Risk | Tier |
|--------|----------|------|------|
| Maintenance | maintenance-note, maintenance-window | Low | Admin |
| Notifications | alert-channel, alert-threshold, digest-schedule | Low-Med | Admin |
| Schedule | post-schedule, add-channel, remove-channel | Low-Med | Admin |
| Operational | backup, restart, update, cache | Med-High | Owner |

## Security Impact

- Command surface: expanded with 12 write commands (all disabled)
- RBAC: write-specific tiers (admin/owner) via writes.js
- Secret handling: unchanged
- No adapter calls until upstream contract implemented

## Least Privilege

All write paths disabled by default. Requires DUNE_DISCORD_WRITES_ENABLED=true
AND write-admin/write-owner role assignment.

## Tests and Evidence

- [x] `npm run check` — 135/135 pass
- [x] All security gates pass

## Known Limitations

- Upstream write-adapter contract not yet implemented
- All commands return "pending upstream contract" status
- Button-based confirmations not yet wired (text-based only)
- No adapter execute calls until routes exist

## Sources

- docs/rw-architecture.md
- docs/rw-command-reference.md
- docs/rw-adapter-contract.md
- src/writeHandler.js
- src/writes.js
