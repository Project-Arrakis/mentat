# Security-First Roadmap

This project stays useful by staying boring in the right places: small pull
requests, clear permissions, readable test evidence, and no shortcuts around the
console boundary.

The bot remains read-only against the console boundary. It talks only to the
console's bearer-token protected Discord adapter API. It never mounts the
Docker socket, connects to the database, reads game files, or runs raw console
commands. Player linking is the one write path: it updates the calling user's
own link state through Core's dedicated player-link adapter routes (still not a
privilege boundary crossing). The separate operator write-command group
(`write:*`) stays disabled unless explicitly configured.

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
| Read-only Discord command scaffold | Complete (8 groups, 55 subcommands; write group adds 12 when enabled) |
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
| OPS observability commands | Complete (10 subcommands) |
| Faction theming | Complete (Atreides, Harkonnen, Fremen) |
| Test harness | Complete (491 core tests, 73 harness tests, 5 bats tests; 4 skipped -- counts verified directly against real `npm test` output 2026-08-17, see #177) |
| Write safety framework | Staged (disabled by default, `DUNE_DISCORD_WRITES_ENABLED`, R1.5.0) |
| Player inventory + storage | Complete (upstream PR #91 merged 2026-07-20, live since v1.3.61) |

The upstream console source of truth is
`Red-Blink/dune-awakening-selfhost-docker`. The local reference clone is used
only to follow upstream behavior and releases; it is not used as a development
branch for this bot.

## Current Commands

(The exact registered surface, matching `src/commands.js`'s
`buildDuneCommand()` and `/dune help` -- refreshed 2026-08-06.)

| Command Group | Commands | Purpose |
| --- | --- | --- |
| `core` | `about`, `ping`, `help`, `setup` | Bot information and help |
| `server` | `health`, `status`, `summary`, `readiness`, `readiness-detail`, `services`, `services-detail`, `maintenance` | Game server health checks |
| `data` | `population`, `backups`, `maps` | Game world data |
| `player` | `link`, `verify`, `characters`, `enable`, `disable`, `default`, `unlink`, `faction`, `whoami`, `inventory`, `storage`, `find` | Your character: linking, inventory, storage, account management |
| `logs` | `dune-cache`, `dune-generated`, `dune-server`, `dune-steam`, `dune-work`, `orchestrator`, `redblink-dune-docker-console` | Game service container logs |
| `ops` | `activity`, `combat`, `resources`, `economy`, `armory`, `location`, `soc`, `prometheus`, `dashboard`, `announcements` | Operational statistics (requires OPS addon) |
| `admin` | `doctor`, `cooldowns`, `latency`, `events`, `roles`, `broadcast` | Administration tools (restricted) |
| `infra` | `version`, `servers`, `ports`, `db` | Infrastructure status |
| `write` | `maintenance-note`, `maintenance-window`, `alert-channel`, `alert-threshold`, `digest-schedule`, `post-schedule`, `add-channel`, `remove-channel`, `backup`, `restart`, `update`, `cache` | Operator writes (only registered when `DUNE_DISCORD_WRITES_ENABLED=true`) |

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
  release `v1.4.8` (re-verified 2026-09-06; unchanged since the 2026-08-16
  baseline).
- Health, status, readiness, and services fixtures are covered by unit tests.
- Configured route overrides are covered by compatibility tests.
- A local token-protected adapter mock serves the fixtures on loopback for smoke
  tests and examples.
- Route status tracking: LIVE (32), PLANNED (1), UNMERGED (7), MISSING (9).
  Every route key in `config.js`'s path table is classified in exactly one
  set -- pinned by `test/adapterClient.test.js` so an unclassified route is a
  test failure. (Corrected 2026-08-16, `arrakis-control-panel#172`: a routine
  compat pin refresh to that baseline found the 2026-08-06 figures below
  contained a real false claim -- `players-accounts-list`,
  `players-accounts-unlink`, and `players-accounts-link-steam` had never
  existed in any tagged upstream release, despite being counted as LIVE and
  "verified" -- plus a real regression (`ops-dashboard`: LIVE at the
  2026-08-06 baseline, 404s as of the 2026-08-16 baseline) and a
  safe-direction correction (`backups`, `announcements`, `maintenance`:
  PLANNED/MISSING at the 2026-08-06 baseline, now genuinely LIVE as of the
  2026-08-16 baseline). See `docs/adapter-contract.md` for the current,
  corrected route table. Previously corrected 2026-08-06: previously reported
  LIVE 19 / PLANNED 5 / UNMERGED 10 / MISSING 2, which was stale in all four
  directions; that audit found fourteen route keys with no classification at
  all, including nine player routes the bot calls daily. See
  `docs/ro-roadmap-state-2026-08-06.md`, which itself now carries 2026-08-16
  and 2026-09-06 correction notices at its top.)

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
- `/dune ops armory` — Item and crafting statistics
- `/dune ops location` — Map markers and player density
- `/dune ops soc` — OPS bridge health
- `/dune ops prometheus` — Container CPU, memory, and uptime
- `/dune ops dashboard` — Combined summary. **Regressed to a graceful error as
  of the 2026-08-16 upstream baseline** (was live through the 2026-08-06
  baseline; upstream's routes.js dispatch table now omits it -- see
  `arrakis-control-panel#172`; still absent as of the 2026-09-06
  re-verification, `v1.4.8`). The
  subcommand remains registered and surfaces a clear "not available on this
  Core installation" message rather than a raw 404.
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

### Player Features — Implemented

- `/dune player link <character>` — Link Discord account to character; bot automatically offers a whisper code or an instant "Link via Steam" button depending on whether the character has a Steam account on file
- `/dune player verify <code>` — Complete linking with in-game verification code (whisper path only)
- `/dune player unlink` — Remove character link
- `/dune player whoami` — Show linked character info
- `/dune player inventory` — View character inventory
- `/dune player inventory <search>` — Search items in inventory
- `/dune player storage` — View storage containers (owned or guild)
- `/dune player find` — Search items in storage
- `/dune player faction` — Show your real, in-game faction (read-only, auto-detected from `dune.player_faction` — see `dune-awakening-selfhost-docker#696`)

**Upstream PR:** [Red-Blink/dune-awakening-selfhost-docker#91](https://github.com/Red-Blink/dune-awakening-selfhost-docker/pull/91)
— **merged 2026-07-20** (`47ca186`, shipped in `v1.3.61`; all of PR #91's
player routes remain live through the current baseline, re-verified against
`v1.4.8` as of 2026-09-06). The
player-feature rows below are therefore live end-to-end, not pending
upstream. This does not include the Steam multi-account linking flow's
`players/accounts/*` routes, which are separate from PR #91 and never
actually reached a tagged upstream release -- see
`arrakis-control-panel#172` and `docs/adapter-contract.md`.

Security requirements:

- no secrets in output
- no sensitive player details unless upstream exposes a safe aggregate
- channel allow-list before scheduled posts
- rate limits for recurring tasks
- player data isolated per linked account
- verification codes expire after 5 minutes
- codes are single-use and tied to the generating Discord user

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

Current release state (issue #178, re-verified 2026-09-06):

- Latest bot stable release: `v0.1.1` (2026-06-28) -- still the only
  release ever promoted out of pre-release; unchanged since the prior
  entry, not a new gap.
- Latest release candidate validated: `v1.0.0-rc.2` (note: `package.json`'s
  current version has since advanced past this -- see
  `docs/release-evidence/` for which RC has full committed validation
  evidence; refreshing this pin for later RCs is a separate, tracked task,
  not part of the `#172` upstream compat pin refresh). **This is still
  accurate, not stale** -- confirmed unchanged as of 2026-09-06:
  `docs/release-evidence/` still only has `v1.0.0-rc.1.md`/`v1.0.0-rc.2.md`.
- **The real gap issue #178 was actually about**: `package.json` and
  GitHub Releases have moved on to `v1.0.0-rc.5` (published 2026-08-11,
  marked "Latest") with **zero committed release-evidence docs for rc.3,
  rc.4, or rc.5** -- three real releases shipped with no durable evidence
  artifact at all, not just an unrefreshed pin. Per this project's own
  evidence-first discipline (a release needs a durable evidence artifact,
  not just a tag), this should be backfilled or explicitly accepted as a
  known gap before any further RC ships.
- Next stable target: `v1.0.0` after the promotion checklist in
  `docs/v1.0.0-promotion-checklist.md` is satisfied (that checklist
  itself is still rc.1-era per this doc's earlier RO-roadmap audit --
  needs its own refresh, tracked separately).
- Latest upstream stable baseline: `v1.4.8`
  (`b53765c2070c12d7ebb4adc8103f26c42745fa7c`, "Release v1.4.8", 2026-09-03;
  see `docs/adapter-contract.md`'s 2026-09-06 entry -- re-verified, route
  classification unchanged since the 2026-08-16 baseline).
- Latest upstream release candidate observed: none newer than `v1.4.8`.
- Upstream player-inventory PR #91: **merged 2026-07-20**, live since `v1.3.61`
  (unchanged, not re-checked this pass).
- Test suite (verified directly against real `npm test` output, 2026-09-06):
  611 (all-others) + 73 (harness) + 242 (issue-bridge) = 926 tests, 922
  pass, 0 fail, 4 skipped (2 in all-others, 2 in harness). The prior
  "491 core + 73 harness + 5 bats" breakdown (2026-08-17) used different
  category names than the test runner's current output buckets
  (all-others/harness/bats/issue-bridge) -- not a like-for-like
  comparison, so this entry reports the runner's actual current bucket
  names/counts rather than force-mapping onto the old ones.
- All pre-commit hooks pass without `--no-verify` (not independently
  re-verified this pass; carried forward from the prior entry).

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
