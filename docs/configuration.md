# Configuration Reference

Every environment variable, role mapping, and feature flag for the Dune Discord Bot.

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
| `DISCORD_HEALTH_ROLE_IDS` | `/dune health` |
| `DISCORD_ABOUT_ROLE_IDS` | `/dune about` |
| `DISCORD_PING_ROLE_IDS` | `/dune ping` |
| `DISCORD_STATUS_ROLE_IDS` | `/dune status` |
| `DISCORD_STATUS_SUMMARY_ROLE_IDS` | `/dune status-summary` |
| `DISCORD_READINESS_ROLE_IDS` | `/dune readiness` |
| `DISCORD_SERVICES_ROLE_IDS` | `/dune services` |
| `DISCORD_POPULATION_ROLE_IDS` | `/dune population` |
| `DISCORD_BACKUPS_ROLE_IDS` | `/dune backups` |

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
| `DUNE_ADAPTER_BACKUPS_PATH` | `/api/integrations/discord/backups/list` |
| `DUNE_ADAPTER_ANNOUNCEMENTS_PATH` | `/api/integrations/discord/announcements` |
| `DUNE_ADAPTER_BROADCAST_PATH` | `/api/integrations/discord/broadcast` |

Method overrides: `_PATH` → `_METHOD` (e.g., `DUNE_ADAPTER_HEALTH_METHOD=GET`).

---

## Scheduler Configuration

Controls scheduled status posts to Discord channels.

| Variable | Default | Description |
|----------|---------|-------------|
| `DUNE_POST_SCHEDULE_TYPE` | `none` | `none`, `status`, `status-summary`, `readiness`, `services` |
| `DUNE_POST_ALLOWED_CHANNELS` | *(empty)* | Comma-separated Discord channel IDs for scheduled posts |
| `DUNE_SCHEDULER_INTERVAL_MS` | `1800000) |
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

## Feature Flag Summary

| Feature | Env Var | Default |
|---------|---------|---------|
| Read-only commands | (always on) | N/A |
| Scheduled status posts | `DUNE_POST_SCHEDULE_TYPE` | `none` |
| Announcement bridge | `DUNE_ANNOUNCEMENTS_ENABLED` | `false` |
| Write commands | `DUNE_DISCORD_WRITES_ENABLED` | `false` |
| Broadcast command | `DUNE_DISCORD_WRITES_ENABLED` | `false` |

---

## Discord Role Setup (In-App)

After inviting the bot, create these roles in your Discord server:

1. **Dune Observer** — Can use all read-only commands
2. **Dune Moderator** — Read-only + broadcast capability
3. **Dune Admin** — Read-only + all write operations
4. **Dune Owner** — Full access including high-risk operations

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
```
