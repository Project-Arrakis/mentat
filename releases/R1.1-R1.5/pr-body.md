# R1.x — Read-Only Maturity Release Train

## Summary

R1.x release train: operator validation, read-only detail expansion, read-only notifications, compatibility hardening, and R2 readiness review. Each minor release is a separate PR; this body covers the combined train overview.

## User Impact

Operators get validation tooling, richer read-only detail, scheduled notifications, compatibility drift detection, and clear R2 entry criteria.

## Security Impact

- Command surface: expanded only with read-only commands
- RBAC or authorization: observer roles remain read-only
- Secret handling: unchanged
- Data crossing Discord/bot/WebUI boundaries: read-only adapter calls only
- Network exposure: unchanged

## Least Privilege

All R1.x releases remain read-only by contract and test. Observer roles cannot trigger writes.

## Tests and Evidence

- [ ] `npm run check`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Docker build
- [ ] Trivy image
- [ ] Route compatibility tests cover new adapter assumptions
- [ ] Player-related output is aggregate-only

## Known Limitations

- Write-capable commands remain out of scope for the R1.x train.

## Sources

- `docs/full-release-roadmap.md`
- `docs/r1-r2-release-roadmap.md`
- `docs/operator-validation.md`
