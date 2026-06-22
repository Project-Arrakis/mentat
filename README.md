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

- `/dune health` checks the Discord adapter health endpoint.
- `/dune status` shows the high-level server status payload.
- `/dune readiness` shows readiness/preflight state.
- `/dune services` shows service state from the adapter.

## Setup

1. Copy `.env.example` to `.env`.
2. Set `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DUNE_CONSOLE_API_URL`, and
   `DUNE_DISCORD_ADAPTER_TOKEN`.
3. Set at least one RBAC principal, usually `DISCORD_OBSERVER_ROLE_IDS` or
   `DISCORD_ADMIN_ROLE_IDS`.
4. Optional: set `DISCORD_GUILD_ID` while testing so commands register quickly.
5. Run `npm install`.
6. Run `npm run register`.
7. Run `npm start`.

Docker users can start from `docker-compose.example.yml`.

## Security Gates

Pull requests are expected to pass unit tests, npm audit, Semgrep, Gitleaks,
Trivy filesystem scanning, Docker image build, and Trivy image scanning before
merge. See `docs/security-gates.md`.

## Public Readiness

Before publishing releases or opening a deployment to a wider audience, review:

- `SECURITY.md`
- `SUPPORT.md`
- `docs/discord-setup.md`
- `docs/networking.md`
- `docs/public-readiness.md`
- `docs/pr-transparency-template.md`
- `docs/upstream-source.md`

## Configuration

Endpoint paths and methods are configurable. The defaults match the current
read-only adapter draft:

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
- `DISCORD_HEALTH_ROLE_IDS`, `DISCORD_STATUS_ROLE_IDS`,
  `DISCORD_READINESS_ROLE_IDS`, and `DISCORD_SERVICES_ROLE_IDS` grant a single
  command.
- `DISCORD_ALLOWED_USER_IDS` is an explicit user allow-list for operational
  break-glass cases.
- `DISCORD_RBAC_MODE=open` is available for local testing only.

## Addon Boundary

The `addon/` folder contains a zero-permission UI panel. It is optional and is
only meant to point console users at setup help. The bot runtime stays separate.

See `docs/architecture.md` and `docs/upstream-integration.md` for the design.
