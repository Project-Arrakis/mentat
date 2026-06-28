# PR-0022: Add Release Candidate Roadmap

## Summary

Adds release-candidate support to release validation and artifact publication,
then updates the roadmap to require candidate validation before future stable
promotions when risk warrants it.

The upstream reference clone was refreshed on June 28, 2026. Upstream `main`
remained at `Red-Blink/dune-awakening-selfhost-docker@1bb72c5`, latest stable
tag `v1.3.37`. A new upstream release-candidate tag, `v1.3.38-rc.1` at
`233aedf`, was observed and checked for Discord adapter route impact. No
Discord adapter route files changed between `v1.3.37` and `v1.3.38-rc.1`.

## User Impact

Operators should see no runtime behavior change. Future prerelease tags such as
`v0.1.1-rc.1` will publish GitHub prereleases with the same addon and SBOM
artifact evidence as stable releases.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged.
- Secret handling: unchanged.
- Data crossing Discord/bot/WebUI boundaries: unchanged.
- Network exposure: unchanged.
- Release workflow: prerelease versions are now supported and automatically
  marked as GitHub prereleases.

## Least Privilege

Runtime least privilege is unchanged. The optional addon remains
zero-permission. The release workflow keeps the existing `contents: write`
permission only for creating GitHub Releases and uploading release assets.

## Tests and Evidence

- `npm run check`
- `npm audit --audit-level=moderate`
- Semgrep
- Gitleaks
- Trivy filesystem
- Dependency review
- SBOM generation
- Docker build
- Trivy image

## Known Limitations

This PR adds candidate support and roadmap guidance only. It does not change the
package version or publish a new release candidate. The next release-preparation
PR should prepare `v0.1.1-rc.1`.

## Sources

- Semantic Versioning: https://semver.org/
- GitHub prereleases:
  https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases
- Upstream source of truth:
  https://github.com/Red-Blink/dune-awakening-selfhost-docker
