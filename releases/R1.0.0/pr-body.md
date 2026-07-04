# PR-0043: v1.0.0 Stable Release Promotion

## Summary

Promote v1.0.0-rc.1 release candidate to stable v1.0.0. This is the first
stable GA of the read-only Discord bot. No code changes beyond version bump,
changelog, and release documentation.

## User Impact

Operators now have a stable release instead of a release candidate. Recommended
for production use.

## Security Impact

- Command surface: unchanged (all read-only)
- RBAC or authorization: unchanged
- Secret handling: unchanged
- Data crossing Discord/bot/WebUI boundaries: unchanged
- Network exposure: unchanged

## Least Privilege

Same as v1.0.0-rc.1. Bot remains read-only, bearer-token authenticated, RBAC-enforced.

## Tests and Evidence

- [ ] `npm run check`
- [ ] `npm audit --audit-level=moderate`
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Dependency review
- [ ] SBOM generation
- [ ] Docker build
- [ ] Trivy image
- [ ] Promotion checklist evidence current

## Known Limitations

- No hosted shared bot.
- Write-capable commands out of scope for this release train.

## Sources

- `docs/release-process.md`
- `docs/production-release-plan.md`
- `docs/v1.0.0-promotion-checklist.md`
