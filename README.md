# Dune Awakening Self-Host Discord Bot

Read-only Discord companion for Dune Awakening Self-Host Docker.

This repository intentionally keeps the Discord bot outside the main console
repository. The bot talks only to the console's disabled-by-default, bearer-token
protected Discord adapter API and does not mount the Docker socket, connect to
the database, read game files, or execute console commands.

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
3. Optional: set `DISCORD_GUILD_ID` while testing so commands register quickly.
4. Run `npm install`.
5. Run `npm run register`.
6. Run `npm start`.

Docker users can start from `docker-compose.example.yml`.

## Security Gates

Pull requests are expected to pass unit tests, npm audit, Semgrep, Gitleaks,
Trivy filesystem scanning, Docker image build, and Trivy image scanning before
merge. See `docs/security-gates.md`.

## Configuration

Endpoint paths and methods are configurable because the upstream adapter release
may change route names before publication. Defaults match the prior read-only
adapter draft:

- `GET /api/integrations/discord/health`
- `POST /api/integrations/discord/status`
- `POST /api/integrations/discord/readiness`
- `POST /api/integrations/discord/services`

Set `DUNE_ADAPTER_*_PATH` or `DUNE_ADAPTER_*_METHOD` values if the upstream
release uses different routes.

## Addon Boundary

The `addon/` folder contains a zero-permission UI addon panel. It is optional
and exists only as a console-facing install/help surface. The bot runtime is a
separate process and remains the supported deployment boundary.

See `docs/architecture.md` and `docs/upstream-integration.md` for the design.
