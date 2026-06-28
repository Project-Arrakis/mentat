# Public Readiness

## Overview

The repository can be made public once the trust model and security controls
are clear. Public does not mean hosted: users still run their own Discord bot
and connect it to their own WebUI adapter.

## Trust Model

This repository provides source code and deployment examples only.

The project maintainers do not:

- host a shared bot
- collect Discord tokens
- collect WebUI adapter tokens
- operate user infrastructure
- receive user server status data
- provide a write-capable Discord control path in v1

The user/operator owns:

- Discord application registration
- Discord bot token
- Discord guild invite
- WebUI adapter bearer token
- hosting environment
- network exposure decisions
- logs and backups

## Public Repository Benefits

Making the repository public improves:

- source transparency
- community review
- issue reporting
- contribution flow
- GitHub public-repository secret scanning availability
- upstream discoverability

GitHub documents that secret scanning runs automatically for public
repositories. Private repository security features vary by account, plan, and
organization settings.

## Public Repository Risks

Public availability can increase:

- copy/paste deployments with weak secrets
- users accidentally opening the WebUI adapter to the internet
- support requests from users who skipped setup guidance
- malicious forks or lookalike packages
- pressure to add unsafe write commands

Documentation, CI gates, conservative defaults, and a read-only v1 policy keep
those risks manageable.

## Publish Checklist

Before switching visibility to public:

- Security Gates workflow is passing on `main`.
- `CHANGELOG.md` and release notes are current for the version being published.
- `docs/release-process.md` explains the tag, artifact, SBOM, and checksum
  process.
- `SECURITY.md` exists and explains private reporting.
- `INSTALL.md` and `USAGE.md` exist and avoid unsafe shortcuts.
- Discord setup docs explain user-owned bot registration.
- Network docs recommend private adapter access.
- Upstream compatibility docs identify Red-Blink upstream as source of truth.
- Dependency management docs explain Dependabot, dependency review, SBOMs, and
  finding handling.
- README states that this is not a shared public bot.
- README states that v1 is read-only.
- `.env.example` uses placeholders only.
- No real tokens exist in Git history.
- Docker runtime image passes Trivy high/critical gates.
- Release artifacts include a generated SBOM and SHA-256 checksum.
- Current command set is covered by unit tests.
- Restricted-by-default RBAC has merged and is documented.

## Transparency Standard

Every feature PR should say:

- user-visible behavior
- security impact
- least-privilege/RBAC impact
- what data crosses the Discord/WebUI boundary
- tests run
- known limitations
- links to relevant source material when external behavior is involved

## Sources

- GitHub security policies: https://docs.github.com/en/code-security/getting-started/adding-a-security-policy-to-your-repository
- GitHub private vulnerability reporting: https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability
- GitHub secret scanning availability: https://docs.github.com/code-security/secret-scanning/about-secret-scanning
