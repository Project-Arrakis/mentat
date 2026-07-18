# Release Staging Index

Staging area for **future** upstream PRs. **No upstream PRs are open.**
All feature work is implemented on local branches, tested, and staged.
When a train is validated, use `pr-body.md` with `gh pr create --body-file`.

## Current Implementation State — main (v1.5.0)

| Feature | Status | Source |
|---------|--------|--------|
| 7 read-only commands | Implemented | `src/commands.js` |
| Population command | Implemented | `src/commands.js`, `src/adapterClient.js` |
| Backup list command | Implemented | `src/commands.js`, `src/adapterClient.js` |
| Operator validation | Implemented | `scripts/validate-operator.js` |
| Notification scheduler | Implemented | `src/scheduler.js`, `src/notifications.js` |
| Adapter compatibility check | Implemented | `scripts/check-compatibility.js` |
| Command cooldowns | Implemented | `src/cooldown.js` |
| Write-safety foundation | Implemented | `src/writes.js` (R2.0.0 branch) |
| Write command stubs | Implemented | `src/writeCommands.js` (R2.1-3.0 branches) |
| Health-state permissions | Implemented | `src/healthState.js` |
| Dependabot cooldown | Implemented | `.github/dependabot.yml` |
| Gitleaks allowlist | Implemented | `.gitleaksignore` |

## Strict Gates — main (v1.5.0)

| Gate | Result |
|------|--------|
| `npm run check` | 109/109 pass |
| Release metadata | OK for v1.5.0 |
| `npm audit --audit-level=moderate` | 0 vulnerabilities |
| Semgrep | 0 findings |
| Gitleaks | 0 leaks |
| Trivy filesystem | 0 findings |
| Trivy image | 0 findings |
| Docker build | Success |
| Addon package | Zero-permission, checksum verified |
| SBOM | Generated, 25 components |

## Release Train Manifest

| Train | Version | Scope | Branch | Feature Branch | Status |
|-------|---------|-------|--------|----------------|--------|
| R1.0.0 | v1.0.0 | Stable read-only GA | `release/v1.0.0` | — | Merged into main |
| R1.1 | v1.1.0 | Operator validation | `release/v1.1.0` | — | Merged into main |
| R1.2 | v1.2.0 | Population command | `release/v1.2.0` | — | Merged into main |
| R1.3 | v1.3.0 | Notification scheduler | `release/v1.3.0` | — | Merged into main |
| R1.4 | v1.4.0 | Compatibility check | `release/v1.4.0` | — | Merged into main |
| R1.5 | v1.5.0 | R2 readiness review | `release/v1.5.0` | — | Merged into main |
| — | v1.5.0 | Command cooldowns | — | `feature/command-cooldowns` | Merged into main |
| — | v1.5.0 | Backup list | — | `feature/backup-list` | Merged into main |
| R2.0.0+ | v2.0.0 | Write foundation + 12 command families | `feature/r2-write-foundation` | [#63](https://github.com/yacketrj/Arrakis-Control-Panel/pull/63) | Open |
| R2.1 | v2.1.0 | Maintenance writes | `release/v2.1.0` | — | Feature branch |
| R2.2 | v2.2.0 | Notification writes | `release/v2.2.0` | — | Feature branch |
| R2.3 | v2.3.0 | Schedule writes | `release/v2.3.0` | — | Feature branch |
| R2.4 | v2.4.0 | R3 readiness | `release/v2.4.0` | — | Feature branch |
| R3.0.0 | v3.0.0 | Operational writes | `release/v3.0.0` | — | Feature branch |
| R4.0.0 | v4.0.0 | Highest-risk ops | `release/v4.0.0` | — | Feature branch |

## Staging Rules

1. **Read-only first**: All R1.x read-only features are implemented and merged.
2. **Upstream dependency**: R2+ releases require upstream write-adapter contract approval.
3. **Gates**: All universal gates from `docs/full-release-roadmap.md` are met on main.
4. **Security**: Zero unresolved medium/high/critical security findings.
5. **No upstream PRs created**: All work is local, staged in `releases/<train>/pr-body.md`.

## Next Steps

1. Implement remaining additional features from `docs/additional-features-roadmap.md`.
2. Create staging branches for each additional feature.
3. Merge into main; re-run strict gates.
4. Only when all gates pass and upstream write contract is approved,
   open PRs using the staged `gh-create.sh` scripts.
