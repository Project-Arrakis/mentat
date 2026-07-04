# Release Staging Index

Staging area for **future** upstream PRs. **No upstream PRs are open yet.**
Work continues on local feature/release branches. When a train is ready, use the
`pr-body.md` in each folder with `gh pr create --body-file`.

## Workflow

1. Implement and test on the local feature/release branch.
2. Update the matching `docs/changes/PR-####.md` note.
3. Fill in test evidence and checkboxes in `releases/<train>/pr-body.md`.
4. Run local checks (`npm run check`, `npm audit`, Semgrep, Gitleaks, Trivy, Docker build).
5. Only when the train is validated, run the `gh-create.sh` command documented in each folder.

## Release Train Manifest

| Train | Version | Scope | Local Branch | Status |
|-------|---------|-------|--------------|--------|
| R1.0.0 | v1.0.0 | Stable read-only GA | `release/v1.0.0` | Feature branch |
| R1.1 | v1.1.0 | Operator validation | `release/v1.1.0` | Feature branch |
| R1.2 | v1.2.0 | Read-only detail expansion | `release/v1.2.0` | Feature branch |
| R1.3 | v1.3.0 | Read-only notifications | `release/v1.3.0` | Feature branch |
| R1.4 | v1.4.0 | Compatibility hardening | `release/v1.4.0` | Feature branch |
| R1.5 | v1.5.0 | R2 readiness review | `release/v1.5.0` | Feature branch |
| R2.0.0 | v2.0.0 | Write-safety foundation | `release/v2.0.0` | Planning |
| R2.1 | v2.1.0 | Maintenance metadata writes | `release/v2.1.0` | Planning |
| R2.2 | v2.2.0 | Notification config writes | `release/v2.2.0` | Planning |
| R2.3 | v2.3.0 | Scheduled-post config writes | `release/v2.3.0` | Planning |
| R2.4 | v2.4.0 | R3 readiness review | `release/v2.4.0` | Planning |
| R3.0.0 | v3.0.0 | Operational writes | `release/v3.0.0` | Planning |
| R4.0.0+ | v4.0.0 | Highest-risk ops | `release/v4.0.0` | Planning |

## Artifacts per Train

Each release folder contains:
- `pr-body.md` — PR body for `gh pr create --body-file`
- `gh-create.sh` — Example `gh pr create` command
- `README.md` — Train overview and staging checklist
- Reference to `docs/changes/PR-####.md`
- Reference to `docs/releases/vMAJOR.MINOR.PATCH.md` (for releases)

## Staging Rules

1. **Read-only first**: No RW release may merge before R1.x read-only maturity is complete.
2. **Upstream dependency**: R2+ releases require upstream write-adapter contract approval.
3. **Gates**: All universal gates from `docs/full-release-roadmap.md` must be met.
4. **Security**: Zero unresolved medium/high/critical findings.
5. **Documentation**: Each PR has a matching change note and (for releases) release notes.
