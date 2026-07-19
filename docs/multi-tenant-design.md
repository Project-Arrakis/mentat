# Multi-Tenant Architecture Design

## Overview

Transition from self-hosted single-tenant bot to a centrally-hosted multi-tenant
service on OCI. One bot instance serves many Discord servers, each connected to
its own Dune Awakening console.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OCI Instance                          │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Discord Bot │  │  Web Portal  │  │   SQLite DB   │  │
│  │  (Node.js)   │  │  (Express)   │  │  (better-sqlite3)│
│  └──────┬───────┘  └──────┬───────┘  └───────┬───────┘  │
│         │                 │                   │          │
│         └────────┬────────┴───────────────────┘          │
│                  │                                       │
└──────────────────┼───────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
   ┌────▼────┐ ┌───▼────┐ ┌──▼──────┐
   │ Guild A │ │ Guild B│ │ Guild C │
   │ Console │ │ Console│ │ Console │
   │ URL +   │ │ URL +  │ │ URL +   │
   │ Token   │ │ Token  │ │ Token   │
   └─────────┘ └────────┘ └─────────┘
```

## Key Changes

| Aspect | Before (Self-Hosted) | After (Multi-Tenant) |
|--------|---------------------|---------------------|
| Deployment | Per-user Docker/Node | Single OCI instance |
| Config | `.env` file | SQLite database |
| Auth | Bot token + adapter token | Discord OAuth2 + per-guild adapter tokens |
| RBAC | Global role IDs in `.env` | Per-guild role configuration |
| Player Links | Console database | Bot database (guild-scoped) |
| Setup | Manual `.env` editing | DM wizard + web portal |

## Database Schema

### guilds

Stores registered Discord servers and their console connections.

| Column | Type | Description |
|--------|------|-------------|
| `guild_id` | TEXT PRIMARY KEY | Discord server ID |
| `guild_name` | TEXT | Server name (cached) |
| `console_url` | TEXT | Dune console API URL |
| `adapter_token` | TEXT | Adapter bearer token (encrypted) |
| `status` | TEXT | `pending`, `active`, `suspended` |
| `created_at` | TEXT | ISO 8601 timestamp |
| `updated_at` | TEXT | ISO 8601 timestamp |

### guild_roles

Per-guild RBAC configuration.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `guild_id` | TEXT | FK → guilds.guild_id |
| `role_type` | TEXT | `observer`, `admin`, `owner`, `moderator` |
| `role_id` | TEXT | Discord role ID |
| UNIQUE(guild_id, role_type, role_id) | | |

### guild_settings

Per-guild feature flags and preferences.

| Column | Type | Description |
|--------|------|-------------|
| `guild_id` | TEXT PRIMARY KEY | FK → guilds.guild_id |
| `rbac_mode` | TEXT | `restricted` (default) or `open` |
| `default_ephemeral` | INTEGER | 1 = true, 0 = false |
| `schedule_type` | TEXT | `none`, `status`, `status-summary`, etc. |
| `schedule_channel` | TEXT | Discord channel ID for scheduled posts |
| `schedule_interval_ms` | INTEGER | Milliseconds between posts |
| `announcements_enabled` | INTEGER | 1 = enabled |
| `announcements_channel` | TEXT | Discord channel ID |
| `cooldown_ms` | INTEGER | Per-user command cooldown |
| `admin_cooldown_ms` | INTEGER | Admin cooldown |

### oauth_sessions

Discord OAuth2 state for setup flow.

| Column | Type | Description |
|--------|------|-------------|
| `state` | TEXT PRIMARY KEY | OAuth2 state parameter |
| `discord_user_id` | TEXT | Discord user ID |
| `discord_username` | TEXT | Discord username |
| `guild_id` | TEXT | Target guild ID (optional) |
| `access_token` | TEXT | Discord OAuth2 access token |
| `expires_at` | TEXT | Token expiry |
| `created_at` | TEXT | ISO 8601 timestamp |

### player_links

Per-guild character linking (replaces console-side linking).

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PRIMARY KEY | Auto-increment |
| `guild_id` | TEXT | FK → guilds.guild_id |
| `discord_user_id` | TEXT | Discord user ID |
| `character_name` | TEXT | In-game character name |
| `player_controller_id` | TEXT | Game server player ID |
| `player_pawn_id` | TEXT | Game server pawn ID |
| `linked_at` | TEXT | ISO 8601 timestamp |
| UNIQUE(guild_id, discord_user_id) | | |

## Onboarding Flow

### Step 1: User Invites Bot

User clicks OAuth2 invite link:
```
https://discord.com/oauth2/authorize?client_id=BOT_ID&scope=bot%20applications.commands
```

### Step 2: Bot Detects New Guild

Bot receives `guildCreate` event, checks if guild is registered:
- If registered → commands work immediately
- If not registered → send DM with setup link

### Step 3: DM Setup Wizard

Bot sends DM to guild owner/admin:
```
Welcome to Thumper! To get started, click the link below to configure
your server's connection to your Dune Awakening console.

Setup Link: https://thumper.example.com/setup?state=XYZ
```

### Step 4: Web Portal (OAuth2)

User clicks link → Discord OAuth2 → web portal:
1. Authenticate with Discord
2. Select which server to configure (if user is in multiple)
3. Enter console URL
4. Enter adapter token
5. Configure roles (paste role IDs or select from dropdown)
6. Submit → saved to database

### Step 5: Confirmation

Bot sends confirmation DM:
```
Your server "Tabr-Tau" is now connected! You can use:
/dune server status
/dune data population
/dune player link <character>

Run /dune core help for all commands.
```

## Migration Path

### Phase 1: Database Layer
- Add `better-sqlite3` dependency
- Create database schema and migrations
- Add guild config lookup layer

### Phase 2: Multi-Tenant Adapter Client
- Modify `adapterClient.js` to accept guild-scoped config
- Look up console URL + token by guild ID
- Fallback to `.env` for self-hosted mode

### Phase 3: OAuth2 + Web Portal
- Add Express web server
- Discord OAuth2 flow
- Setup form with validation
- Guild registration API

### Phase 4: DM Onboarding
- `guildCreate` event handler
- DM wizard with setup link
- Status notifications

### Phase 5: Player Links Migration
- Move player links from console DB to bot DB
- Guild-scoped linking
- Update all player commands

### Phase 6: RBAC Migration
- Move role config from `.env` to database
- Per-guild role management
- Admin commands for role config

## Security Considerations

- Adapter tokens encrypted at rest (AES-256-GCM)
- OAuth2 state parameter prevents CSRF
- Guild-scoped data isolation (no cross-guild data leakage)
- Rate limiting per guild
- Audit logging for all config changes

## Backward Compatibility

- `.env` config still works for self-hosted deployments
- If no guild config found, fallback to `.env`
- Migration script to import `.env` config as initial guild
