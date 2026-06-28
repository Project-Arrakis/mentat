# SOC 2 Alignment Notes

## Status

This repository is not SOC 2 certified by itself. A SOC 2 examination covers an
organization's described system, controls, operating processes, evidence, and
auditor report. This repository can only provide control-friendly engineering
evidence for the bot code, release process, and documented security posture.

The goal is to keep the project compatible with a SOC 2 program by preserving
clear security controls, review evidence, and traceable remediation.

## Source Criteria

The AICPA Trust Services Criteria cover security, availability, processing
integrity, confidentiality, and privacy. AICPA describes the criteria as
outcome-based criteria used to evaluate whether controls are effective for the
objectives management has established for a system.

This project uses those criteria as alignment guidance, not as a certification
claim.

## Repository Control Evidence

| Area | Current evidence |
| --- | --- |
| Security | Restricted-by-default RBAC, bearer-token adapter boundary, secret redaction, structured redacted logs, CI security gates, STRIDE review notes. |
| Availability | Docker runtime example, adapter timeout handling, local bot healthcheck, documented smoke tests. |
| Processing integrity | Unit tests for config, RBAC, formatting, adapter route compatibility, and bounded output behavior. |
| Confidentiality | No shared hosted bot, no Docker socket, no database mount, no game-file access, no direct console command execution. |
| Privacy | Minimal Discord actor context, no message-content collection, no user data persistence in the bot, shared output redaction for PII/game identity fields, and no expected PCI/payment-card processing. |

## Required Evidence Discipline

Every substantive pull request should include:

- PR body using `.github/PULL_REQUEST_TEMPLATE.md`
- durable change note under `docs/changes/`
- tests and security-gate results
- upstream source evidence when behavior depends on upstream
- GitHub issue or in-PR fix for every security finding
- documented false-positive rationale when a scanner finding is not fixed

## Gaps Outside This Repository

SOC 2 readiness also depends on organization-level controls that are outside
this codebase, including:

- access reviews for GitHub, Discord, hosting, container registry, and secrets
- incident response process and evidence retention
- change-management approvals and segregation of duties where required
- vulnerability management SLAs and owner assignment
- backup, disaster recovery, and availability monitoring for deployed systems
- vendor and dependency risk management
- formal auditor scoping and management assertions

Do not describe this repository as SOC 2 compliant or certified unless an
authorized SOC 2 engagement covers the relevant system and period.

## Sources

- AICPA & CIMA SOC suite overview:
  https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services
- AICPA & CIMA 2017 Trust Services Criteria with revised points of focus:
  https://www.aicpa-cima.com/resources/download/2017-trust-services-criteria-with-revised-points-of-focus-2022
- AICPA & CIMA SOC 2 description criteria:
  https://www.aicpa-cima.com/resources/download/get-description-criteria-for-your-organizations-soc-2-r-report
