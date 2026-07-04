# Changelog

This project follows Semantic Versioning for release tags. Security fixes,
dependency updates, and release evidence stay tied to pull requests and durable
change notes under `docs/changes/`.

## Unreleased

### Added

- (reserved for future changes)

## v1.4.0 - 2026-07-03

Compatibility hardening (R1.4). Adds upstream drift checklist, fixture refresh
workflow, release-candidate monitoring, and stronger route compatibility tests.

### Added

- Upstream drift detection checklist for adapter contract changes.
- Fixture refresh workflow for automated adapter evidence updates.
- Release-candidate monitoring for upstream pre-release compatibility
  signals.
- Stronger route compatibility tests covering edge cases and field-level
  contract assertions.
- Documentation guard tests ensuring source-bound evidence is current.

### Changed

- Release planning baseline advanced to R1.4 for compatibility hardening.

## v1.0.0-rc.1 - 2026-07-03

Release candidate for the read-only `R1.0.0` production target. This candidate
keeps the bot read-only and packages the completed operator validation,
upstream compatibility, security review, and release-roadmap evidence for
prerelease validation.

### Added

- Draft upstream write-adapter RFC with proposed disabled-by-default write
  routes, schemas, fixtures, STRIDE notes, abuse cases, and maintainer
  questions.
- Production release plan and release train strategy for the read-only
  `R1.0.0` target.
- Full release roadmap that keeps `R1.0.0` read-only and maps later major
  trains toward controlled write-capable features.
- Refreshed current upstream compatibility evidence to
  `Red-Blink/dune-awakening-selfhost-docker@5163bd8`, tag `v1.3.41`.
- Detailed `R1.x` to `R2.x` roadmap with release cadence, entry criteria,
  train scopes, and go/no-go gates.
- Operator validation checklist and read-only adapter smoke command for the
  `R1.1` validation path.
- Read-only production readiness security review current through PR #38 and
  upstream `v1.3.41`.
- Durable documentation guard for tool and provider references in docs and PR
  templates.
- Workflow policy guard requiring GitHub Actions references to use immutable
  commit SHA pins.

### Changed

- Replaced workspace-specific upstream clone paths with portable sibling-path
  references in source-bound documentation.
- Advanced the release planning baseline from `R0.1.5` to `R0.9.0` release
  candidate freeze for the `v1.0.0-rc.1` preparation.

### Security

- Recorded current STRIDE, privacy, SOC 2 alignment, supply-chain, release
  readiness, and finding disposition evidence for the read-only production
  boundary.
- Pinned GitHub Actions workflow dependencies to immutable commit SHAs to close
  the Semgrep mutable-action supply-chain finding tracked in issue #30.
- Updated pinned workflow action SHAs for setup-python and upload-artifact
  after dependency review and successful security gates.

## v0.1.1 - 2026-06-28

Stable promotion of the `v0.1.1-rc.1` release candidate after candidate
workflow validation, GitHub prerelease publication, and published artifact
checksum verification.

### Added

- Release-candidate workflow support for prerelease SemVer tags and GitHub
  prereleases.
- Roadmap guidance for candidate validation before stable promotion.

### Changed

- Upstream evidence records the standalone Windows reference clone and the
  latest observed upstream release-candidate tag separately from the stable
  compatibility baseline.

## v0.1.1-rc.1 - 2026-06-28

Release candidate for the release-candidate workflow and roadmap update.

### Added

- Release-candidate workflow support for prerelease SemVer tags and GitHub
  prereleases.
- Roadmap guidance for candidate validation before stable promotion.

### Changed

- Upstream evidence now records the standalone Windows reference clone and the
  latest observed upstream release-candidate tag separately from the stable
  compatibility baseline.

## v0.1.0 - 2026-06-28

Initial read-only release for the self-hosted Discord bot.

### Added

- Read-only `/dune` command family for about, ping, health, status,
  status-summary, readiness, and services.
- Restricted-by-default Discord RBAC with role and user allow-lists.
- Configurable read-only adapter routes aligned with the upstream WebUI
  Discord adapter.
- Local adapter mock and route compatibility fixtures.
- Zero-permission addon package generation with SHA-256 checksum.
- CycloneDX SBOM generation with SHA-256 checksum.
- Docker runtime hardening and healthcheck support.

### Security

- No Docker socket mount, database access, game-file access, shell execution, or
  write-capable adapter routes.
- Redaction for credentials, authorization headers, emails, SteamIDs,
  FuncomIDs, and explicit real-name fields before output reaches Discord or
  logs.
- Required PR gates for unit tests, npm audit, Semgrep, Gitleaks, Trivy
  filesystem scanning, dependency review, SBOM generation, Docker build, and
  Trivy image scanning.
- STRIDE review completed for the read-only boundary.

### Evidence

- Release notes: `docs/releases/v0.1.0.md`
- Read-only security review: `docs/security-review-2026-06-28.md`
- Upstream compatibility baseline:
  `Red-Blink/dune-awakening-selfhost-docker@1bb72c5`, tag `v1.3.37`
