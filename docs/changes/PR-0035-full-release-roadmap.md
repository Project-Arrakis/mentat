# PR-0035: Add Full Release Roadmap With Gates

## Summary

Adds a full release-train roadmap that keeps `R1.0.0` scoped to read-only
production and maps later major releases toward controlled write-capable and
full-featured milestones.

## User Impact

Operators and maintainers get clearer expectations for which capabilities
belong in `R1.0.0`, which belong in later major release trains, and what gates
must pass before write-capable behavior can ship.

## Security Impact

- Command surface: unchanged.
- RBAC: unchanged.
- Secrets handling: unchanged.
- Data crossing Discord, the bot, and the WebUI adapter: unchanged.
- Network exposure: unchanged.
- Security findings: no medium, high, or critical finding was introduced by
  this documentation and test update.

## Least Privilege

The bot remains read-only. The roadmap explicitly preserves the adapter
boundary, zero Docker socket access, no database mount, no game-file access, no
shell execution, restricted-by-default RBAC, and later write-specific RBAC
before any write train can ship.

## Tests and Evidence

- `npm run check`
- `npm audit --audit-level=moderate`
- GitHub PR #35 CI test jobs
- GitHub PR #35 Security Gates:
  dependency audit, dependency review, secret scan, Semgrep, Trivy filesystem,
  and Trivy image

## Known Limitations

This PR is planning and release governance only. It does not publish a release,
change runtime behavior, implement write support, or open an upstream PR.

## Sources

- `docs/production-release-plan.md`
- `docs/non-readonly-roadmap.md`
- `docs/upstream-write-adapter-rfc.md`
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
