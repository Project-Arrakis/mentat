# Security-First Roadmap

This project stays useful by staying boring in the right places: small pull
requests, clear permissions, readable test evidence, and no shortcuts around the
console boundary.

The bot remains read-only. It talks only to the console's bearer-token protected
Discord adapter API. It never mounts the Docker socket, connects to the
database, reads game files, or runs raw console commands.

## Guardrails

- Security work lands before feature growth.
- Default behavior must fail closed.
- Every command needs an RBAC rule before it ships.
- New commands use adapter endpoints instead of console internals.
- Each pull request includes tests, documentation, and verification notes.
- Write actions stay out of scope until upstream publishes and approves a
  write-capable adapter contract.

## Current Foundation

These pieces are already in place:

| Area | Status |
| --- | --- |
| Separate bot repository | Complete |
| Read-only Discord command scaffold | Complete |
| Docker runtime with non-root user | Complete |
| CI security gates | Complete |
| Public readiness and support docs | Complete |
| Human-maintained documentation pass | Complete |
| Upstream source-of-truth tracking | Complete |
| First read-only release | Complete: `v0.1.0` |
| Release artifacts, SBOM, and checksums | Complete |

The upstream console source of truth is
`Red-Blink/dune-awakening-selfhost-docker`. The local reference clone is used
only to follow upstream behavior and releases; it is not used as a development
branch for this bot.

## Current Commands

| Command | Purpose | Sensitivity | Test coverage |
| --- | --- | --- | --- |
| `/dune about` | Safe bot and adapter metadata | Low | Unit tested |
| `/dune ping` | Discord defer timing and adapter health latency | Low | Unit tested |
| `/dune health` | Adapter health check | Low | Unit tested |
| `/dune status` | High-level server status | Medium | Unit tested |
| `/dune status-summary` | Compact aggregate server status | Low | Unit tested |
| `/dune readiness` | Readiness and preflight state | Medium | Unit tested |
| `/dune services` | Service state from the adapter | Medium | Unit tested |

Each current command must remain read-only, call only the adapter client, enforce
command-level RBAC, and return bounded redacted Discord output.

## Phase 1: RBAC and Least Privilege

Goal: make command access explicit before adding more behavior.

Pull request scope:

1. Keep `DISCORD_RBAC_MODE=restricted` as the default.
2. Refuse startup in restricted mode unless at least one role or user allow-list
   entry is configured.
3. Support admin, observer, command-specific, and user allow-lists.
4. Keep `DISCORD_RBAC_MODE=open` available only for local testing.
5. Document the least-privilege model in setup and security docs.

Required verification:

- restricted mode fails closed without allow-lists
- command-specific roles grant only their own command
- admin and observer roles inherit current read-only commands
- explicit user allow-list works
- unsupported commands fail closed

## Phase 2: Adapter Contract Stabilization

Goal: follow upstream releases without asking the console maintainer to absorb
bot-specific churn.

Small pull requests:

1. Confirm released endpoint paths, methods, and payload shapes.
2. Add fixtures for health, status, readiness, and services responses.
3. Add compatibility tests for configured route overrides.
4. Add a local adapter mock for smoke testing and examples.

Progress:

- Endpoint paths, methods, and payload shapes are confirmed against upstream
  release `v1.3.37`.
- Health, status, readiness, and services fixtures are covered by unit tests.
- Configured route overrides are covered by compatibility tests.
- A local token-protected adapter mock serves the fixtures on loopback for smoke
  tests and examples.

Complexity: low to medium.

## Phase 3: Read-Only Command Expansion

Only add commands backed by safe upstream adapter responses.

Low complexity:

- Complete.

Progress:

- `/dune about` is implemented with command-level RBAC and no adapter call.
- `/dune ping` is implemented with command-level RBAC and the existing health
  adapter route.
- `/dune status-summary` is implemented with command-level RBAC and the existing
  status adapter route. It uses a hyphenated subcommand to avoid breaking the
  existing `/dune status` slash command structure.

Medium complexity:

- `/dune services detail`: richer service table if the adapter exposes it.
- `/dune readiness detail`: grouped readiness checks and failure summaries.
- `/dune players summary`: aggregate counts only if upstream exposes safe data.
- `/dune maintenance window`: read-only maintenance metadata if upstream exposes
  it.

Higher complexity:

- Scheduled status posts to configured Discord channels.
- Alert subscriptions for readiness or service state changes.
- Incident digest summaries.

Security requirements:

- no secrets in output
- no sensitive player details unless upstream exposes a safe aggregate
- channel allow-list before scheduled posts
- rate limits for recurring tasks

## Phase 4: Operations and Release Hardening

Small pull requests:

1. Add structured logs without tokens or Discord secrets. Complete.
2. Add a Docker healthcheck based on local bot process state. Complete.
3. Package the zero-permission addon panel for releases. Complete.
4. Add SBOM publishing and dependency review. Complete.
5. Add release-candidate support before future stable releases. Complete.

Complexity: medium.

## Phase 5: Release Candidate and Stable Release Discipline

Goal: make every release traceable, reproducible, and security-gated.

Required release path:

1. Review upstream stable and release-candidate tags for adapter impact.
2. Open a release-preparation PR with changelog, release notes, and change note
   evidence.
3. Publish `vMAJOR.MINOR.PATCH-rc.N` as a GitHub prerelease when a change needs
   candidate validation before it becomes the latest stable release.
4. Verify addon and SBOM checksums from the published GitHub Release assets.
5. Promote to `vMAJOR.MINOR.PATCH` only after local gates, GitHub CI/security
   gates, and any planned operator smoke testing pass.

Current release state:

- Latest bot stable release: `v0.1.1`
- Latest release candidate validated: `v0.1.1-rc.1`
- Next candidate target: to be assigned by the next release-preparation PR
- Next stable target: to be assigned after the next candidate or patch scope is
  approved
- Latest upstream stable baseline: `v1.3.37`
- Latest upstream release candidate observed: `v1.3.38-rc.1`

Security requirements:

- no stable release with unresolved medium, high, or critical findings
- prereleases must use the same security gates as stable releases
- release notes, PRs, and issues must redact secrets, PII, SteamIDs,
  FuncomIDs, private addresses, and real names
- upstream RCs are monitored but do not replace the stable compatibility
  baseline without explicit approval

## Deferred Write Actions

These actions remain blocked until upstream publishes a write-capable adapter
contract and each action has explicit RBAC, audit logging, confirmation, and
tests:

- service restart
- broadcast messages
- configuration changes
- backup creation or restoration
- player moderation
- database mutations

Write work should ship one command family at a time and stay separate from
read-only improvements.

See `docs/non-readonly-roadmap.md` for the security-first roadmap that must be
followed before any write-capable implementation begins.
