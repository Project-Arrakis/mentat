# RW Command Design — Discord Bot Write Operations

**Date:** 2026-08-08
**Status:** Layer 1 Design Audit (Requirement 20)

## Scope

Design read-write slash commands for the Arrakis Control Panel Discord bot,
mapped to existing Core console write endpoints. All commands are gated
behind `DUNE_DISCORD_WRITES_ENABLED=1` (already implemented, #214).

## Groups

### Group 1: `player` — Player Management

| Subcommand | Core Endpoint | IAM Action | Tier | Description |
|------------|--------------|------------|------|-------------|
| `kick <name>` | `POST /api/players/:id/kick` | `players:mutate` | admin | Kicks a player from the server (online only) |
| `kick-all` | `POST /api/players/kick-all-online` | `players:kick-all` | admin | Kicks all online players (with confirmation) |
| `ban <name> [reason]` | `POST /api/players/:id/ban` | `players:mutate` | admin | Bans a player with optional reason |
| `unban <name>` | `POST /api/players/:id/unban` | `players:mutate` | admin | Removes a player ban |
| `warn <name> <message>` | `POST /api/admin/map-chat` | `admin:map-chat` | moderator | Sends a private warning via map chat |
| `give-item <player> <item> [qty]` | `POST /api/storage/:id/give-item` | `storage:mutate` | admin | Give an item to a player's inventory |
| `fill-water <player>` | `POST /api/storage/:id/fill-water` | `storage:mutate` | admin | Fill a player's water containers |
| `clear-backpack <player>` | `DELETE /api/players/:id/inventory` | `players:mutate` | owner | Clear a player's entire inventory (destructive) |

**Safety**: `kick-all`, `ban`, `clear-backpack` require confirmation via Discord button or secondary `/dune player ban confirm <id>`. Cooldown: 5s between player mutations.

### Group 2: `base` — Base Management

| Subcommand | Core Endpoint | IAM Action | Tier | Description |
|------------|--------------|------------|------|-------------|
| `refill generators <base>` | `POST /api/bases/:id/refill-generators` | `bases:mutate` | admin | Refill all generator fuel on a base |
| `refill water <base>` | `POST /api/bases/:id/refill-water` | `bases:mutate` | admin | Refill all water containers on a base |
| `destroy <base> [reason]` | `DELETE /api/bases/:id` | `bases:mutate` | owner | Destroy a base (requires confirmation) |
| `list` | `GET /api/bases` | `bases:read` | moderator | List all bases (RO — already exists) |

**Safety**: `destroy` requires explicit `/dune base destroy confirm <base> <reason>`. Cooldown: 10s between base mutations.

### Group 3: `server` — Server Control

| Subcommand | Core Endpoint | IAM Action | Tier | Description |
|------------|--------------|------------|------|-------------|
| `restart` | `POST /api/server/restart` | `server:restart` | admin | Restart the entire battlegroup (confirmation required) |
| `stop` | `POST /api/server/stop` | `server:stop` | owner | Stop all server services (confirmation required) |
| `start` | `POST /api/server/start` | `server:start` | admin | Start the battlegroup (if stopped) |
| `restart-service <name>` | `POST /api/server/restart-service` | `server:restart-service` | admin | Restart a specific service (e.g., overmap, survival_1) |
| `maintenance on/off` | `POST /api/server/shutdown-protection` | `server:write-config` | admin | Enable/disable shutdown protection (maintenance mode) |

**Safety**: `restart` and `stop` require explicit confirmation with countdown warning (e.g., "Server will restart in 30s. All players will be disconnected."). Live player count is displayed before confirmation. Cooldown: 60s between restarts.

### Group 4: `map` — Map Control

| Subcommand | Core Endpoint | IAM Action | Tier | Description |
|------------|--------------|------------|------|-------------|
| `spawn <preset>` | `POST /api/maps/spawn` | `maps:spawn` | admin | Start a new map instance |
| `despawn <map>` | `POST /api/maps/despawn` | `maps:despawn` | admin | Stop a map instance |
| `respawn <map>` | `POST /api/maps/respawn` | `maps:restart` | admin | Restart a map |
| `reconcile <map>` | `POST /api/maps/reconcile` | `maps:reconcile` | admin | Reconcile a map's configuration |
| `teleport <player> <map>` | `POST /api/map/teleport-player` | `maps:teleport` | admin | Teleport a player to a different map |

**Safety**: `despawn` warns about connected players. `teleport` validates the target map is running.

### Group 5: `carepackage` — Care Packages

| Subcommand | Core Endpoint | IAM Action | Tier | Description |
|------------|--------------|------------|------|-------------|
| `grant <player> <tier>` | `POST /api/care-package/grant` | `carepackage:grant` | admin | Grant a care package to a player |
| `grant-all` | `POST /api/care-package/grant-eligible` | `carepackage:grant` | admin | Grant to all eligible players (confirmation) |
| `enable` | `POST /api/care-package/enable` | `carepackage:write-config` | admin | Enable auto-grant for eligible players |
| `disable` | `POST /api/care-package/disable` | `carepackage:write-config` | admin | Disable auto-grant |
| `scan` | `POST /api/care-package/run` | `carepackage:scan` | admin | Run an eligibility scan |
| `history clear` | `POST /api/care-package/history/clear` | `carepackage:clear-history` | admin | Clear care package grant history |

**Safety**: `grant-all` requires confirmation showing count of eligible players.

### Group 6: `broadcast` — Server Broadcasts (already enabled, #214)

| Subcommand | Core Endpoint | IAM Action | Tier | Description |
|------------|--------------|------------|------|-------------|
| `broadcast <msg>` | `POST /api/admin/broadcast` | `admin:broadcast` | admin | Send a server-wide message |
| `broadcast-shutdown <msg> [minutes]` | `POST /api/admin/broadcast-shutdown` | `admin:broadcast-shutdown` | admin | Broadcast a shutdown warning |

### Group 7: `guild` — Guild Management

| Subcommand | Core Endpoint | IAM Action | Tier | Description |
|------------|--------------|------------|------|-------------|
| `create <name>` | `POST /api/guilds` | `guilds:mutate` | admin | Create a new guild |
| `delete <name>` | `DELETE /api/guilds/:id` | `guilds:mutate` | owner | Delete a guild (confirmation) |
| `add <player> <guild>` | `POST /api/guilds/:id/members` | `guilds:mutate` | admin | Add a player to a guild |
| `remove <player>` | `DELETE /api/guilds/:id/members` | `guilds:mutate` | admin | Remove a player from their guild |
| `rename <guild> <name>` | `PUT /api/guilds/:id` | `guilds:mutate` | admin | Rename a guild |

## Capability Model

Discord role → console capability tier mapping (existing, reused):

| Discord Role | Console Tier | RW Commands Accessible |
|-------------|-------------|----------------------|
| observer | observer | None (RO only) |
| moderator | moderator | `player:warn` (map chat only) |
| admin | admin | Most RW commands (player kick/ban, base refill, server restart, carepackage grant, map control, guild management) |
| owner | owner | All RW commands including destructive (base destroy, guild delete, clear-backpack, server stop) |

## Safety Design

1. **Confirmation flow**: Destructive commands (`restart`, `stop`, `destroy`, `delete`, `clear-backpack`, `kick-all`, `grant-all`) require a confirmation step via Discord interaction button or follow-up slash command.

2. **Cooldown enforcement**: Per-command-group cooldowns prevent spam:
   - player mutations: 5s
   - base mutations: 10s
   - server restarts: 60s
   - map mutations: 15s

3. **Live data before destructive ops**: `server restart` and `server stop` display current player count and uptime before the confirmation prompt. `map despawn` shows connected players.

4. **Audit trail**: All RW commands log to the bot's audit channel with actor, command, target, result, and timestamp. Core-side audit events already exist for all write endpoints.

5. **Actor signing**: All RW commands require `DUNE_DISCORD_ACTOR_SECRET` to be configured (already enforced for mutation routes, #207).

## Files

| File | Description |
|------|-------------|
| `src/commands.js` | Command registration + dispatch (extend with RW groups) |
| `src/rwCommands.js` | NEW — RW command handlers (confirmation, cooldown, validation) |
| `src/adapterClient.js` | API client (add write endpoint methods) |
| `src/rbac.js` | RBAC tier ladder (add RW capability mappings) |
| Console: `routes.js` | Core adapter route handlers (actor validation already present) |

## Not in scope (intentionally excluded)

- `database:export` / `database:query` — raw SQL access from Discord is too dangerous
- `updates:apply` — update management requires console UI visibility (downtime, rollback)
- `setup:*` / `settings:*` — console setup/config is admin-UI-only by design
- `landsraad:*` — Landsraad is experimental and requires console UI context
- `sietches:write` / `deepdesert:write` — low-use admin functions, defer
- `addons:install/uninstall` — addon management requires console UI
