# Multi-Tenant Architecture Design

## Overview

Transition from self-hosted single-tenant bot to a centrally-hosted multi-tenant
service. One bot instance serves many Discord servers, each connected to
its own Dune Awakening console. (The multi-tenant *software* architecture
below shipped 2026-08-07. The *hosting location* itself has since moved
too, but NOT to the R740 `dune-prod` VM this section originally
planned — per `r740-dune-deployment-kit#93`'s decision record,
co-locating the bot with the live game server was rejected as a
blast-radius risk; the bot instead migrated 2026-08-17 to its own
dedicated Proxmox VM on an isolated "Services" VLAN. See
`compliance/runbooks/backup-recovery.md` for the current, real hosting
state. The diagram below is now accurate to that real state, not a
future plan.)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│    Single hosted instance (dedicated "acp-bot" VM, VLAN 22) │
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
| Deployment | Per-user Docker/Node | Single hosted instance (dedicated self-hosted Proxmox VM, not OCI) |
| Config | `.env` file | SQLite database |
| Auth | Bot token + adapter token | Discord OAuth2 + per-guild adapter tokens |
| RBAC | Global role IDs in `.env` | Per-guild role configuration |
| Player Links | Console database | Console database (unchanged, per-guild via adapter) |
| Setup | Manual `.env` editing | In-console OAuth registration (primary, added 2026-09) or web portal (fallback) — the original DM wizard was removed the same time the in-console flow shipped, see Onboarding Flow below |

**Player Links stays in each operator's own console database, by design,
in both self-hosted and multi-tenant mode.** This is a deliberate,
permanent decision, not a transitional state: player-linking data
(character names, controller IDs, Steam/Discord identity mappings) is
player-owned data belonging to a specific operator's Dune Awakening
server, not metadata about the bot's own operation. Centralizing it in
the hosted bot's shared database would mean every connected operator's
players' identity-linking data lives in one file this bot host controls
-- a materially larger trust/privacy concern than centralizing adapter
routing config (console_url, adapter_token), which is what this
document's multi-tenant design actually centralizes. The bot's own
`player_links` table (see Database Schema below) predates this decision,
was never wired into any command path, and is scheduled for removal --
see the Migration Path section below; it must not be revived.

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

### player_links (deprecated, unused -- scheduled for removal)

This table exists in the schema but is **not used by any code path**.
No command handler, provider, or route in this codebase calls
`getPlayerLink()`, `upsertPlayerLink()`, or `deletePlayerLink()` --
confirmed by searching every caller in `src/`. It predates the decision
recorded above (Player Links stays in each operator's own console
database) and must not be wired up or revived. Linking is implemented
entirely via `adapterClient.js`'s `playerLink`/`playerLinkStart`/
`playerLinkVerify`/`playerUnlink*` methods, which call through to each
guild's own Core adapter API (see docs/rw-adapter-contract.md), backed
by `console.discord_player_links`/`console.discord_account_links` in
that operator's own Postgres.

## Onboarding Flow

**Current state (2026-09):** the primary registration path is now
**in-console** — the operator's Dune Docker Console (Settings → Discord
Bot → "Connect to hosted bot") performs a Discord OAuth round-trip itself
and calls this bot's `POST /api/consoles/register` directly, forwarding the
Discord access token, the chosen `guildId`, and the console's own
`consoleUrl`/`adapterToken`. `verifyAndRegisterConsole()`
(`src/consoleRegistration.js`) independently re-verifies guild ownership
against Discord's own API before registering — it never trusts the
submitted `guildId` on its own. No DM is sent at any point in this flow.
The manual web portal (old Step 4 below) remains as a fallback for
consoles without that button yet. **Steps 2-3 below (bot-initiated DM
onboarding) describe a flow that has been fully removed** (mentat#316,
2026-09) — `onboarding.js`'s `findInviter()`/`handleGuildCreate()` and
every helper that existed only to support them are gone; kept here for
historical reference only. A command run today in a guild with no
registered, active console instead gets an in-guild reply explaining the
server isn't connected yet (with `/dune core setup` specifically exempted,
since it already returns its own setup-portal link and needs to work even
in an unregistered guild).

### Step 1: User Invites Bot

User clicks OAuth2 invite link:
```
https://discord.com/oauth2/authorize?client_id=BOT_ID&scope=bot%20applications.commands&permissions=128
```

`permissions=128` (View Audit Log) is a historical holdover from the now-
removed inviter-DM lookup below (Step 3) — it has no remaining functional
use. `permissions=0` works identically today; see `discord-setup.md` for
the current status.

### Step 2 (REMOVED, historical only): Bot Detects New Guild

Bot received a `guildCreate` event and checked if the guild was
registered — if not, it sent a DM with a setup link. This event handler no
longer exists; joining a guild today is a no-op (only a log line).

### Step 3 (REMOVED, historical only): DM Setup Wizard

Original implementation (onboarding.js, 2026-07-27): Discord's bot-invite
OAuth flow only requires "Manage Server" permission, not guild
ownership, so the person who actually invites the bot is often NOT the
guild owner. If the bot had View Audit Log permission, it looked up the
real inviter from the guild's BOT_ADD audit log entry and DMed them the
full setup instructions below; the owner instead got a short notice
naming who invited the bot (not a duplicate setup DM), unless the owner
WAS the inviter, in which case only one DM was sent. Without View Audit
Log permission (or if the lookup failed for any reason), this fell back
to the original behavior: DM the guild owner directly.

This entire mechanism — `findInviter()`, the DM copy helpers, and the
`guildCreate` listener that triggered them — was removed in full
(mentat#316, 2026-09). Former setup DM content, for history only:
```
Welcome to ACP! To get started, click the link below to configure
your server's connection to your Dune Awakening console.

Setup Link: https://acp.example.com/setup?state=XYZ
```

### Step 4: Web Portal (OAuth2) — fallback

User opens the portal directly (not via a DM link, since none is sent
anymore) → Discord OAuth2 → web portal:
1. Authenticate with Discord
2. Select which server to configure (if user is in multiple)
3. Enter console URL
4. Enter adapter token
5. Configure roles (paste role IDs or select from dropdown)
6. Submit → saved to database

See `setup-portal-guide.md` for the current, real walkthrough of this
fallback path.

### Step 5: Confirmation

Neither the in-console flow nor the web portal sends a confirmation DM.
Success is shown directly in whichever UI initiated the request: the
console's own "Connected" state for the in-console flow, or the portal's
"Setup Complete" page for the web-portal fallback. Once connected, try:
```
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

### Phase 4: DM Onboarding (implemented 2026-07-27, fully removed 2026-09, mentat#316)
- `guildCreate` event handler
- DM wizard with setup link
- Status notifications

This phase shipped, then was removed in full once the in-console OAuth
registration flow (see Onboarding Flow above) replaced its purpose. A
command run in an unregistered guild now gets an in-guild reply instead of
relying on a DM ever having been sent; `/dune core setup` is exempted from
that gate so it still returns its setup-portal link even in an
unregistered guild.

### Phase 5: Player Links Migration (superseded -- will not be done)
This phase originally planned to move player links from the console
database to the bot database. That direction was reversed: player-linking
data stays in each operator's own console database permanently -- see
the Player Links row and note under Key Changes above. The bot-side
`player_links` table this phase would have used already exists in the
schema but was never wired into any command path; it is dead code
scheduled for removal, not a partially-completed migration. No further
work under this phase should be planned.

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
