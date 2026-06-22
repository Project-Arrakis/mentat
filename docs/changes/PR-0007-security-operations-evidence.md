# Change Note: Security Operations Evidence

## Summary

This change fixes the tracked Dependabot configuration finding, makes the PR
transparency workflow explicit, and adds SOC 2 alignment notes without claiming
certification.

It also refreshes adapter-contract evidence now that upstream release `v1.3.19`
contains the Discord adapter contract.

## User Impact

Operators do not need to change runtime configuration. Maintainers should see
Dependabot version update pull requests for npm and GitHub Actions dependencies.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged.
- Secret handling: unchanged.
- Data crossing Discord, bot, or WebUI boundaries: unchanged.
- Network exposure: unchanged.
- Dependency maintenance: improved by replacing the placeholder Dependabot
  config with npm and GitHub Actions update checks.
- Compliance evidence: improved by documenting SOC 2 alignment boundaries and
  evidence expectations.

## Least Privilege

No runtime privileges changed. The bot remains read-only and continues to avoid
Docker socket, database, game-file, shell, and write-capable console access.

## Tests

Local verification on June 22, 2026:

| Check | Result |
| --- | --- |
| `npm test` | Passed, 24 tests |
| `npm audit --audit-level=moderate` | Passed, 0 vulnerabilities |
| Semgrep default and secrets rules | Passed, 0 findings |
| Gitleaks | Passed, no leaks found |
| Trivy filesystem scan | Passed, 0 high/critical findings |
| Docker image build | Passed |
| Trivy image scan | Passed, 0 high/critical findings |

## Known Limitations

The SOC 2 alignment notes are not a certification claim. Formal SOC 2 readiness
requires organization-level controls, evidence retention, auditor scoping, and a
covered system description outside this repository.

## Sources

- Issue #5: Dependabot dependency update configuration finding.
- AICPA & CIMA SOC suite overview:
  https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services
- AICPA & CIMA 2017 Trust Services Criteria with revised points of focus:
  https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022
- AICPA & CIMA SOC 2 description criteria:
  https://www.aicpa-cima.com/resources/download/get-description-criteria-for-your-organizations-soc-2-r-report
- Upstream adapter source:
  https://github.com/Red-Blink/dune-awakening-selfhost-docker
