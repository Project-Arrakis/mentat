# PR-0047: v1.4.0 Compatibility Hardening

## Summary

R1.4 release train: drift detection between bot and adapter, fixture refresh for compatibility testing, enhanced route coverage with property-based testing.

## User Impact

Operators benefit from early drift detection warning when adapter contracts change.

## Security Impact

- Command surface: unchanged (all read-only)
- RBAC or authorization: unchanged
- Secret handling: unchanged

## Least Privilege

Same as v1.3.0. All routes remain read-only.

## Tests and Evidence

- [ ] Drift detection unit tests
- [ ] Fixture refresh scripts
- [ ] Property-based route coverage tests
- [ ] `npm run check`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Docker build
- [ ] Trivy image

## Known Limitations

- Drift detection is test-time only.

## Sources

- `docs/full-release-roadmap.md`
- `docs/verification.md`
