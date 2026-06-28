# Dependency Management

## Overview

Dependency maintenance is part of the security baseline for this bot. The
project uses Dependabot, npm audit, GitHub dependency review, Trivy, and a
CycloneDX SBOM to keep dependency risk visible.

## Automated Checks

- Dependabot opens weekly pull requests for npm and GitHub Actions updates.
- `npm audit --audit-level=moderate` blocks moderate, high, and critical npm
  advisories.
- GitHub dependency review runs on pull requests and blocks newly introduced
  vulnerable dependencies at `moderate` severity or higher.
- Trivy scans filesystem dependencies and runtime images for high and critical
  vulnerabilities with available fixes.
- Gitleaks scans for accidental secrets.

## SBOM

Generate the software bill of materials locally with:

```bash
npm run sbom
```

The command reads `package-lock.json`, writes
`dist/dune-awakening-selfhost-discordbot.cdx.json`, and writes a matching
SHA-256 checksum. Release artifact workflows upload the SBOM and checksum for
tagged or manually prepared releases.

Tagged GitHub Releases attach the SBOM and checksum next to the addon package.
Before publishing a release, `npm run release:check` must confirm that
`package.json`, `addon/addon.json`, `CHANGELOG.md`, and the release notes agree
on the version.

## Finding Handling

Do not ignore medium, high, or critical findings. If a finding appears:

- fix it in the same pull request, or
- open a GitHub issue with severity, affected component, evidence, planned
  resolution, and owner, or
- document a false-positive decision with scanner output and rationale.

Use private reporting or private issues for findings that include secrets,
exploit detail, private deployment details, or user-identifying data.

## Review Standard

Dependency PRs should record:

- package or action changed
- old and new versions
- relevant changelog or release-note evidence
- local and CI gate results
- unresolved advisories or scanner findings

Release PRs should also record:

- release version
- upstream compatibility SHA and tag
- SBOM generation evidence
- checksum verification evidence
- any security finding issue opened or resolved before release

Security advisories and medium, high, or critical findings take priority over
routine updates.

## Sources

- GitHub dependency review action metadata:
  https://github.com/actions/dependency-review-action
- CycloneDX JSON format:
  https://cyclonedx.org/docs/1.6/json/
