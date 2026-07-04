# PR-0058: v2.2.0 Notification Configuration Writes

## Summary

R2.2 release train: Discord notification configuration set commands.

## User Impact

Operators with write permissions can configure notification settings through Discord commands.

## Security Impact

- Command surface: expanded (notification config set)
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

## Sources

- `docs/full-release-roadmap.md`
