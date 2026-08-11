# Changelog

This project follows Semantic Versioning for release tags. Security fixes,
dependency updates, and release evidence stay tied to pull requests and durable
change notes under `docs/changes/`.

## v1.0.0-rc.3 - 2026-08-08

Third release candidate. Adds security hardening (PKCE OAuth, session absolute
max age, systemd directives, audit logging), setup portal UI redesign, Core
OPS provider wiring (activity/combat/resources/economy → real duneDb queries),
and deploy guardrail fix (TAP `not ok` detection).

### Added
- PKCE (S256) in Discord OAuth authorization code flow (#180)
- Session absolute max age (7-day `iat` field in cookie payload, #179)
- Systemd hardening: 18 directives (PrivateDevices, CapabilityBoundingSet,
  UMask, ProtectHostname, IPAddressDeny/Allow, RemoveIPC, etc.) (#96)
- Audit logging in Discord link/unlink handlers (#171)
- Stale link cleanup on startup (#183)
- getAllLinkedPlayers tests (#184)

### Changed
- Setup portal UI: extracted shared CSS to setupLayout.js, replaced `alert()`
  with styled inline notifications, server errors render styled HTML pages,
  responsive at 480px (#98)
- Deploy hook now catches TAP `not ok N` format in test output (#97)
- Core opsResourcesProvider now computes totalValueRemaining for statsPusher
  spice_fields (#95)
- Core OPS providers (activity, combat, resources, economy) wired to real
  addonOps* duneDb aggregate queries
- Link prompt text updated for accuracy (#174)

### Fixed
- `pool`→`db` variable bug in linked characters API (#167)
- getAllLinkedPlayers includes legacy discord_player_links table (#173)

## v1.0.0-rc.2 - 2026-07-18

Second release candidate for the read-only `R1.0.0` production target. Adds
multi-tenant architecture, status card rendering, faction theming, OPS commands,
and Cloudflare tunnel support.

### Added (v1.0.0-rc.3, continued)

- Multi-tenant architecture with per-guild console routing and SQLite storage.
- OAuth2 setup portal with dark Dune theme matching `acp.darkdante.org`.
- Guild-scoped RBAC with per-guild role configuration via web portal.
- Canvas status card rendering (1200×640 PNG, Dune Rise typeface, faction colors).
- Faction theming for embeds and status cards (Atreides, Harkonnen, Fremen).
- OPS commands (9 subcommands: activity, combat, resources, economy, inventory,
  location, soc, prometheus, dashboard) with status card output.
- Infra commands (`/dune infra version`, `servers`, `ports`, `db`).
- Player faction system (`/dune data faction`).
- Write command scaffold (12 subcommands, disabled by default).
- Cloudflare Tunnel for setup portal (`acp-setup.darkdante.org`).
- Cloudflare KV stats aggregation for cross-instance live stats.
- Git-based deployment pipeline with pre-deploy test guardrails.
- DM-based guild onboarding on `guildCreate` events.
- Human-readable test reporter.
- Multi-tenant design documentation.
- Terms of Service and Privacy Policy documents.
- `.semgrepignore` for false positive suppression.
- Shared quote pool module (`src/quotes.js`) for embed and card footers.
- 30-second LRU cache for status card generation.
- Error/offline status card variant with red-tinted theme.

### Changed

- Project renamed from "Thumper" to "Arrakis Control Panel" (ACP).
- Player commands moved from `/dune player` group to `/dune data` group.
- All documentation updated with new repo URL (`yacketrj/Arrakis-Control-Panel`).
- `src/config.js` supports multi-tenant mode with optional env vars.
- `src/adapterClient.js` supports guild-scoped config lookup.
- `src/commands.js` RBAC supports both single-tenant (env) and multi-tenant (DB) modes.
- OPS commands now render as status cards instead of text embeds.
- Default database path changed from `data/thumper.db` to `data/acp.db`.
- Environment variable prefix changed from `THUMPER_*` to `ACP_*`.
- Upstream compatibility baseline advanced to `v1.3.60`.

### Fixed

- XSS vulnerabilities in setup server HTML templates (all user values now escaped).
- OAuth2 session state bug (state stored in DB before redirect).
- Empty server dropdown in setup portal (relaxed guild permission filter).
- RBAC array parsing bug in `getGuildRoles` (flat array vs object mismatch).
- Embed formatting standardized across all commands (consistent footers, empty states).
- Semgrep false positives for setup server and test files.
- Test compatibility with new config signature.
- Player command paths in documentation (`/dune player` → `/dune data`).
- Scheduler default value in documentation (5min → 30min).
- Test count in CONTRIBUTING.md (153 → 205+).

### Removed

- `/* nosemgrep */` comments from HTML templates.

### Security

- All setup portal HTML templates use server-side escaping for user input.
- OAuth2 state tokens stored server-side before redirect (prevents CSRF).
- Multi-tenant mode isolates guild data in SQLite with foreign key constraints.
- Status card cache limited to 50 entries with 30-second TTL.

### Added (v1.0.0-rc.3, shipped 2026-08-08)

- `logs` command group with per-service subcommands (`dune-postgres`, `dune-redis`,
  `dune-nginx`, `dune-orchestrator`, `dune-console`, `dune-steamcmd`).
- `data:verify` subcommand for two-step character linking with in-game whisper code verification.
- Setup portal guide (`docs/setup-portal-guide.md`) for new users.
- Post-receive hook fix: replaced broken `git fetch origin` with `git pull deploy`.
- Stats pusher now writes to both `acp-stats-${INSTANCE_ID}` and `acp-stats-aggregate` KV keys.
- Root landing page at `/` on the setup server (dark Dune theme, links to `/setup`).
- `scripts/deploy-post-receive.sh`: canonical, versioned deploy hook (test guardrail,
  restart, health check, and auto-re-registration of slash commands when
  `src/commands.js`/`src/opsCommands.js` change in the pushed range). The live
  OCI hook must be kept in sync with this file.
- `scripts/command-defs-changed.sh` fail-safe range checker used by the hook.
- `scripts/reencrypt-secrets.js` bulk re-encryption tool for existing
  installs (dry-run, WAL-consistent backup, no-key abort, idempotent) --
  `npm run reencrypt`.
- Bats coverage for the deploy hook (`test/deploy-hook.bats`), run by
  `npm test` after the node suite.

### Changed

- `data:link` now uses two-step verification via an in-game whisper code sent
  through RabbitMQ. **Correction (2026-07-24):** this entry originally also
  claimed a "Discord's verified Steam connection (instant link)" primary
  path; that was never actually implemented at this release — verified
  against `a15d4a8`'s actual code (no OAuth/connections-scope code existed
  anywhere in the repo at that commit). Only the whisper-code flow shipped.
  The real Steam-connections-based linking feature was designed and
  implemented starting 2026-07-24 — see `docs/steam-link-design.md`.
- `admin:broadcast` marked as planned until upstream implements the route.
- Setup portal intro clarified: only console `.env` editing required, not bot config.
- Setup portal docker restart command uses `-f docker-compose.web.yml` and service name.
- `aboutPayload` `readOnly` changed to `false` (bot supports write operations for player linking).
- `/dune help` (`helpPayload`) now lists the full registered command surface
  (54 non-write commands, plus the 12 command-write commands only when that
  group is enabled) -- it previously omitted the entire `player` group, the
  entire `logs` group, and 3 `server` subcommands, hiding real commands from
  users. Pinned by `test/commands.test.js`.
- Adapter route tables reconciled (LIVE 28 / PLANNED 8 / UNMERGED 7 /
  MISSING 6): twelve previously-unclassified route keys are now classified,
  including nine player routes the bot calls daily and
  `players-accounts-link-steam` (live), `maintenance` (missing -- declared
  upstream but never registered, every call 404s), and the dead
  `player-links*` config keys. Pinned by `test/adapterClient.test.js`; no
  config route key may be unclassified now. See
  `docs/ro-roadmap-state-2026-08-06.md`.
- Re-linking an already-linked character shows a distinct "Already Linked"
  message instead of a generic success line.

### Fixed

- Guild onboarding DM error now logged with actual error message (was silently swallowed).
- Landing page counter reset bug: `animateCounter` now preserves previous values
  between fetches instead of always starting from 0.
- `/dune ops announcements` threw a `TypeError` in production: the dispatch
  derived method name `opsAnnouncements` from route `ops-announcements`, a
  method that only ever existed in the test mock -- the real `AdapterClient`
  exposes `announcements()`, which the ops subcommand now routes to (the
  `ops-announcements` route path itself has never existed on Core; the real
  route is `/api/integrations/discord/announcements`).
- Player route status reporting: nine player routes the bot calls daily
  reported `"unknown"` status because they had been removed from
  `UNMERGED_ROUTES` in the 2026-07-26 reconciliation without being added to
  `LIVE_ROUTES` (all are real, live Core routes since the PR #91 merge).

### Removed

- `data:maintenance` subcommand (route does not exist in upstream console).

### Security

- Character linking requires ownership proof: Discord Steam connection or
  in-game RCON code. No public info (Steam ID) can bypass verification.
- Unique constraint on `player_controller_id` prevents duplicate links.

## v1.0.0-rc.1 - 2026-07-03

Release candidate for the read-only `R1.0.0` production target. This candidate
keeps the bot read-only and packages the completed operator validation,
upstream compatibility, security review, and release-roadmap evidence for
prerelease validation.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Draft upstream write-adapter RFC with proposed disabled-by-default write
  routes, schemas, fixtures, STRIDE notes, abuse cases, and maintainer
  questions.
- Production release plan and release train strategy for the read-only
  `R1.0.0` target.
- Full release roadmap that keeps `R1.0.0` read-only and maps later major
  trains toward controlled write-capable features.
- Refreshed current upstream compatibility evidence to
  `Red-Blink/dune-awakening-selfhost-docker@5163bd8`, tag `v1.3.41`.
- Detailed `R1.x` to `R2.x` roadmap with release cadence, entry criteria,
  train scopes, and go/no-go gates.
- Operator validation checklist and read-only adapter smoke command for the
  `R1.1` validation path.
- Read-only production readiness security review current through PR #38 and
  upstream `v1.3.41`.
- Durable documentation guard for tool and provider references in docs and PR
  templates.
- Workflow policy guard requiring GitHub Actions references to use immutable
  commit SHA pins.

### Changed

- Replaced workspace-specific upstream clone paths with portable sibling-path
  references in source-bound documentation.
- Advanced the release planning baseline from `R0.1.5` to `R0.9.0` release
  candidate freeze for the `v1.0.0-rc.1` preparation.

### Security

- Recorded current STRIDE, privacy, SOC 2 alignment, supply-chain, release
  readiness, and finding disposition evidence for the read-only production
  boundary.
- Pinned GitHub Actions workflow dependencies to immutable commit SHAs to close
  the Semgrep mutable-action supply-chain finding tracked in issue #30.
- Updated pinned workflow action SHAs for setup-python and upload-artifact
  after dependency review and successful security gates.

## v0.1.1 - 2026-06-28

Stable promotion of the `v0.1.1-rc.1` release candidate after candidate
workflow validation, GitHub prerelease publication, and published artifact
checksum verification.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Release-candidate workflow support for prerelease SemVer tags and GitHub
  prereleases.
- Roadmap guidance for candidate validation before stable promotion.

### Changed

- Upstream evidence records the standalone Windows reference clone and the
  latest observed upstream release-candidate tag separately from the stable
  compatibility baseline.

## v0.1.1-rc.1 - 2026-06-28

Release candidate for the release-candidate workflow and roadmap update.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Release-candidate workflow support for prerelease SemVer tags and GitHub
  prereleases.
- Roadmap guidance for candidate validation before stable promotion.

### Changed

- Upstream evidence now records the standalone Windows reference clone and the
  latest observed upstream release-candidate tag separately from the stable
  compatibility baseline.

## v0.1.0 - 2026-06-28

Initial read-only release for the self-hosted Discord bot.

### Added
### Fixed

- (reserved for future changes)

### Removed

- (reserved for future changes)

- Read-only `/dune` command family for about, ping, health, status,
  status-summary, readiness, and services.
- Restricted-by-default Discord RBAC with role and user allow-lists.
- Configurable read-only adapter routes aligned with the upstream WebUI
  Discord adapter.
- Local adapter mock and route compatibility fixtures.
- Zero-permission addon package generation with SHA-256 checksum.
- CycloneDX SBOM generation with SHA-256 checksum.
- Docker runtime hardening and healthcheck support.

### Security

- No Docker socket mount, database access, game-file access, shell execution, or
  write-capable adapter routes.
- Redaction for credentials, authorization headers, emails, SteamIDs,
  FuncomIDs, and explicit real-name fields before output reaches Discord or
  logs.
- Required PR gates for unit tests, npm audit, Semgrep, Gitleaks, Trivy
  filesystem scanning, dependency review, SBOM generation, Docker build, and
  Trivy image scanning.
- STRIDE review completed for the read-only boundary.

### Evidence

- Release notes: `docs/releases/v0.1.0.md`
- Read-only security review: `docs/security-review-2026-06-28.md`
- Upstream compatibility baseline:
  `Red-Blink/dune-awakening-selfhost-docker@1bb72c5`, tag `v1.3.37`

## [1.0.0-rc.4] — 2026-08-10

### Added
- Unified output pipeline: enricher.js (shared footer/timestamp/version) + pipeline.js (sendEmbed, sendCard, sendError, sendText, sendEphemeral)
- Dedicated formatters for server:services, admin:roles, logs, infra:version, player commands, core:help
- Steam-link embeds (styled embed + button instead of raw text)
- Auth/cooldown denials now use ephemeral styled embeds

### Fixed
- Dead OPS embed formatters removed from import chain (#114)
- fmtBool(undefined) shows "— Unknown —" instead of "❌ No" (#121)
- Dynamic colors on population/storage/unlink/ports (warning on empty, success on data) (#122)
- formatReadinessDetailEmbed treats undefined ready correctly (#124)
- formatGenericEmbed shows "— None —" instead of silently dropping null fields
- formatPopulationEmbed "?" replaced with "— Unknown —"
- Map names show "Unknown Map" instead of "undefined" (#127)
- Diagnostic data pipeline: safeStatusProvider now passes {diagnostic} opts through
- fmt() uses **bold** for string values (consistent with dedicated formatters) (#128)
- Stale /dune data → /dune player command paths fixed (5 locations)
- sendError parses JSON body, shows only error/message field
- formatPayload fallback uses embed instead of raw JSON dump
- enricher setTimestamp passes Date object (not ISO string), fixing CI crash
- opsPlaceholder no longer mentions GitHub org reference
- Capability enum errors replaced with user-friendly role-based messages

### Changed
- parseResponseBody returns ok:false for non-JSON responses (not phantom success)
- Field names truncated to 256 chars in duneEmbed
- !payload?.ok checks replaced with data field presence checks in inventory/link/whoami

## [1.0.0-rc.5] — 2026-08-11

### Changed
- OPS commands now use embeds instead of PNG cards (#155)
- server:status non-diagnostic uses embed (unified output)

### Fixed
- All 10 OPS embed formatters updated to match Core response fields (#147, #156-158)
- formatSocEmbed: platformHealth, bridgeRequests, bridgeErrors (#150)
- formatDashboardEmbed: reads nested dashboard.{section}.result structure
- formatPrometheusEmbed: reads flat services object
- formatAnnouncementsEmbed: handles object structure {settings, defaults}
- formatEconomyEmbed: totalSupply/totalCurrencyHolders (#149)
- formatResourcesEmbed: per-instance sizes[] array (#157)
- formatOpsInventoryEmbed: dropped non-existent fields (#158)
- statusSummaryPayload reads result directly (#148)
- Steam link endpoint enabled (#238)
- duneEmbed import for Steam-link flow
- let embed hoisted before OPS dispatch
- OPS test assertions restored after embed revert (#154)
- server:maintenance fallback handles null payload
- Discord OAuth SameSite=None cookie fix (#224)
- save-oauth-secret requires overwrite:true for existing secrets (#225)
