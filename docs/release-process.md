# Release Process

## Status

Releases are cut from the private repository
`yacketrj/dune-awakening-selfhost-discordbot`. The upstream
`Red-Blink/dune-awakening-selfhost-docker` repository remains the source of
truth for WebUI adapter behavior, but this project does not publish upstream
changes or upstream pull requests unless explicitly requested.

## Release Standard

- Use Semantic Versioning tags in the form `vMAJOR.MINOR.PATCH`.
- Use release candidate tags in the form `vMAJOR.MINOR.PATCH-rc.N`.
- Cut releases only from `main` after the release-preparation pull request has
  merged.
- Use annotated Git tags for release tags.
- Keep release notes under `docs/releases/vMAJOR.MINOR.PATCH.md`.
- Keep `CHANGELOG.md`, `package.json`, `package-lock.json`, and
  `addon/addon.json` aligned.
- Attach checksummed release artifacts and the CycloneDX SBOM to the GitHub
  Release.

Pre-1.0 versions may change operator-facing behavior, but every release still
requires the same security gates and documentation evidence.

## Release Candidates

Release candidates are GitHub prereleases. Use them when a change should receive
full release-artifact validation before becoming the latest stable operator
release.

Release candidate rules:

- Use `rc.1`, `rc.2`, and later suffixes on the target stable version.
- Keep `package.json`, `package-lock.json`, `addon/addon.json`,
  `CHANGELOG.md`, and `docs/releases/vMAJOR.MINOR.PATCH-rc.N.md` aligned.
- Publish RC tags only after the release-candidate preparation PR merges to
  `main`.
- Mark GitHub Releases as prereleases automatically when the version contains a
  prerelease suffix.
- Promote to a stable release only after local gates, GitHub CI/security gates,
  artifact checksum verification, and any planned operator smoke testing pass.
- Do not promote if any medium, high, or critical security finding is
  unresolved.

Upstream release-candidate tags are compatibility signals, not stable baselines.
Track them in roadmap or adapter-contract evidence when useful, but keep the
default compatibility baseline on the latest upstream stable release unless the
repository owner explicitly approves targeting an upstream RC.

## Required Preconditions

Before a release branch or tag:

1. Refresh the standalone upstream reference clone.
2. Record the upstream commit SHA and latest tag used for compatibility review.
3. Fetch and fast-forward the bot repository `main`.
4. Confirm the bot repository remote is
   `git@github.com:yacketrj/dune-awakening-selfhost-discordbot.git`.
5. Confirm the worktree is clean before creating the release branch.
6. Open a focused release-preparation pull request.

## Release Preparation Pull Request

The release-preparation PR must include:

- version updates, if any
- `CHANGELOG.md` updates
- `docs/releases/vMAJOR.MINOR.PATCH.md`
- a durable `docs/changes/PR-####-*.md` note
- updated operator or security docs when behavior, support, or evidence changed
- unit tests for release tooling changes

The PR body and change note must use the transparency sections from
`docs/pr-transparency-template.md`.

## Automated Release Gates

`npm run check` includes:

- unit tests
- release metadata validation
- zero-permission addon packaging
- CycloneDX SBOM generation

The GitHub release workflow also:

- rejects tag pushes where `GITHUB_REF_NAME` does not match `package.json`
  version
- verifies addon and SBOM SHA-256 checksum files
- uploads workflow artifacts for manual review
- creates the GitHub Release only for validated tag pushes

The workflow uses `contents: write` only so it can create the GitHub Release and
upload assets. This permission is limited to the release workflow; pull-request
security gates do not need release write permission.

## Security Gates

Release candidates must pass the same security gates as ordinary pull requests:

- `npm run check`
- `npm audit --audit-level=moderate`
- Semgrep
- Gitleaks history and worktree scans
- Trivy filesystem scan
- dependency review when dependencies change
- Docker image build
- Trivy image scan

Do not release with unresolved medium, high, or critical security findings. Fix
the finding before release, or open a GitHub issue with severity, affected
component, evidence, planned resolution, and owner. Use private reporting or a
private issue when evidence includes secrets, exploit detail, private deployment
details, or user-identifying data.

## Tagging

After the release-preparation PR merges and `main` is clean:

```bash
git switch main
git pull --ff-only
npm run check
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

Replace `v0.1.0` with the target version, such as `v0.1.1-rc.1` for a release
candidate or `v0.1.1` for a stable patch release. The tag push starts the
release workflow. Do not move or replace release tags except for a documented
emergency repair approved by the repository owner.

## Release Artifacts

Each release should publish:

- `discord-readonly-bot-vMAJOR.MINOR.PATCH.tar.gz`
- `discord-readonly-bot-vMAJOR.MINOR.PATCH.tar.gz.sha256`
- `dune-awakening-selfhost-discordbot.cdx.json`
- `dune-awakening-selfhost-discordbot.cdx.json.sha256`

The addon package must remain zero-permission. The SBOM must be generated from
the committed `package-lock.json`.

## Privacy and PII

Release notes, PR bodies, issues, screenshots, logs, and artifacts must not
include unredacted emails, SteamIDs, FuncomIDs, real names, keys, passwords,
tokens, cookies, authorization headers, private server addresses, or `.env`
contents. PCI/payment-card data is not expected in this project; if it appears,
treat it as a security finding and stop the data flow before expanding release
scope.

## Rollback and Revocation

If a release is unsafe:

1. Mark the GitHub Release as a pre-release or remove the release assets if
   distribution must stop immediately.
2. Open a GitHub issue or private advisory with evidence and owner.
3. Revoke exposed credentials if secrets were involved.
4. Patch on a new PR and release a higher version.
5. Do not rewrite public release history unless the repository owner approves an
   emergency correction.

## SOC 2 Alignment

This repository is not SOC 2 certified by itself. Release evidence supports a
SOC 2-aligned change-management record by preserving:

- pull request review trail
- change note
- release notes
- security gate output
- SBOM and checksums
- finding disposition or tracking issue
- upstream compatibility evidence

## Sources

- Semantic Versioning: https://semver.org/
- GitHub Releases documentation:
  https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- GitHub Actions permissions:
  https://docs.github.com/en/actions/security-guides/automatic-token-authentication
- CycloneDX JSON format: https://cyclonedx.org/docs/1.6/json/
