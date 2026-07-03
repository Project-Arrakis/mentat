# R1.x to R2.x Release Roadmap

## Purpose

This roadmap turns the broad release-train plan into a practical sequence for
the read-only `R1.x` line and the first write-capable `R2.x` line.

`R1.0.0` remains the production-ready read-only bot. `R1.x` improves read-only
operations without changing server state. `R2.0.0` starts only after upstream
publishes and approves a write-capable adapter contract, and it should begin
with write-safety foundation work before any executable write command ships.

## Cadence Policy

Cadence is a planning tool, not permission to release. A release slips when a
security gate, privacy review, upstream compatibility check, smoke test, or
artifact verification is incomplete.

| Release type | Target cadence | Rules |
| --- | --- | --- |
| Security patch | As needed | Cut immediately after fix, review, gates, and release artifacts pass. Do not wait for the next planned train. |
| Upstream compatibility patch | As needed | Use when upstream changes adapter behavior, release evidence, or safe route assumptions. |
| R1.x read-only minor | Every 4 to 6 weeks when ready | Batch only related read-only improvements. Use release candidates for operator-facing workflow changes. |
| R2.0.0 write foundation | No fixed date | Starts only after upstream write contract approval and R1 production evidence is stable. |
| R2.x low-risk write minor | Every 6 to 8 weeks or slower | One write command family per train. Release candidate required before stable promotion. |
| Comprehensive security review | Before each major train and at least quarterly while active | Review STRIDE, privacy, dependencies, containers, workflows, release evidence, and open findings. |

Dependency and upstream checks should continue weekly through Dependabot,
upstream reference clone refreshes, and security-gate review.

## R1.x Scope

R1.x is for read-only production maturity. It must not add commands that mutate
server state, restart services, change configuration, create backups, restore
data, moderate players, or execute database operations.

Allowed R1.x work:

- read-only command improvements backed by upstream adapter responses
- safer formatting, redaction, and bounded output
- smoke-test and operations documentation
- release artifact and SBOM hardening
- alerting or scheduled posts that only publish read-only state to allow-listed
  channels
- compatibility evidence and route-drift tests

Blocked from R1.x:

- write-specific Discord commands
- write adapter execution calls
- Docker socket access
- database mounts or database mutation
- game-file reads from the bot container
- shell execution from the bot
- player-level data unless upstream exposes a safe aggregate and privacy review
  approves the exact output shape

## R1.x Train Plan

| Train | Theme | Candidate outcomes | Release gate |
| --- | --- | --- | --- |
| `R1.1` | Operator validation | Documented runtime smoke tests, test-guild registration evidence, mock-adapter scenarios, Docker start and healthcheck checklist. | At least one documented end-to-end read-only smoke path. |
| `R1.2` | Read-only detail expansion | `/dune services detail`, `/dune readiness detail`, maintenance metadata, or similar safe detail commands only if upstream exposes safe data. | Adapter contract evidence and fixture coverage for every new field. |
| `R1.3` | Read-only notifications | Scheduled status posts, readiness alerts, or incident digests. | Channel allow-list, rate limits, opt-in config, and no public-channel default. |
| `R1.4` | Compatibility hardening | Upstream drift checklist, fixture refresh workflow, release-candidate monitoring, stronger route compatibility tests. | Current upstream evidence and no stale source-bound docs. |
| `R1.5` | R2 readiness review | Final read-only hardening before write foundation starts. | Comprehensive security review and owner approval to begin R2 planning. |

Train numbers are planning targets. If a feature is not ready, skip it or move
it to a later train rather than weakening a gate.

## R1.x Release Gates

Each R1.x release candidate requires:

- release-preparation PR
- durable change note
- changelog entry
- release notes
- current upstream compatibility evidence
- `npm run check`
- `npm audit --audit-level=moderate`
- GitHub CI and Security Gates
- addon and SBOM checksum verification
- smoke-test result or documented owner-approved deferral
- no unresolved medium, high, or critical security finding

Additional R1.x feature gates:

- new read-only commands need command-level RBAC tests
- new adapter fields need fixtures and redaction tests when sensitive data is
  possible
- recurring posts need channel allow-lists, rate limits, and bounded output
- any player-related data must remain aggregate-only unless separately reviewed

## R2 Entry Criteria

Do not start R2 implementation until all of these are true:

- `R1.0.0` has shipped as read-only production GA.
- The latest R1.x release is stable or intentionally frozen.
- Upstream publishes and approves a write-capable Discord adapter contract.
- Write routes are separate from read-only routes and disabled by default.
- Capability discovery advertises write actions, tiers, request limits,
  idempotency expectations, and disabled reasons.
- Preview and execute request/response schemas are documented.
- Audit ownership is clear between the bot and upstream console.
- A GitHub issue exists for each write command family under consideration.
- A fresh STRIDE and abuse-case review is recorded.
- No medium, high, or critical finding is unresolved.

## R2.x Scope

R2.x is for controlled write capability. The first R2 work should prove the
safety model before adding high-impact operations.

Allowed R2.x work:

- write-disabled configuration defaults
- write-specific RBAC that observer roles never inherit
- write capability discovery
- confirmation, idempotency, timeout, and retry primitives
- audit event schema and redaction tests
- low-risk metadata writes after the foundation is proven

Blocked from early R2.x:

- service restart as the first write command
- update trigger as the first write command
- player moderation
- restore execution
- database execution
- gameplay-affecting configuration changes

## R2.x Train Plan

| Train | Theme | Candidate outcomes | Release gate |
| --- | --- | --- | --- |
| `R2.0.0-rc.1` | Write-safety foundation candidate | Disabled-by-default write config, write RBAC parsing, capability discovery client, confirmation helpers, idempotency helpers, audit schema tests. | No executable write command required; all write paths default disabled. |
| `R2.0.0` | Write-safety foundation stable | Promote the final foundation candidate after gates and owner approval. | Release notes clearly state whether any write execution path exists. |
| `R2.1` | Maintenance metadata writes | Maintenance note or maintenance window set, only if upstream supports preview and execute. | Preview, confirmation, idempotency, audit, rollback, and redaction tests. |
| `R2.2` | Discord notification configuration writes | Bot-owned or adapter-owned notification config updates. | Channel allow-list preservation, audit evidence, and disable path. |
| `R2.3` | Scheduled-post configuration writes | Operator-managed schedule metadata, not server-state mutation. | Rate limits, collision handling, audit evidence, and rollback docs. |
| `R2.4` | R3 readiness review | Assess whether operational writes are safe enough to plan. | Comprehensive security review and owner approval before R3 starts. |

## R2.x Release Gates

Every R2.x PR requires:

- linked GitHub issue for the command family or foundation slice
- STRIDE table
- abuse-case notes
- RBAC matrix
- adapter contract evidence
- tests for allow, deny, malformed input, adapter failure, timeout, redaction,
  and audit output
- rollback or disable instructions
- full local and GitHub gates

Every R2.x release requires:

- release candidate before stable promotion
- artifact and SBOM checksum verification
- no unresolved medium, high, or critical finding
- owner approval in the release-preparation PR
- release notes that name disabled-by-default behavior and known limitations

## R2 Go/No-Go Rules

Do not merge or release an R2 change if any of these are true:

- upstream write contract is missing or ambiguous
- route can perform more than the documented action
- command can run without a write-specific role or explicit user principal
- observer access can execute writes
- confirmation can be bypassed
- retries can duplicate side effects
- audit output can leak secrets or PII
- rollback or disable path is unclear
- public Discord channels receive write details by default
- any medium, high, or critical finding is unresolved

## Security Review Cadence

R1.x review cadence:

- lightweight security review in every PR
- dependency and upstream review weekly
- comprehensive review before `R1.5` or before any R2 work starts

R2.x review cadence:

- STRIDE and abuse-case review for every command family
- privacy review for every payload that can include identity or operator data
- comprehensive review before each stable R2 promotion
- owner approval before moving from low-risk writes to operational writes

## Finding Handling

Findings discovered during R1.x or R2.x work must be resolved transparently:

- fix in the same PR, or
- create a GitHub issue with severity, affected component, evidence, owner, and
  planned resolution, or
- document scanner false-positive evidence and rationale.

Use private reporting or a private issue when evidence includes secrets,
exploit detail, private deployment information, user-identifying data, SteamIDs,
FuncomIDs, emails, real names, keys, passwords, tokens, or private server
addresses.

## Sources

- Full release roadmap: `docs/full-release-roadmap.md`
- Production release plan: `docs/production-release-plan.md`
- Non-read-only roadmap: `docs/non-readonly-roadmap.md`
- Upstream write adapter RFC: `docs/upstream-write-adapter-rfc.md`
- Release process: `docs/release-process.md`
- Security gates: `docs/security-gates.md`
