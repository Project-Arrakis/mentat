# PR-0034: Add R1.0.0 Production Release Plan

## Summary

Adds a comprehensive production release plan for the read-only `R1.0.0` target
and clarifies the release strategy from the current `R0.1.5` planning baseline.

## User Impact

Operators and maintainers get a clearer path from the current read-only
foundation to a production release. No bot command behavior changes.

## Security Impact

- Command surface: unchanged.
- RBAC: unchanged.
- Secrets handling: unchanged.
- Data crossing Discord, the bot, and the WebUI adapter: unchanged.
- Network exposure: unchanged.
- Security findings: no medium, high, or critical finding was introduced by
  this documentation and test update.

## Least Privilege

The bot remains read-only and keeps the same least-privilege runtime model:
Discord bot token, configured Discord allow-lists, WebUI Discord adapter bearer
token, no Docker socket, no database mount, no game-file access, and non-root
container execution.

## Tests and Evidence

- `npm run check`
- `npm audit --audit-level=moderate`
- GitHub PR #34 CI test jobs
- GitHub PR #34 Security Gates:
  dependency audit, dependency review, secret scan, Semgrep, Trivy filesystem,
  and Trivy image

## Known Limitations

This PR creates the production release plan. It does not publish `R0.1.5`, cut a
new release candidate, or implement write-capable behavior.

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
