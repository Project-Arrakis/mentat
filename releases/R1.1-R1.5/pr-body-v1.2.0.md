# PR-0045: v1.2.0 Read-Only Detail Expansion

## Summary

R1.2 release train: richer service detail, grouped readiness detail, aggregate player summary if upstream exposes safe read-only data.

## User Impact

Operators get more detailed service and readiness information. Player population shown as aggregate summary only.

## Security Impact

- Command surface: expanded (new detail fields on existing commands)
- RBAC or authorization: observer role access maintained
- Secret handling: unchanged
- Data crossing Discord/bot/WebUI boundaries: aggregate-only player data

## Least Privilege

Observer roles can see aggregate player counts only. Detailed service info requires admin role.

## Tests and Evidence

- [ ] Route compatibility tests cover new adapter assumptions
- [ ] Authorization matrix tests for aggregate-only player data
- [ ] `npm run check`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Docker build
- [ ] Trivy image

## Known Limitations

- Player-related output is aggregate-only unless a privacy review explicitly approves a narrower safe shape.

## Sources

- `docs/full-release-roadmap.md`
- `docs/adapter-contract.md`
