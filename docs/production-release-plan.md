# Production Release Plan

## Purpose

This plan guides the project from the current read-only planning baseline to a
full production release, `R1.0.0`. The matching repository tag will be `v1.0.0`.
The `R` prefix is a human release-train label for roadmap discussions; Git tags,
package versions, addon versions, changelog entries, and release notes continue
to use SemVer-compatible `vMAJOR.MINOR.PATCH` tags.

The current planning baseline is `R0.1.5`. The latest published stable artifact
is still `v0.1.1`; do not describe `R0.1.5` as a published release until a
release-preparation PR updates all release metadata and publishes the
corresponding tag.

`R1.0.0` is a production release for the read-only Discord bot. Write-capable
commands remain out of scope for `R1.0.0` unless the repository owner explicitly
re-scopes the release after upstream publishes a write-capable adapter contract.

## Release Principles

- Security gates are release gates, not advisory checks.
- No stable release ships with unresolved medium, high, or critical security
  findings.
- Every substantive change uses a pull request, durable change note, tests, and
  evidence.
- Upstream compatibility is source-bound to
  `Red-Blink/dune-awakening-selfhost-docker` and a refreshed upstream reference
  clone.
- Release artifacts are reproducible enough to verify by version, source commit,
  SBOM, and checksum.
- Documentation must be current before a release candidate is cut.
- Privacy evidence must cover Discord IDs, SteamIDs, FuncomIDs, emails, real
  names, keys, tokens, passwords, private server addresses, and logs. PCI data
  is not expected; if it appears, treat it as a security finding.

## Current Baseline: R0.1.5

The `R0.1.5` baseline means the repository has passed the initial read-only
foundation work but has not yet entered production release freeze.

Current evidence:

- Latest published stable release: `v0.1.1`.
- Current upstream baseline: `Red-Blink/dune-awakening-selfhost-docker@5163bd8`,
  tag `v1.3.41`.
- Read-only command family is implemented and unit tested.
- Restricted-by-default RBAC is implemented and unit tested.
- Adapter route fixtures, compatibility tests, and local adapter mock are in
  place.
- CI and Security Gates include unit tests, npm audit, Semgrep, Gitleaks, Trivy
  filesystem, Docker build, Trivy image, dependency review for pull requests,
  release metadata validation, addon packaging, and SBOM generation.
- Release candidate and stable release workflows exist for checksummed addon
  and CycloneDX SBOM artifacts.

## Road to R1.0.0

| Train | Goal | Required outcome |
| --- | --- | --- |
| `R0.2.0` | Operator documentation freeze | README, install, usage, security, networking, Discord setup, troubleshooting, release, and SOC 2 alignment docs are current and cross-linked. |
| `R0.3.0` | Read-only operational hardening | Smoke tests, healthcheck instructions, log redaction evidence, timeout behavior, and adapter mock usage are production-ready. |
| `R0.4.0` | Upstream compatibility discipline | Upstream sync checklist, adapter contract evidence, fixture drift review, and release-candidate monitoring are repeatable. |
| `R0.5.0` | Supply-chain release hardening | Annotated tags, pinned GitHub Actions, SBOMs, checksums, dependency review, and artifact verification are mandatory and documented. |
| `R0.6.0` | Comprehensive security review | STRIDE, privacy, dependency, container, workflow, RBAC, logging, and release controls are reviewed with issue tracking for every finding. |
| `R0.7.0` | Controlled operator validation | Test-guild slash command registration, runtime smoke tests, Docker start, and adapter mock scenarios are documented and completed. |
| `R0.8.0` | Production evidence closure | All required docs, change notes, release notes, support docs, and known limitations are current; no stale source-bound evidence remains. |
| `R0.9.0` | Release candidate freeze | Only release-blocking fixes are accepted; publish `v1.0.0-rc.1` as a GitHub prerelease and verify artifacts. |
| `R1.0.0` | Production GA | Promote the final candidate to `v1.0.0` only after local gates, GitHub gates, artifact checksum verification, and owner approval pass. |

Each train should land through small PRs. A train can contain more than one PR,
but each PR should have one clear purpose and one durable change note.

## R1.0.0 Entry Criteria

Before cutting `v1.0.0-rc.1`:

- `main` is clean and current with `origin/main`.
- The upstream reference clone is clean and current.
- Adapter evidence names the current upstream commit and latest stable tag.
- `README.md`, `INSTALL.md`, `USAGE.md`, `SECURITY.md`, `SUPPORT.md`,
  `CHANGELOG.md`, release docs, security docs, and PR/change notes are current.
- All read-only commands have unit tests and smoke-test instructions.
- PII and secret redaction tests cover structured data and free text.
- STRIDE notes cover the read-only boundary and any newly added command family.
- No open issue tracks an unresolved medium, high, or critical security finding.
- Release artifacts can be generated locally with `npm run check`.

## R1.0.0 Release Candidate Gates

Every `v1.0.0-rc.N` candidate must have:

- release-preparation PR with transparency sections completed
- durable `docs/changes/PR-####` note
- `CHANGELOG.md` entry
- `docs/releases/v1.0.0-rc.N.md`
- local `npm run check`
- local `npm audit --audit-level=moderate`
- GitHub CI test job
- GitHub Security Gates: dependency audit, dependency review when applicable,
  secret scan, Semgrep, Trivy filesystem, Docker build, and Trivy image
- GitHub Release marked as a prerelease
- published addon package and SBOM assets
- SHA-256 checksum verification for every published artifact
- documented smoke-test result or explicit owner-approved deferral

If a release candidate fails a gate, fix through a PR and publish a higher
candidate number. Do not move an existing release tag.

## R1.0.0 Promotion Gates

Promote to `v1.0.0` only when:

- the final release candidate has passed all candidate gates
- any candidate findings are fixed or documented as accepted low-risk items
  approved by the repository owner
- there are no unresolved medium, high, or critical findings
- upstream compatibility evidence is still current on the release date
- release notes clearly identify the read-only boundary and known limitations
- addon package remains zero-permission
- SBOM and checksum assets are attached to the GitHub Release

The stable release should be created from a release-preparation PR that updates
metadata from the final candidate to `1.0.0`.

## Versioning Strategy

Use SemVer for machine-readable releases:

- Patch: security fixes, documentation corrections, dependency updates, or
  release evidence fixes that do not change command behavior.
- Minor before `1.0.0`: read-only command additions, operator workflow
  improvements, compatibility tooling, or release hardening.
- Minor after `1.0.0`: backward-compatible read-only features.
- Major: breaking configuration changes, permission model changes, or any
  write-capable command family that changes the operational risk profile.

Use release candidates for any release that changes operator workflows,
security controls, release artifacts, or adapter compatibility assumptions.

## Branching and Pull Requests

- Work from current `main`.
- Use short-lived focused branches.
- Keep PRs small enough to review from their diff and durable change note.
- Use the transparency sections from `docs/pr-transparency-template.md`.
- Add or update `docs/changes/PR-####-*.md` before merge.
- Do not merge with unresolved medium, high, or critical security findings.
- Create a GitHub issue for every security finding that is not fixed inside the
  discovering PR.

## Security and Compliance Evidence

The R1 release record should preserve:

- pull request trail
- change notes
- issue references for findings and resolutions
- security gate results
- release notes
- SBOM and checksums
- upstream compatibility evidence
- STRIDE review evidence
- privacy and redaction evidence
- rollback and revocation instructions

This evidence supports SOC 2-aligned change management, security, availability,
processing integrity, confidentiality, and privacy review. It does not make the
repository SOC 2 certified by itself.

## Non-Read-Only Boundary

The non-read-only roadmap remains separate from `R1.0.0`. Before any
write-capable release train begins:

- upstream must publish and approve a write-capable adapter contract
- a GitHub issue must track each write command family
- STRIDE and abuse-case review must be recorded
- write-specific RBAC, confirmation, idempotency, audit, rate limiting, and
  rollback controls must exist
- the first write-capable release must be a prerelease candidate

See `docs/non-readonly-roadmap.md` and
`docs/upstream-write-adapter-rfc.md`. See `docs/full-release-roadmap.md` for
the broader release-train map from read-only production to later write-capable
milestones.

## Sources

- Semantic Versioning: https://semver.org/
- Keep a Changelog: https://keepachangelog.com/en/1.1.0/
- GitHub Releases documentation:
  https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- NIST Secure Software Development Framework SP 800-218:
  https://csrc.nist.gov/pubs/sp/800/218/final
- SLSA build provenance:
  https://slsa.dev/spec/draft/build-provenance
- OWASP Software Component Verification Standard:
  https://owasp.org/www-project-software-component-verification-standard/
- AICPA SOC suite overview:
  https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services
