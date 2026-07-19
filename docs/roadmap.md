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
- No test skipping — every test must run and pass.

## Current Foundation

These pieces are already in place:

| Area | Status |
| --- | --- |
| Separate bot repository | Complete |
| Read-only Discord command scaffold | Complete (6 groups, 39+ subcommands) |
| Docker runtime with non-root user | Complete |
| CI security gates | Complete (Semgrep, Gitleaks, Trivy, ggshield, npm audit) |
| Public readiness and support docs | Complete |
| Human-maintained documentation pass | Complete (comprehensive rewrite) |
| Upstream source-of-truth tracking | Complete |
| First read-only release | Complete: `v0.1.0` |
| Release artifacts, SBOM, and checksums | Complete |
| R1.0.0 production release plan | Complete |
| Canvas status cards | Complete (1200×640 PNG, Dune Rise typeface, faction colors) |
| Scheduled status posts | Complete |
| Game → Discord announcement bridge | Complete |
| OPS observability commands | Complete (9 domains) |
| Faction theming | Complete (Atreides, Harkonnen, Fremen) |
| Test harness | Complete (48 harness tests, 204 core tests, 0 skipped) |
| Write safety framework | Staged (disabled by default, R1.5.0) |
| Player inventory + storage | Upstream PR #91 pending merge |

The upstream console source of truth is
`Red-Blink/dune-awakening-selfhost-docker`. The local reference clone is used
only to follow upstream behavior and releases; it is not used as a development
branch for this bot.

## Current Commands

| Command Group | Commands | Purpose |
| --- | --- | --- |
| `core` | `about`, `ping`, `help` | Bot information and diagnostics |
| `server` | `health`, `status`, `summary`, `readiness`, `services` | Game server health checks |
| `data` | `population`, `backups`, `maps` | Game world data |
| `player` | `link`, `unlink`, `me`, `inventory`, `storage`, `find`, `inventory-search` | Player character and inventory (requires linking) |
| `ops` | `activity`, `combat`, `resources`, `economy`, `inventory`, `location`, `soc`, `prometheus`, `dashboard` | Operational statistics (requires OPS addon) |
| `admin` | `doctor`, `cooldowns`, `latency`, `events`, `broadcast` | Administration tools (restricted) |
| `infra` | `version`, `servers`, `ports`, `db` | Infrastructure status |

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

**Status: Complete.** RBAC is enforced across all commands with role-based
capability checks, per-command overrides, and user allow-lists.

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
  release `v1.3.60`.
- Health, status, readiness, and services fixtures are covered by unit tests.
- Configured route overrides are covered by compatibility tests.
- A local token-protected adapter mock serves the fixtures on loopback for smoke
  tests and examples.
- Route status tracking: LIVE (19), PLANNED (5), UNMERGED (10), MISSING (2).

Complexity: low to medium. **Status: Complete.**

## Phase 3: Read-Only Command Expansion

Only add commands backed by safe upstream adapter responses.

### Low complexity — Complete

- `/dune core about` — Bot info with command-level RBAC
- `/dune core ping` — Adapter latency check
- `/dune core help` — Command listing
- `/dune server health` — Adapter health
- `/dune server status` — Status card with canvas rendering
- `/dune server summary` — Compact text status
- `/dune server readiness` — Readiness checks
- `/dune server services` — Service status
- `/dune data population` — Player count
- `/dune data backups` — Backup listing
- `/dune data maps` — Map status
- `/dune infra version` — Stack version
- `/dune infra servers` — Server partitions
- `/dune infra ports` — Network ports
- `/dune infra db` — Database health

### Medium complexity — Complete

- `/dune ops activity` — Player activity over time
- `/dune ops combat` — Combat and death statistics
- `/dune ops resources` — Resource field data
- `/dune ops economy` — Currency, trading, and tax data
- `/dune ops inventory` — Item and crafting statistics
- `/dune ops location` — Map markers and player density
- `/dune ops soc` — OPS bridge health
- `/dune ops prometheus` — Container CPU, memory, and uptime
- `/dune ops dashboard` — Combined summary
- `/dune admin doctor` — Full system diagnostic
- `/dune admin cooldowns` — Rate-limit status
- `/dune admin latency` — Adapter request timing
- `/dune admin events` — Recent incidents
- `/dune admin broadcast` — In-game message (write, disabled by default)

### Higher complexity — Complete

- Scheduled status posts to configured Discord channels
- Game → Discord announcement bridge
- Canvas status card rendering with faction theming
- ACP quotes in embed footers

### Player Features — Upstream PR Pending

- `/dune player link` — Link Discord account to character
- `/dune player unlink` — Remove character link
- `/dune player me` — Show linked character info
- `/dune player inventory` — View character inventory
- `/dune player storage` — View storage containers (owned or guild)
- `/dune player find` — Search items in storage
- `/dune player inventory-search` — Search items in inventory

**Upstream PR:** [Red-Blink/dune-awakening-selfhost-docker#91](https://github.com/Red-Blink/dune-awakening-selfhost-docker/pull/91)
— 489/489 tests pass, all CI checks green.

Security requirements:

- no secrets in output
- no sensitive player details unless upstream exposes a safe aggregate
- channel allow-list before scheduled posts
- rate limits for recurring tasks
- player data isolated per linked account

## Phase 4: Operations and Release Hardening

Small pull requests:

1. Add structured logs without tokens or Discord secrets. **Complete.**
2. Add a Docker healthcheck based on local bot process state. **Complete.**
3. Package the zero-permission addon panel for releases. **Complete.**
4. Add SBOM publishing and dependency review. **Complete.**
5. Add release-candidate support before future stable releases. **Complete.**
6. Comprehensive documentation rewrite for non-technical users. **Complete.**
7. Remove all test skipping — every test must run and pass. **Complete.**

Complexity: medium. **Status: Complete.**

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
- Latest release candidate validated: `v1.0.0-rc.2`
- Next stable target: `v1.0.0` after the promotion checklist in
  `docs/v1.0.0-promotion-checklist.md` is satisfied
- Latest upstream stable baseline: `v1.3.60`
- Latest upstream commit checked: `fdaca43` (Release v1.3.60)
- Latest upstream release candidate observed: none newer than `v1.3.60`
- Pending upstream PR: `feature/discord-player-inventory-rebase` → PR #91
- All test skipping removed — 489/489 pass, 0 skipped
- All pre-commit hooks pass without `--no-verify`

Security requirements:

- no stable release with unresolved medium, high, or critical findings
- prereleases must use the same security gates as stable releases
- release notes, PRs, and issues must redact secrets, PII, SteamIDs,
  FuncomIDs, private addresses, and real names
- upstream RCs are monitored but do not replace the stable compatibility
  baseline without explicit approval

See `docs/production-release-plan.md` for the full path from the current
baseline to the read-only production release.
See `docs/full-release-roadmap.md` for later major release trains toward
controlled write-capable and full-featured milestones. See
`docs/r1-r2-release-roadmap.md` for detailed `R1.x` and `R2.x` cadence and
release gates.

## Deferred Write Actions

These actions remain blocked until upstream publishes a write-capable adapter
contract and each action has explicit RBAC, audit logging, confirmation, and
tests:

- service restart
- broadcast messages (framework staged, disabled by default)
- configuration changes
- backup creation or restoration
- player moderation
- database mutations

Write work should ship one command family at a time and stay separate from
read-only improvements.

See `docs/non-readonly-roadmap.md` for the security-first roadmap that must be
followed before any write-capable implementation begins. See
`docs/upstream-write-adapter-rfc.md` for the draft upstream proposal packet.
See `docs/full-release-roadmap.md` for the release gates that separate read-only
production, low-risk writes, operational writes, and highest-risk operations.
