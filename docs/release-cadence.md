# Release Cadence

## Overview

This project follows a **time-based release train** with **risk-tiered
frequency**. Releases are categorised into three tiers: patch, minor, and
major. Each tier has its own cadence, entry criteria, and exit gates.

## Cadence Schedule

| Tier | Frequency | Trigger | Example |
|------|-----------|---------|---------|
| Patch (`PATCH`) | Weekly or on-demand | Security fix, critical bug | `v1.5.1` |
| Minor (`MINOR`) | Bi-weekly | Feature completion, non-breaking changes | `v1.6.0` |
| Major (`MAJOR`) | Per release train (6–8 weeks) | Breaking changes, new capability families | `v2.0.0` |

### Patch Releases (Weekly)

- **Cadence**: Every Monday, or immediately for critical/security fixes.
- **Scope**: Bug fixes, dependency patches, documentation corrections, security
  patches.
- **Entry criteria**: Fix merged to `main`, full gate suite passed.
- **Exit criteria**: Tag pushed, GitHub Release published, artifacts verified.
- **Skip rule**: If no changes since last release, skip the weekly window.

### Minor Releases (Bi-weekly)

- **Cadence**: Every second Monday (alternating with patch weeks).
- **Scope**: New read-only commands, non-breaking feature additions, UX
  improvements, adapter compatibility updates.
- **Entry criteria**: All feature PRs for this train merged to `main`, release
  preparation PR reviewed and merged, full gate suite passed.
- **Exit criteria**: Tag pushed, GitHub Release published, artifacts verified,
  operator smoke test passed.

### Major Releases (Per Train)

- **Cadence**: 6–8 weeks per release train (R1, R2, R3, ...).
- **Scope**: Breaking changes, new capability families (e.g. write commands),
  major architecture changes, security boundary changes.
- **Entry criteria**:
  - Release train plan approved by repository owner.
  - All train-scoped work merged to `main`.
  - Release candidate (RC) published and validated for at least 1 week.
  - Full security re-review completed with no unresolved medium+ findings.
  - Upstream compatibility evidence refreshed.
- **Exit criteria**: RC promoted to stable, GitHub Release published as latest,
  artifacts verified, operator smoke test passed, rollback plan documented.

## Release Windows

| Day | Activity |
|-----|----------|
| Monday (patch week) | Cut patch release if changes exist |
| Monday (minor week) | Cut minor release, then cut patch if needed |
| Friday | Freeze `main` for non-critical changes |
| Any day | Emergency patch for critical/security fixes |

## Release Preparation Checklist

Every release, regardless of tier, must complete:

1. [ ] `main` branch is clean and up-to-date (`git pull --ff-only`)
2. [ ] Version aligned across `package.json`, `package-lock.json`,
   `addon/addon.json`, and `CHANGELOG.md`
3. [ ] Release notes written at `docs/releases/v<VERSION>.md`
4. [ ] Change note written at `docs/changes/PR-<NUM>-<slug>.md`
5. [ ] `npm run check` passes (tests + metadata + package + SBOM)
6. [ ] `npm audit --audit-level=moderate` passes
7. [ ] Semgrep, Gitleaks, Trivy, ggshield scans pass
8. [ ] Docker build and Trivy image scan pass
9. [ ] API security DAST passes (`npm run security:api`)
10. [ ] Annotated tag created (`git tag -a v<VERSION> -m "Release v<VERSION>"`)
11. [ ] Tag pushed (`git push origin v<VERSION>`)
12. [ ] GitHub Release published (automated via workflow)
13. [ ] Release artifacts and SBOM attached
14. [ ] Post-release evidence recorded under `docs/release-evidence/`

## Release Candidate Policy

For major releases, release candidates are mandatory:

- Publish at least one RC (`v2.0.0-rc.1`) at least 1 week before stable.
- RCs are GitHub prereleases and are clearly marked as not-for-production.
- RCs must pass the same gate suite as stable releases.
- Additional RCs (`rc.2`, `rc.3`) are cut as fixes are applied.
- The RC period is the only window for operator smoke testing before stable.

## Emergency Patch Policy

For critical security fixes or production-blocking bugs:

1. Open a tracking issue with severity and impact assessment.
2. Create a minimal fix PR against `main`.
3. Run the full gate suite on the fix PR.
4. Merge and cut a patch release immediately (skip the Monday window).
5. Backport to any supported release branches if applicable.
6. Document the emergency in a post-mortem change note.

## Release Branch Policy

- Release branches (`release/vX.Y.Z`) are created from `main` at freeze time.
- Release preparation PRs target the release branch first, then merge back to
  `main` after the release is published.
- Release branches are never force-pushed.
- Release branches are deleted after the release is published and verified
  (keeps the branch list clean).

## Version Alignment

All of these must carry the same version before a tag is pushed:

| File | Field |
|------|-------|
| `package.json` | `.version` |
| `package-lock.json` | `.version` |
| `addon/addon.json` | `.version` |
| `CHANGELOG.md` | `## v<VERSION>` heading |
| `docs/releases/v<VERSION>.md` | filename and heading |

Validation: `npm run release:check` enforces this automatically.

## Sources

- Semantic Versioning: https://semver.org/
- GitHub Release workflow: `.github/workflows/release-artifacts.yml`
- Release process: `docs/release-process.md`
- Release validation: `scripts/validate-release.js`
- Cut-release automation: `scripts/cut-release.sh`
