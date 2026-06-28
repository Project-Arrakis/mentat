# Dune Awakening Self-Host Discord Bot

Read-only Discord companion for Dune Awakening Self-Host Docker.

The bot runs outside the main console repo and talks only to the console's
disabled-by-default, bearer-token protected Discord adapter API. It does not
mount the Docker socket, connect to the database, read game files, or execute
console commands.

There is no shared public bot. Each operator registers a Discord application,
keeps their own bot token, and connects the bot to their own WebUI adapter.

## Commands

Register one `/dune` slash command with these subcommands:

- `/dune about` shows safe bot and adapter metadata.
- `/dune ping` measures Discord defer timing and adapter health latency.
- `/dune health` checks the Discord adapter health endpoint.
- `/dune status` shows the high-level server status payload.
- `/dune status-summary` shows compact aggregate status for lower-noise posts.
- `/dune readiness` shows readiness/preflight state.
- `/dune services` shows service state from the adapter.

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

Tagged releases publish checksummed addon and SBOM artifacts:

- `discord-readonly-bot-v<version>.tar.gz`
- `discord-readonly-bot-v<version>.tar.gz.sha256`
- `dune-awakening-selfhost-discordbot.cdx.json`
- `dune-awakening-selfhost-discordbot.cdx.json.sha256`

Verify checksum files before installing or redistributing release artifacts.

## Public Readiness

Before publishing releases or opening a deployment to a wider audience, review:

- `CHANGELOG.md`
- `SECURITY.md`
- `INSTALL.md`
- `USAGE.md`
- `SUPPORT.md`
- `docs/discord-setup.md`
- `docs/networking.md`
- `docs/adapter-contract.md`
- `docs/dependency-management.md`
- `docs/public-readiness.md`
- `docs/pr-transparency-template.md`
- `docs/release-process.md`
- `docs/releases/v0.1.0.md`
- `docs/soc2-alignment.md`
- `docs/upstream-source.md`

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
- `docs/dependency-management.md` covers Dependabot, dependency review, SBOMs,
  and finding handling.
- `docs/non-readonly-roadmap.md` covers the security bar for any future write
  capabilities.
