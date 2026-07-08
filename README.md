# Dune Awakening Self-Host Discord Bot

Read-only Discord companion for Dune Awakening Self-Host Docker.

The bot runs outside the main console repo and talks only to the console's
disabled-by-default, bearer-token protected Discord adapter API. It does not
mount the Docker socket, connect to the database, read game files, or execute
console commands.

There is no shared public bot. Each operator registers a Discord application,
keeps their own bot token, and connects the bot to their own WebUI adapter.

## Commands

The bot uses Discord subcommand groups. Type `/dune` and select a group:

### `core` — Bot Information
`about` · `ping` · `help`

### `server` — Game Server Health
`health` · `status` · `summary` · `readiness` · `services`

> **Pro tip:** Add `diagnostic:true` to `/dune server status` or
> `/dune server readiness` for detailed CLI-style output (admins only).

### `data` — Game Data
`population` · `backups` · `maps`

### `ops` — Operational Observability (requires OPS addon)
`activity` · `combat` · `resources` · `economy` · `inventory` ·
`location` · `soc` · `prometheus` · `dashboard`

### `admin` — Administration (restricted)
`doctor` · `cooldowns` · `latency` · `events` · `broadcast`

### `infra` — Infrastructure
`version` · `servers` · `ports` · `db`

**25 commands total** across 6 groups. See the [User Guide](docs/user-guide.md)
for a plain-English description of each command.

## Setup

See `INSTALL.md` for the full install path.

Short version:

1. Run `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DUNE_CONSOLE_API_URL`, and
   `DUNE_DISCORD_ADAPTER_TOKEN`.
4. Set at least one RBAC principal, usually `DISCORD_OBSERVER_ROLE_IDS` or
   `DISCORD_ADMIN_ROLE_IDS`.
5. Optional: set `DISCORD_GUILD_ID` while testing so commands register quickly.
6. Run `npm run register`.
7. Run `npm start`.

Docker users can start from `docker-compose.example.yml`, which keeps the root
filesystem read-only and uses a local healthcheck state file under `/tmp`.

## Security Gates

Pull requests are expected to pass unit tests, npm audit, Semgrep, Gitleaks,
Trivy filesystem scanning, dependency review, SBOM generation, Docker image
build, and Trivy image scanning before merge. See `docs/security-gates.md`.

`npm run check` runs unit tests, addon package validation, and SBOM generation.

## Releases

Release notes live under `docs/releases/`, and the project changelog lives in
`CHANGELOG.md`. The release process is documented in `docs/release-process.md`.
Post-publication release evidence lives under `docs/release-evidence/`.
The production release plan for the read-only `R1.0.0` target is documented in
`docs/production-release-plan.md`. The larger release-train roadmap toward a
full-featured bot is documented in `docs/full-release-roadmap.md`. The detailed
`R1.x` to `R2.x` cadence and gates live in `docs/r1-r2-release-roadmap.md`.

Tagged releases publish checksummed addon and SBOM artifacts:

- `discord-readonly-bot-v<version>.tar.gz`
- `discord-readonly-bot-v<version>.tar.gz.sha256`
- `dune-awakening-selfhost-discordbot.cdx.json`
- `dune-awakening-selfhost-discordbot.cdx.json.sha256`

Verify checksum files before installing or redistributing release artifacts.
Release-candidate tags such as `v0.1.1-rc.1` are published as GitHub
prereleases and should be treated as validation candidates, not the default
stable operator release.

## Public Readiness

Before publishing releases or opening a deployment to a wider audience, review:

- `CHANGELOG.md`
- `SECURITY.md`
- `INSTALL.md`
- `USAGE.md`
- `SUPPORT.md`
- `docs/discord-setup.md`
- `docs/user-guide.md`
- `docs/admin-guide.md`
- `docs/faq.md`
- `docs/troubleshooting.md`
- `docs/configuration.md`
- `docs/networking.md`
- `docs/operator-validation.md`
- `docs/adapter-contract.md`
- `docs/dependency-management.md`
- `docs/full-release-roadmap.md`
- `docs/public-readiness.md`
- `docs/pr-transparency-template.md`
- `docs/production-release-plan.md`
- `docs/r1-r2-release-roadmap.md`
- `docs/release-process.md`
- `docs/release-evidence/v1.0.0-rc.1.md`
- `docs/releases/v0.1.0.md`
- `docs/security-review-2026-07-03.md`
- `docs/soc2-alignment.md`
- `docs/upstream-write-adapter-rfc.md`
- `docs/upstream-source.md`
- `docs/v1.0.0-promotion-checklist.md`

## Configuration

See `docs/configuration.md` for the complete environment variable list.

Endpoint paths and methods are configurable. The defaults match the current
read-only adapter:

- `GET /api/integrations/discord/health`
- `POST /api/integrations/discord/status`
- `POST /api/integrations/discord/readiness`
- `POST /api/integrations/discord/services`

Set `DUNE_ADAPTER_*_PATH` or `DUNE_ADAPTER_*_METHOD` values if the upstream
release uses different routes.

## RBAC

RBAC defaults to `DISCORD_RBAC_MODE=restricted`. In restricted mode the bot
refuses to start until at least one role or user allow-list is configured.

- `DISCORD_ADMIN_ROLE_IDS` can use every current read-only command.
- `DISCORD_OBSERVER_ROLE_IDS` can use every current read-only command.
- `DISCORD_ABOUT_ROLE_IDS`, `DISCORD_PING_ROLE_IDS`, `DISCORD_HEALTH_ROLE_IDS`,
  `DISCORD_STATUS_ROLE_IDS`, `DISCORD_STATUS_SUMMARY_ROLE_IDS`,
  `DISCORD_READINESS_ROLE_IDS`, and `DISCORD_SERVICES_ROLE_IDS` grant a single
  command.
- `DISCORD_ALLOWED_USER_IDS` is an explicit user allow-list for operational
  break-glass cases.
- `DISCORD_RBAC_MODE=open` is available for local testing only.

## Addon Boundary

The `addon/` folder contains a zero-permission UI panel. It is optional and is
only meant to point console users at setup help. The bot runtime stays separate.
Release packages can be built with `npm run package:addon`; the script refuses
non-zero addon permissions and writes a SHA-256 checksum next to the artifact.

See `docs/architecture.md` and `docs/upstream-integration.md` for the design.

## Usage and Operations

- `USAGE.md` covers command behavior, RBAC, and troubleshooting.
- `docs/verification.md` covers smoke tests and regression checks.
- `docs/operator-validation.md` covers R1.1 operator smoke evidence.
- `docs/dependency-management.md` covers Dependabot, dependency review, SBOMs,
  and finding handling.
- `docs/security-review-2026-07-03.md` records the latest read-only production
  readiness security review.
- `docs/non-readonly-roadmap.md` covers the security bar for any future write
  capabilities.
