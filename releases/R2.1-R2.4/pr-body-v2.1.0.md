# PR-0057: v2.1.0 Maintenance Metadata Writes

## Summary

R2.1 release train: maintenance note set and maintenance window set commands. Low-risk administrative writes behind write-safety foundation.

## User Impact

Operators with write permissions can set maintenance notes and windows via Discord.

## Security Impact

- Command surface: expanded (maintenance note set, maintenance window set)
- RBAC or authorization: write-specific RBAC; observer roles cannot execute
- Secret handling: unchanged

## Least Privilege

Write-specific RBAC. Write routes disabled by default. Confirmation required.

## Tests and Evidence

- [ ] Write path authorization tests
- [ ] Confirmation tests
- [ ] Idempotency tests
- [ ] Audit event tests
- [ ] `npm run check`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Docker build
- [ ] Trivy image

## Known Limitations

- Upstream write-contract RFC must be approved before implementation.
- R2.0.0 write-safety foundation must be merged first.

## Sources

- `docs/full-release-roadmap.md`
