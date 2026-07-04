# PR-0044: v1.1.0 Operator Validation

## Summary

R1.1 release train: operator validation. Adds documented runtime smoke tests, test-guild registration evidence, mock-adapter scenarios, and a Docker healthcheck checklist.

## User Impact

Operators can run `npm run smoke:adapter` to verify the bot works end-to-end against a local mock adapter.

## Security Impact

- Command surface: unchanged (all read-only)
- RBAC or authorization: unchanged
- Secret handling: unchanged
- Data crossing Discord/bot/WebUI boundaries: unchanged

## Least Privilege

Same as v1.0.0. Bot remains read-only.

## Tests and Evidence

- [ ] `npm run check`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Docker build
- [ ] Trivy image

## Known Limitations

- Write-capable commands remain out of scope.

## Sources

- `docs/r1-r2-release-roadmap.md`
- `docs/operator-validation.md`
