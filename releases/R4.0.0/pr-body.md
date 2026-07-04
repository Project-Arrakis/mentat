# PR-0056: v4.0.0 Highest-Risk Operations

## Summary

R4.0.0+ release train: player, game-state, restore, or database-adjacent operations. Only after lower-risk trains are proven. Planning documentation only.

## User Impact

No runtime changes. Documents the default stance, required controls, and go/no-go gates for highest-risk operations.

## Security Impact

- Command surface: unchanged (planning only)
- RBAC or authorization: owner-level authorization documented as requirement
- Secret handling: unchanged

## Least Privilege

Planning only. Default stance: do not implement unless upstream exposes a narrow, audited, purpose-built adapter action.

## Tests and Evidence

- [ ] Planning review complete

## Known Limitations

- Requires R3.0.0 merged and operational writes proven.

## Sources

- `docs/full-release-roadmap.md`
