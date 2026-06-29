# Changelog

This project follows Semantic Versioning for release tags. Security fixes,
dependency updates, and release evidence stay tied to pull requests and durable
change notes under `docs/changes/`.

## Unreleased

### Added

- Draft upstream write-adapter RFC with proposed disabled-by-default write
  routes, schemas, fixtures, STRIDE notes, abuse cases, and maintainer
  questions.
- Durable documentation guard for tool and provider references in docs and PR
  templates.

### Changed

- Replaced workspace-specific upstream clone paths with portable sibling-path
  references in source-bound documentation.

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
