# PR-0059: v2.3.0 Scheduled-Post Configuration Writes

## Summary

R2.3 release train: bot-owned scheduled post configuration commands.

## User Impact

Operators with write permissions can configure scheduled post timing, channels, and content preferences.

## Security Impact

- Command surface: expanded (scheduled post config)
- RBAC or authorization: write-specific RBAC; observer roles cannot execute
- Secret handling: unchanged

## Least Privilege

Write-specific RBAC, confirmation required, ephemeral responses by default.

## Tests and Evidence

- [ ] Dry-run/preview tests
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

- R2.0.0 and R2.1.0 must precede implementation.

## Sources

- `docs/full-release-roadmap.md`
