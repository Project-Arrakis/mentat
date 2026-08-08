# Configuration Reference

Every environment variable, role mapping, and feature flag for the Dune Discord Bot.

> **Scope (2026-08-07, issue #93):** server owners do **not** need this
> page — the hosted bot has no `.env` on the operator's side (see
> [Setup Portal Guide](setup-portal-guide.md)). This reference is for
> **maintainers/self-hosted operators** running their own instance, and
> for understanding multi-tenant hosting options (Section: Multi-Tenant
> Configuration).

## Quick Start (Minimal Configuration)

For first-time setup, you only need these 4 values:

```bash
DISCORD_BOT_TOKEN=           # From Discord Developer Portal → Bot → Token
DISCORD_CLIENT_ID=            # From Discord Developer Portal → General Information
DUNE_CONSOLE_API_URL=http://localhost:8088  # Your console WebUI address
DUNE_DISCORD_ADAPTER_TOKEN=   # Must match console's bot-api-token.txt
```

**Security tip:** Use file-based secrets instead of raw tokens:
```bash
DISCORD_BOT_TOKEN_FILE=/app/secrets/discord-bot-token.txt
DUNE_DISCORD_ADAPTER_TOKEN_FILE=/app/secrets/adapter-token.txt
```

For Docker users, mount the secrets directory as a read-only volume:
```bash
docker run ... -v /host/secrets:/app/secrets:ro ...
```

See the [Admin Guide](admin-guide.md) for a step-by-step setup walkthrough.

---

## Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | Discord bot token from Developer Portal | `mfa.xxxx...` |
| `DISCORD_CLIENT_ID` | Discord application ID | `123456789012345678` |
| `DUNE_CONSOLE_API_URL` | Console WebUI base URL | `http://192.168.1.100:3000` |
| `DUNE_DISCORD_ADAPTER_TOKEN` | Token shared with console adapter | `random-secure-token` |

### File-Based Secrets (Preferred)

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN_FILE` | Path to file containing the Discord bot token |
| `DUNE_DISCORD_ADAPTER_TOKEN_FILE` | Path to file containing the adapter token |

When both a direct env var and a `_FILE` variant are set, the direct env var takes precedence.

---

## Discord Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_GUILD_ID` | *(empty)* | Dev guild ID for instant command registration. Leave empty for global commands |
| `DISCORD_DEFAULT_EPHEMERAL` | `true` | Bot replies visible only to the user who ran the command |

---

## Role-Based Access Control (RBAC)

The bot defaults to **restricted** mode. Every command requires an allowed role
or user ID unless `DISCORD_RBAC_MODE=open`.

### RBAC Mode

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `DISCORD_RBAC_MODE` | `restricted`, `open` | `restricted` | Set to `open` to allow all server members |

In `restricted` mode, at least one principal (role or user) must be configured
or the bot will fail to start.

### Role IDs

| Variable | Description |
|----------|-------------|
| `DISCORD_OBSERVER_ROLE_IDS` | Comma-separated Discord role IDs for read-only commands |
| `DISCORD_ADMIN_ROLE_IDS` | Comma-separated Discord role IDs for admin commands |
| `DISCORD_WRITE_ADMIN_ROLE_IDS` | Roles allowed to execute write commands (R2+) |
| `DISCORD_WRITE_OWNER_ROLE_IDS` | Roles allowed to execute high-risk write commands (R3+) |

### User Allow-List

| Variable | Description |
|----------|-------------|
| `DISCORD_ALLOWED_USER_IDS` | Comma-separated Discord user IDs with access to all commands |

### Per-Command Role Overrides

Each command can have its own role list. If not set, falls back to observer/admin.

| Variable | Command |
|----------|---------|
| `DISCORD_HEALTH_ROLE_IDS` | `/dune server health` |
| `DISCORD_ABOUT_ROLE_IDS` | `/dune core about` |
| `DISCORD_PING_ROLE_IDS` | `/dune core ping` |
| `DISCORD_STATUS_ROLE_IDS` | `/dune server status` |
| `DISCORD_STATUS_SUMMARY_ROLE_IDS` | `/dune server summary` |
| `DISCORD_READINESS_ROLE_IDS` | `/dune server readiness` |
| `DISCORD_SERVICES_ROLE_IDS` | `/dune server services` |
| `DISCORD_POPULATION_ROLE_IDS` | `/dune data population` |
| `DISCORD_BACKUPS_ROLE_IDS` | `/dune data backups` |

**Example:**
```bash
DISCORD_RBAC_MODE=restricted
DISCORD_OBSERVER_ROLE_IDS=1100000000000000001
DISCORD_ADMIN_ROLE_IDS=1100000000000000002
DISCORD_ALLOWED_USER_IDS=2200000000000000001
```

---

## Adapter Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REQUEST_TIMEOUT_MS` | `8000` | Adapter request timeout in milliseconds |

### Route Overrides

You can override individual adapter route paths and methods:

| Variable | Default |
|----------|---------|
| `DUNE_ADAPTER_HEALTH_PATH` | `/api/integrations/discord/health` |
| `DUNE_ADAPTER_STATUS_PATH` | `/api/integrations/discord/status` |
| `DUNE_ADAPTER_READINESS_PATH` | `/api/integrations/discord/readiness` |
| `DUNE_ADAPTER_SERVICES_PATH` | `/api/integrations/discord/services` |
| `DUNE_ADAPTER_POPULATION_PATH` | `/api/integrations/discord/population` |
| `DUNE_ADAPTER_LOGS_PATH` | `/api/integrations/discord/logs` |
| `DUNE_ADAPTER_MAP_STATE_PATH` | `/api/integrations/discord/map-state` |
| `DUNE_ADAPTER_MAINTENANCE_PATH` | `/api/integrations/discord/maintenance` |
| `DUNE_ADAPTER_BACKUPS_PATH` | `/api/integrations/discord/backups/list` |
| `DUNE_ADAPTER_ANNOUNCEMENTS_PATH` | `/api/integrations/discord/announcements` |
| `DUNE_ADAPTER_BROADCAST_PATH` | `/api/integrations/discord/broadcast` |
| `DUNE_ADAPTER_VERSION_PATH` | `/api/integrations/discord/version` |
| `DUNE_ADAPTER_SERVERS_PATH` | `/api/integrations/discord/servers` |
| `DUNE_ADAPTER_PORTS_PATH` | `/api/integrations/discord/ports` |
| `DUNE_ADAPTER_DB_PATH` | `/api/integrations/discord/db` |
| `DUNE_ADAPTER_WRITE_EXECUTE_PATH` | `/api/integrations/discord/write/execute` |
| `DUNE_ADAPTER_WRITE_PREVIEW_PATH` | `/api/integrations/discord/write/preview` |
| `DUNE_ADAPTER_PLAYERS_LINK_PATH` | `/api/integrations/discord/players/link` |
| `DUNE_ADAPTER_PLAYERS_LINK_VERIFY_PATH` | `/api/integrations/discord/players/link/verify` |
| `DUNE_ADAPTER_PLAYERS_UNLINK_PATH` | `/api/integrations/discord/players/unlink` |
| `DUNE_ADAPTER_PLAYERS_ME_PATH` | `/api/integrations/discord/players/me` |
| `DUNE_ADAPTER_PLAYERS_ACCOUNTS_LIST_PATH` | `/api/integrations/discord/players/accounts/list` |
| `DUNE_ADAPTER_PLAYERS_ACCOUNTS_UNLINK_PATH` | `/api/integrations/discord/players/accounts/unlink` |
| `DUNE_ADAPTER_PLAYERS_ACCOUNTS_LINK_STEAM_PATH` | `/api/integrations/discord/players/accounts/link-steam` |
| `DUNE_ADAPTER_PLAYERS_FACTION_PATH` | `/api/integrations/discord/players/faction` |
| `DUNE_ADAPTER_PLAYERS_INVENTORY_PATH` | `/api/integrations/discord/players/inventory` |
| `DUNE_ADAPTER_PLAYERS_INVENTORY_SEARCH_PATH` | `/api/integrations/discord/players/inventory-search` |
| `DUNE_ADAPTER_PLAYERS_STORAGE_PATH` | `/api/integrations/discord/players/storage` |
| `DUNE_ADAPTER_PLAYERS_FIND_PATH` | `/api/integrations/discord/players/find` |
| `DUNE_ADAPTER_GUILD_STORAGE_PATH` | `/api/integrations/discord/guilds/storage` |
| `DUNE_ADAPTER_GUILD_FIND_PATH` | `/api/integrations/discord/guilds/find` |
| `DUNE_ADAPTER_OPS_ACTIVITY_PATH` | `/api/integrations/discord/ops/activity` |
| `DUNE_ADAPTER_OPS_COMBAT_PATH` | `/api/integrations/discord/ops/combat` |
| `DUNE_ADAPTER_OPS_RESOURCES_PATH` | `/api/integrations/discord/ops/resources` |
| `DUNE_ADAPTER_OPS_ECONOMY_PATH` | `/api/integrations/discord/ops/economy` |
| `DUNE_ADAPTER_OPS_INVENTORY_PATH` | `/api/integrations/discord/ops/inventory` |
| `DUNE_ADAPTER_OPS_LOCATION_PATH` | `/api/integrations/discord/ops/location` |
| `DUNE_ADAPTER_OPS_SOC_PATH` | `/api/integrations/discord/ops/soc` |
| `DUNE_ADAPTER_OPS_PROMETHEUS_PATH` | `/api/integrations/discord/ops/prometheus` |
| `DUNE_ADAPTER_OPS_DASHBOARD_PATH` | `/api/integrations/discord/ops/dashboard` |

Method overrides: `_PATH` → `_METHOD` (e.g., `DUNE_ADAPTER_HEALTH_METHOD=GET`).

---

## Scheduler Configuration

Controls scheduled status posts to Discord channels.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_POST_SCHEDULE_TYPE` | `none` | `none`, `status`, `status-summary`, `readiness`, `services` |
| `DUNE_POST_ALLOWED_CHANNELS` | *(empty)* | Comma-separated Discord channel IDs for scheduled posts |
| `DUNE_SCHEDULER_INTERVAL_MS` | `1800000` | Interval between posts in milliseconds (30 min default) |
| `DUNE_POST_RATE_LIMIT_MS` | `600000` | Minimum time between posts per channel (10 min default) |

**Example:**
```bash
DUNE_POST_SCHEDULE_TYPE=status-summary
DUNE_POST_ALLOWED_CHANNELS=3300000000000000001,3300000000000000002
DUNE_SCHEDULER_INTERVAL_MS=600000
```

---

## Announcement Bridge Configuration

Forwards in-game announcements to a Discord channel.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_ANNOUNCEMENTS_ENABLED` | `false` | Enable game→Discord announcement forwarding |
| `DUNE_ANNOUNCEMENTS_CHANNEL` | *(empty)* | Discord channel ID to post announcements |
| `DUNE_ANNOUNCEMENTS_POLL_MS` | `30000` | Poll interval in milliseconds |

---

## Player Features Configuration

Controls player inventory, storage, and character linking features.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_DISCORD_ADAPTER_ENABLED` | *(inherited from console)* | Must be `true` on the console side for player features to work |
| `ACP_STEAM_LINK_PORT` | `3101` | Port the Steam-link OAuth callback server binds (self-hosted on R740 dune-prod VM) |
| `ACP_STEAM_LINK_BASE_URL` | `ACP_BASE_URL` or `http://localhost:3101` | Public base URL used in OAuth `redirect_uri`; must match Discord's registered redirect and be reachable by players' browsers |

**Note:** The Steam-link callback server is always started (it is cheap to
run idle and its `/health` route is useful), but the "Link via Steam"
button is only offered when a Discord OAuth client secret is configured
(`DISCORD_CLIENT_SECRET` in multi-tenant mode). Self-hosted operators
reaching the Steam-link flow over the internet must expose `ACP_STEAM_LINK_PORT`
and set `ACP_STEAM_LINK_BASE_URL` to a public URL Discord will redirect to.

**Note:** Player features require no additional bot configuration. They work
automatically once the bot is connected to a console with the Discord adapter
enabled. Players run `/dune player link <character-name>` to link their
Discord account to their in-game character (the character name is
required); what happens next is decided automatically by the bot:

1. If the named character has no Steam account on file, a verification
   code is sent in-game via whisper (RabbitMQ `chat.whispers`) — use
   `/dune player verify <code>` to complete the link.
2. If the named character already has a Steam account on file, the bot
   instead shows a "Link via Steam" button — completing Discord's OAuth
   consent screen links the character instantly if the connected Steam
   account matches, or automatically falls back to sending the whisper
   code if it doesn't.

**Correction (2026-07-24):** this section previously also documented a
"Discord has a verified Steam connection, linking completes instantly" step
as already-working; that capability did not exist in the code at the time
this was originally written (verified against the commit history — see the
CHANGELOG.md correction for the same claim). It has since actually been
designed and implemented, per the corrected mechanics above — see
`docs/steam-link-design.md` for the full design (including a mid-development
revision correcting an initial draft where the character argument was
optional). Command paths below are also updated from the pre-restructure
`/dune data *` group to the current `/dune player *` group (see
`docs/steam-link-design.md`'s "Scope Addition" section for that rename's
rationale).

Once linked, players can use:

- `/dune player link <character>` — Link Discord to in-game character (bot picks whisper or Steam automatically)
- `/dune player verify <code>` — Complete linking with verification code (whisper path only)
- `/dune player unlink` — Remove character link
- `/dune player whoami` — Show linked character info
- `/dune player faction <name>` — Set faction for themed embeds (atreides, harkonnen, fremen)
- `/dune player inventory` — View character inventory
- `/dune player inventory <search>` — Search items in inventory
- `/dune player storage` — View storage containers (owned scope)
- `/dune player storage <scope>` — View storage (owned, guild, or all)
- `/dune player find <item>` — Search items in storage

### Player Feature Capabilities

Player links are stored on the console (Core) side, not in this bot's own
database. **Correction (2026-07-24):** the exact table name in the "origin/main"
side of this conflict (`dune.discord_player_links`) was already stale even
before this conflict was resolved — the current schema (see
`docs/steam-link-design.md`'s "Why No New Core Schema Is Needed" section) is
`console.discord_account_links` (FINDING-LINK-6), which supports multiple
characters per Discord user; the single-link `console.discord_player_links`
table this doc originally referenced is the older, superseded schema. Note
this bot's own `src/database.js` does define a `player_links` SQLite table
with `upsertPlayerLink()`/`getPlayerLink()`/`deletePlayerLink()` functions,
but as of this correction none of those functions are called anywhere in
`src/commands.js` or `src/index.js` — all `player:*` commands route through
`adapterClient` (HTTP calls to Core) instead. That bot-side table appears to
be unused/dead schema, not a second source of truth.

| Capability | Required Role | Commands |
|-----------|---------------|----------|
| `inventory:read` | Observer or Admin | `/dune player link`, `/dune player unlink`, `/dune player whoami`, `/dune player faction`, `/dune player inventory`, `/dune player find` |
| `storage:read` | Observer or Admin | `/dune player storage` (owned scope) |
| `guild:read` | Observer or Admin | `/dune player storage` (guild scope), `/dune player find` (guild scope) |

---

## Write Command Configuration (R2+)

All write commands are disabled by default. Requires upstream write-contract
approval before enabling in production.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_DISCORD_WRITES_ENABLED` | `false` | Master switch for all write-capable commands |
| `DISCORD_WRITE_ADMIN_ROLE_IDS` | *(empty)* | Roles allowed to execute write operations |
| `DISCORD_WRITE_OWNER_ROLE_IDS` | *(empty)* | Roles allowed to execute high-risk writes |

**Broadcast cooldown:** 60 seconds per user (not configurable in v1).

---

## Cooldown Configuration

Prevents command spam.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_COOLDOWN_MS` | `5000` | Per-user per-command cooldown in milliseconds |
| `DUNE_ADMIN_COOLDOWN_MS` | `1000` | Cooldown for admin roles (shorter) |

---

## Health State

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_BOT_HEALTH_STATE_FILE` | `/tmp/dune-discord-bot/health.json` | Health state output path |
| `DUNE_BOT_HEALTH_MAX_AGE_MS` | `120000` | Maximum staleness before healthcheck fails |

---

## Multi-Tenant Configuration (v1.6+)

When `ACP_MULTI_TENANT=true`, the bot runs as a centralized service serving multiple Discord servers. Each guild connects to its own Dune console, with configuration stored in a local SQLite database.

| Variable | Default | Description |
|----------|---------|-------------|
| `ACP_MULTI_TENANT` | `false` | Enable multi-tenant mode |
| `ACP_DB_PATH` | `data/acp.db` | Path to SQLite database file |
| `ACP_BASE_URL` | `http://localhost:3100` | Base URL for the setup web portal |
| `ACP_SETUP_PORT` | `3100` | Port for the setup web portal |
| `ACP_OAUTH_REDIRECT_URI` | *(auto)* | Discord OAuth2 callback URL |
| `DISCORD_CLIENT_SECRET` | *(required)* | Discord OAuth2 client secret (from Developer Portal → OAuth2) |

In multi-tenant mode:
- `DUNE_CONSOLE_API_URL` and `DUNE_DISCORD_ADAPTER_TOKEN` are optional placeholders
- RBAC is configured per-guild via the web portal or DM onboarding
- Guild configuration is stored in SQLite (`data/acp.db`)
- The setup portal runs at `http://localhost:3100/setup`

### Setup Portal Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /setup` | OAuth2 login page |
| `GET /oauth/callback` | Discord OAuth2 callback |
| `POST /setup/register` | Guild registration API |
| `GET /health` | Setup server health check |

### Database Schema

The bot manages these tables:
- `guilds` — Per-guild console URL, adapter token, status
- `guild_roles` — Per-guild observer/admin role IDs
- `guild_settings` — Per-guild RBAC mode, cooldowns, schedule
- `oauth_sessions` — OAuth2 state and tokens
- `player_links` — Per-guild Discord-to-character mappings

---

## Feature Flag Summary

| Feature | Env Var | Default |
|---------|---------|---------|
| Read-only commands | (always on) | N/A |
| Player inventory/storage | (always on when adapter enabled) | N/A |
| Player faction | (always on when adapter enabled) | N/A |
| OPS commands | (always on, returns planned data) | N/A |
| Infra commands | (always on) | N/A |
| Scheduled status posts | `DUNE_POST_SCHEDULE_TYPE` | `none` |
| Announcement bridge | `DUNE_ANNOUNCEMENTS_ENABLED` | `false` |
| Write commands | `DUNE_DISCORD_WRITES_ENABLED` | `false` |
| Broadcast command | `DUNE_DISCORD_WRITES_ENABLED` | `false` |
| Multi-tenant mode | `ACP_MULTI_TENANT` | `false` |

---

## Discord Role Setup

After inviting the bot, create these roles in your Discord server:

1. **Dune Observer** — Can use all read-only commands including player features
2. **Dune Admin** — Read-only + all admin commands
3. **Dune Write Admin** — Can execute write commands (when enabled)
4. **Dune Write Owner** — Full access including high-risk operations (future)

Configure the role IDs in your `.env`:
```bash
DISCORD_OBSERVER_ROLE_IDS=ROLE_ID_1
DISCORD_ADMIN_ROLE_IDS=ROLE_ID_2
DISCORD_WRITE_ADMIN_ROLE_IDS=ROLE_ID_2
DISCORD_WRITE_OWNER_ROLE_IDS=ROLE_ID_3
```

### How to Find a Role ID

1. Enable **Developer Mode** in Discord (User Settings > Advanced > Developer Mode)
2. Right-click a role in Server Settings > Roles
3. Click **Copy Role ID**

### How to Find a Channel ID

1. Enable Developer Mode
2. Right-click a channel name
3. Click **Copy Channel ID**

---

## .env.example Template

```bash
# === Required ===
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DUNE_CONSOLE_API_URL=http://localhost:3000
DUNE_DISCORD_ADAPTER_TOKEN=

# === Role Access ===
DISCORD_RBAC_MODE=restricted
DISCORD_OBSERVER_ROLE_IDS=
DISCORD_ADMIN_ROLE_IDS=
DISCORD_ALLOWED_USER_IDS=

# === Dev Registration ===
# DISCORD_GUILD_ID=

# === Scheduler ===
DUNE_POST_SCHEDULE_TYPE=none
# DUNE_POST_ALLOWED_CHANNELS=

# === Announcements ===
# DUNE_ANNOUNCEMENTS_ENABLED=true
# DUNE_ANNOUNCEMENTS_CHANNEL=

# === Writes (disabled by default) ===
# DUNE_DISCORD_WRITES_ENABLED=true
# DISCORD_WRITE_ADMIN_ROLE_IDS=

# === Multi-Tenant (optional) ===
# ACP_MULTI_TENANT=false
# ACP_DB_PATH=data/acp.db
# ACP_BASE_URL=http://localhost:3100
# DISCORD_CLIENT_SECRET=
```
