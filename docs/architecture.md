# Design and Architecture

**Last verified against commit:** (set at commit time below) — see `scripts/check-architecture-doc-drift.js` for the mechanical check that keeps this current.

## Overview

The Discord bot lives in its own repository so the Dune console remains the
safety boundary. It uses Discord slash commands to ask the console adapter
for data and, for a bounded set of operational actions, to perform writes.
**"Version 1 is read-only" (this doc's own prior claim) is no longer true** —
see Write Capabilities below. The bot does not need Docker socket access,
database credentials, shell access, or mounted game files. It only needs the
bearer-token protected adapter API.

## Known Past Confusion — read this first

**This exact question has recurred across multiple sessions: "does Mentat
connect directly to the game's Postgres database?" The answer is, and has
always architecturally been, NO.**

Verified directly, this session: `package.json`'s `dependencies` are
`better-sqlite3`, `discord.js`, `express`, `qrcode`, `shamirs-secret-sharing`
— no `pg`, no `node-postgres`, no Postgres driver of any kind. Mentat's own
local database (`src/database.js`, SQLite via `better-sqlite3`) stores only
bot/Discord state — `guilds`, `guild_roles`, `guild_settings`, `key_versions`,
`secret_keys`, `secret_access_log`, `oauth_sessions`, `player_links`,
`guild_member_activity`, `bot_stats`, `stats_snapshot`,
`guild_stats_snapshot`. It never stores game data.

The real, only path to the game database is: **Mentat → `adapterClient.js`
(HTTP, `Authorization: Bearer <token>`, see `adapterClient.js:405`) → Core's
console adapter API (`dune-awakening-selfhost-docker`'s `routes.js`) →
`duneDb.js` → Postgres.** Postgres itself runs in the `dune-postgres`
container on dune-prod, bound to `127.0.0.1`-only — structurally unreachable
from Mentat's host (the separate acp-bot VM) even if someone wanted a direct
connection. There is exactly one path, not a choice between paths: everything
new must extend the adapter route pattern below, never invent a direct DB
connection.

## Runtime Flow

1. A Discord user runs a slash command.
2. The bot checks RBAC (`src/rbac.js`) — see Role Tiers below.
3. The bot sends a bearer-token authenticated request to the configured
   console adapter endpoint via `adapterClient.js`.
4. The console adapter (`dune-awakening-selfhost-docker`) queries Postgres
   via `duneDb.js` and returns JSON.
5. The bot redacts credential-shaped keys (`src/format.js`'s
   `redactSecrets()`, used in `commands.js` and `announcements.js`), bounds
   the Discord message length, and posts the response.

```mermaid
flowchart LR
  User["Discord user"] --> Bot["Discord bot runtime"]
  Bot --> Guard["rbac.js tier check"]
  Guard --> Client["adapterClient.js (Bearer token)"]
  Client --> Adapter["Core console adapter API"]
  Adapter --> DuneDb["duneDb.js"]
  DuneDb --> PG["Postgres (dune-postgres container, 127.0.0.1-only)"]
  Client --> Redaction["redactSecrets() + Discord formatting"]
  Redaction --> User
```

## Boundaries

- This repository owns command registration, Discord runtime, formatting,
  deployment docs, and tests.
- Console repository (`dune-awakening-selfhost-docker`) owns the adapter API
  and all decisions about how data is gathered/written from Postgres.
- **The bot never connects to the Dune database directly, never holds a
  Postgres credential of any kind, and never executes raw SQL.** Every game
  data need — read or write — goes through the adapter API.

## Role Tiers (`src/rbac.js`)

Single source of truth, unified with Core's own tier model 2026-09-05
(issue #238, matching `rfc-console-auth.md` sec 2.1.1):

```
observer < moderator < admin < owner
```

- These are the **internal tier names** (`TIERS`/`TIER_RANK` in `rbac.js`,
  and the `guild_roles.role_type` CHECK-constrained DB values).
- **User-facing display labels differ**: `observer` is shown to users as
  **"Player"** (`ROLE_TYPE_LABELS` in `rbac.js`; confirmed live in
  `commands.js` lines 294/317 — "Player/Moderator/Admin/Owner"). `moderator`,
  `admin`, `owner` display under their own names unchanged. This resolves a
  discrepancy tracked in `mentat`#359: an earlier automated survey reported
  `public < observer < moderator < admin`, which is wrong on two counts —
  there is no `public` tier, and it omitted `owner` entirely. The correct
  model is the four-tier one above, with `observer`/"Player" as the bottom
  rung, not a separate fifth thing.
- **`owner` can never be reached via a Discord role mapping — architecturally,
  permanently, by design** (`rbac.js`'s `resolveActorAuthTier`,
  `isGuildOwner`). It is derived *exclusively* from live Discord guild
  ownership. Legacy `guild_roles` rows with `role_type="owner"` from
  pre-unification installs still exist in some databases but are explicitly
  filtered out and never consulted. **Any Discord role you create — no
  matter what you name it or how it's configured — can reach at most
  `admin`.** Owner-tier actions (see Write Capabilities) remain permanently
  restricted to whichever single Discord account literally owns the guild.
- Role→tier mapping is DB-backed (`guild_roles` table: `guild_id, role_type,
  role_id`), multi-tenant by design — one Mentat process serves multiple
  Discord guilds/operators, every table scoped by `guild_id`.

## Read Capabilities

Real, live routes (`adapterClient.js`'s `LIVE_ROUTES`, extensively
reconciliation-commented in that file with dates and PR references — read
that comment history before assuming a route's status): `health`, `status`,
`readiness`, `services`, `population`, `version`, `servers`, `ports`, `db`,
`logs`, `map-state`, `ops-activity`, `ops-combat`, `ops-resources`,
`ops-economy`, `ops-inventory`, `ops-soc`, `ops-prometheus`, `players-link`,
`players-link-verify`, `players-unlink`, `players-me`, `players-inventory`,
`players-inventory-search`, `players-storage`, `players-find`,
`guild-storage`, `guild-find`, `backups`, `announcements`, `maintenance`.

## Write Capabilities

Real, current list (`src/writeCommands.js`) — **all admin or owner tier, all
operational/infrastructure actions. No player-facing write (kick, ban, grant
item) exists today**:

| Command | Family | Tier |
|---|---|---|
| set-maintenance-note, set-maintenance-window | maintenance | admin |
| set-alert-channel, set-alert-threshold | notifications | admin |
| set-digest-schedule | notifications | admin |
| set-post-schedule, add-post-channel, remove-post-channel | schedule | admin |
| create-backup | operational | **owner** |
| restart-service | operational | **owner** |
| trigger-update | operational | **owner** |
| clear-cache | operational | **owner** |

Flow: `writeHandler.js` → `writeCommands.js` → `adapterClient.writePreview()`
/ `writeExecute()`. A separate `broadcast` route is also live (admin
announcements to a channel), gated by `DUNE_DISCORD_WRITES_ENABLED`.

**Player-facing write capability (kick/ban/grant-item/etc.) does not exist
in Mentat today.** It is a separate, still-in-design effort tracked in
`dune-awakening-selfhost-docker`'s `docs/rw-architecture.md`. That file's own
header currently reads "**Status: Layer 1 Design (Requirement 20). Eight-Hat
Layer 1 completed. 8 issues filed (#215-223). Awaiting fixes before Layer
2.**" — note this header did not obviously match this session's own prior
context of a much longer audit-round history for that effort; whoever reads
this next should re-check that file's own tracking section directly rather
than trust either this summary or an old chat transcript, since the header
itself may be stale relative to the file's body. **Do not build against the
RW-architecture effort until it has actually shipped** — nothing in this
repo should assume kick/ban/grant-item exists.

## Core-side data availability (checked 2026-09, re-verify before relying on this list)

Confirmed via direct grep of `duneDb.js`: real query logic already exists
for `specialization_tracks`, `player_state.online_status`, `guilds.
guild_faction`, `landsraad_decree*`, and `dune_exchange_orders`. **Zero
matches for `item_audit_log` or `cheater_tracking` anywhere in `duneDb.js`**
— any feature needing those tables requires new Core-side work (a new
`duneDb.js` function + adapter route) before Mentat has anything to call via
`adapterClient`. Confirmed again this session (0 matches, both tables).

## Security Controls

- Bearer-token authentication to the console adapter (`adapterClient.js:405`).
- RBAC tiers as above, fail-closed (`tierAtLeast` returns false for any
  null/unrecognized tier).
- Credential, PII, and game identity fields redacted before Discord output
  (`src/format.js`'s `redactSecrets()`).
- No Docker socket, no DB credentials, no raw command execution, no game-file
  mounts, no direct Postgres connection of any kind.

## Unit Testing

```bash
npm test
```
