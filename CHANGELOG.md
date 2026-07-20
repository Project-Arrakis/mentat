# Changelog

This project follows Semantic Versioning for release tags. Security fixes,
dependency updates, and release evidence stay tied to pull requests and durable
change notes under `docs/changes/`.

## v1.0.0-rc.2 - 2026-07-18

Second release candidate for the read-only `R1.0.0` production target. Adds
multi-tenant architecture, status card rendering, faction theming, OPS commands,
and Cloudflare tunnel support.

### Added

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

## Unreleased

### Added

- `logs` command group with per-service subcommands (`dune-postgres`, `dune-redis`,
  `dune-nginx`, `dune-orchestrator`, `dune-console`, `dune-steamcmd`).
- `data:verify` subcommand for two-step character linking with in-game whisper code verification.
- Setup portal guide (`docs/setup-portal-guide.md`) for new users.
- Post-receive hook fix: replaced broken `git fetch origin` with `git pull deploy`.
- Stats pusher now writes to both `acp-stats-${INSTANCE_ID}` and `acp-stats-aggregate` KV keys.

### Changed

- `data:link` now uses two-step verification: primary via Discord's verified Steam
  connection (instant link), fallback via in-game whisper code sent through RabbitMQ.
- `admin:broadcast` marked as planned until upstream implements the route.
- Setup portal intro clarified: only console `.env` editing required, not bot config.
- Setup portal docker restart command uses `-f docker-compose.web.yml` and service name.
- `aboutPayload` `readOnly` changed to `false` (bot supports write operations for player linking).

### Fixed

- Guild onboarding DM error now logged with actual error message (was silently swallowed).
- Landing page counter reset bug: `animateCounter` now preserves previous values
  between fetches instead of always starting from 0.

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
