# Security Review: Read-Only Roadmap Completion

## Scope

This review covers the read-only Discord bot through `main` commit `1d849ef`
after PR #18. It includes runtime code, adapter boundary, RBAC, redaction,
logging, Docker hardening, CI security gates, release artifacts, SBOM,
dependency maintenance, and operator documentation.

The upstream reference clone was refreshed before review and remained at
`Red-Blink/dune-awakening-selfhost-docker@1bb72c5`, latest tag `v1.3.37`.

## Finding Summary

No medium, high, or critical security findings were identified in this review.
No GitHub issue was opened because there was no unresolved finding to track.

Open GitHub issues checked during review: none.

## Evidence

| Check | Result |
| --- | --- |
| `npm run check` | Passed, 45 tests; addon package generated; SBOM generated with 25 components |
| `npm audit --audit-level=moderate` | Passed, 0 vulnerabilities |
| `npm outdated --omit=dev` | No outdated production packages reported |
| Semgrep `p/default` and `p/secrets` | Passed, 0 findings |
| Trivy filesystem | Passed, 0 high/critical vulnerabilities, 0 Dockerfile misconfigurations |
| Gitleaks history scan | Passed, no leaks found |
| Gitleaks worktree scan | Passed, no leaks found |
| Docker image build | Passed for `dune-awakening-selfhost-discordbot:security-review` |
| Trivy image scan | Passed, 0 high/critical vulnerabilities |
| Addon checksum | Passed |
| SBOM checksum | Passed |
| PR #18 dependency review | Passed in GitHub Actions |

## Boundary Review

The bot remains read-only:

- No Docker socket mount.
- No database access.
- No game-file access.
- No shell command execution.
- No write-capable adapter route.
- No WebUI mutation route.
- No Discord privileged gateway intents.

Current commands are `/dune about`, `/dune ping`, `/dune health`,
`/dune status`, `/dune status-summary`, `/dune readiness`, and
`/dune services`.

## STRIDE Review

| Category | Review result |
| --- | --- |
| Spoofing | Discord identity comes from the interaction object; adapter access uses a bearer token; startup requires configured secrets. |
| Tampering | Adapter route methods are limited to `GET` and `POST`; route paths must be absolute; current commands do not mutate upstream state. |
| Repudiation | Write actions are out of scope. Structured logs provide bounded operational evidence without logging raw bodies or stacks. Future write actions need explicit audit logging before implementation. |
| Information disclosure | Discord output and logs use shared redaction for credentials, emails, SteamIDs, FuncomIDs, and explicit real-name fields. Output is bounded for Discord message limits. |
| Denial of service | Adapter calls use request timeouts. No scheduled or recurring posting features are enabled yet. Future recurring features need rate limits and channel allow-lists. |
| Elevation of privilege | RBAC is restricted by default and fails closed without configured principals. Command-specific role variables grant one command; admin and observer roles inherit current read-only commands. |

## Privacy and PII

The project is not expected to process PCI/payment-card data. If PCI data appears
in adapter output, it should be treated as a security finding and the data flow
should be stopped before expanding commands.

PII-sensitive output handling covers:

- emails
- SteamID formats
- Funcom identifiers
- explicit real-name fields
- keys, passwords, tokens, cookies, authorization headers, API keys, and
  credential-like fields

Residual limitation: arbitrary real names or unlabeled third-party identifiers
inside free text cannot be identified reliably by regex. New adapter routes
should avoid returning those values.

## Supply Chain Review

Current controls:

- Dependabot covers npm and GitHub Actions.
- npm audit blocks moderate and higher advisories.
- GitHub dependency review blocks newly introduced vulnerable dependencies at
  moderate severity or higher.
- Trivy scans filesystem and image dependencies.
- Gitleaks scans history and worktree.
- SBOM generation emits CycloneDX JSON and SHA-256 checksum.

No production dependency was reported outdated by `npm outdated --omit=dev`.

## Documentation Review

Current operator and evidence docs were reviewed or refreshed:

- `README.md`
- `INSTALL.md`
- `USAGE.md`
- `SECURITY.md`
- `SUPPORT.md`
- `docs/security-model.md`
- `docs/security-gates.md`
- `docs/dependency-management.md`
- `docs/pr-transparency-template.md`
- `docs/soc2-alignment.md`
- `docs/adapter-contract.md`
- `docs/upstream-source.md`
- `docs/verification.md`

SOC 2 note: this repository provides control-friendly evidence only. It is not
SOC 2 certified by itself.

## Limitations

This was a source, CI, dependency, container, and documentation review. It did
not include a live Discord guild test or a live WebUI adapter deployment test.
Those remain deployment-specific smoke tests for operators.

## Disposition

Read-only roadmap work is complete as of this review. The next roadmap should
stay separate and treat any non-read-only capability as a new, higher-risk
security program with upstream write contracts, audit logging, confirmation
flows, and command-family-specific PRs.
