# Configuration

## Required

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot token. |
| `DISCORD_CLIENT_ID` | Discord application client ID. |
| `DISCORD_OBSERVER_ROLE_IDS` or another RBAC principal | Comma-separated Discord role IDs allowed to use current read-only commands. |
| `DUNE_CONSOLE_API_URL` | Base URL for the console API. |
| `DUNE_DISCORD_ADAPTER_TOKEN` | Bearer token accepted by the console adapter. |

Secrets can also be loaded from files with `DISCORD_BOT_TOKEN_FILE` and
`DUNE_DISCORD_ADAPTER_TOKEN_FILE`.

## Optional

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_GUILD_ID` | empty | Register commands to one guild for testing. |
| `DISCORD_RBAC_MODE` | `restricted` | `restricted` requires explicit allow-lists; `open` is for local testing. |
| `DISCORD_ALLOWED_USER_IDS` | empty | Explicit user allow-list for every current command. |
| `DISCORD_ADMIN_ROLE_IDS` | empty | Role IDs allowed to use every current command. |
| `DISCORD_OBSERVER_ROLE_IDS` | empty | Role IDs allowed to use every current read-only command. |
| `DISCORD_ABOUT_ROLE_IDS` | empty | Role IDs allowed to use `/dune about`. |
| `DISCORD_PING_ROLE_IDS` | empty | Role IDs allowed to use `/dune ping`. |
| `DISCORD_HEALTH_ROLE_IDS` | empty | Role IDs allowed to use `/dune health`. |
| `DISCORD_STATUS_ROLE_IDS` | empty | Role IDs allowed to use `/dune status`. |
| `DISCORD_STATUS_SUMMARY_ROLE_IDS` | empty | Role IDs allowed to use `/dune status-summary`. |
| `DISCORD_READINESS_ROLE_IDS` | empty | Role IDs allowed to use `/dune readiness`. |
| `DISCORD_SERVICES_ROLE_IDS` | empty | Role IDs allowed to use `/dune services`. |
| `DISCORD_ALLOWED_ROLE_IDS` | empty | Legacy alias for `DISCORD_OBSERVER_ROLE_IDS`. |
| `DISCORD_DEFAULT_EPHEMERAL` | `true` | Keep command responses private by default. |
| `REQUEST_TIMEOUT_MS` | `8000` | Console adapter request timeout. |
| `DUNE_BOT_HEALTH_STATE_FILE` | `/tmp/dune-discord-bot/health.json` | Local bot readiness state file used by the container healthcheck. |
| `DUNE_BOT_HEALTH_MAX_AGE_MS` | `120000` | Maximum accepted age for the local healthcheck state file. |

## Adapter Overrides

| Variable | Default |
| --- | --- |
| `DUNE_ADAPTER_HEALTH_PATH` | `/api/integrations/discord/health` |
| `DUNE_ADAPTER_STATUS_PATH` | `/api/integrations/discord/status` |
| `DUNE_ADAPTER_READINESS_PATH` | `/api/integrations/discord/readiness` |
| `DUNE_ADAPTER_SERVICES_PATH` | `/api/integrations/discord/services` |
| `DUNE_ADAPTER_HEALTH_METHOD` | `GET` |
| `DUNE_ADAPTER_STATUS_METHOD` | `POST` |
| `DUNE_ADAPTER_READINESS_METHOD` | `POST` |
| `DUNE_ADAPTER_SERVICES_METHOD` | `POST` |

## RBAC Notes

In `restricted` mode, startup fails unless at least one role or user principal
is configured. This keeps the default posture least-privilege and avoids
exposing server state to an entire Discord guild by accident.
