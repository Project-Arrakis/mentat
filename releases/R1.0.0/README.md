# R1.0.0 — Read-Only Production GA

**Version**: v1.0.0
**Branch**: `release/v1.0.0`
**PR**: [#43](https://github.com/yacketrj/Arrakis-Control-Panel/pull/43)
**State**: Open

## Scope

Stable promotion of the read-only Arrakis Control Panel release from
v1.0.0-rc.1 to v1.0.0.

## Included Commands

- `/dune about`
- `/dune ping`
- `/dune health`
- `/dune status`
- `/dune status-summary`
- `/dune readiness`
- `/dune services`

## Artifacts

| Artifact | Location |
|----------|----------|
| Change note | `docs/changes/PR-0043-v1.0.0-stable-promotion.md` |
| Release notes | `docs/releases/v1.0.0.md` |
| Promotion checklist | `docs/v1.0.0-promotion-checklist.md` |
| PR body | `docs/PR-v1.0.0-release.md` |

## Promotion Gates

- [x] v1.0.0-rc.1 passed candidate gates
- [x] Production docs current
- [x] Owner approval recorded
- [ ] Zero unresolved medium/high/critical findings
- [ ] npm run check
- [ ] npm audit --audit-level=moderate
- [ ] Semgrep
- [ ] Gitleaks
- [ ] Trivy filesystem
- [ ] Trivy image
- [ ] Docker build
- [ ] SBOM checksum verification
- [ ] Annotated tag from clean main
- [ ] Rollback path documented
