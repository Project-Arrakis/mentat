# Console parity coverage matrix (first pass, 2026-10-01)

**Rule (operator, 2026-10-01; the project's founding premise):** every item in the console's left
nav can be managed from Discord, so a Discord guild owner can add the bot, map Discord roles to
admin, moderator and player, and let admins and moderators run the game servers without console
access. **Exceptions are allowed but must be written down here with a reason.** A nav item with
neither a Discord home nor a listed exception is a gap.

**Status:** first pass, not audited. **Verified** = read from the console's `navGroups`
(`console/web/src/App.tsx:332-363`, 19 items, 3 groups) and mentat's `origin/main` command tree
(`src/commands.js`) and write-action list (`src/writeActions.js`) on 2026-10-01. **Unverified** =
the panel's real contents have not been read yet; the row is a hypothesis to check panel by panel
(Requirement 12). Nothing here is implemented.

Current `/dune` groups: `core`, `data`, `goal`, `logs`, `ops`, `admin`, `infra`, plus the write
subcommands (kick, ban, unban, warn, give-item, clear-backpack, fill-water, refill-generators,
refill-water, restart, stop, start, restart-service, spawn, despawn, respawn, teleport, grant,
grant-all, scan, history-clear, add, remove, create-backup, trigger-update, self-update).

## Matrix

Console tier = the action the console requires (`requiredAction`). Parity never lowers it.

### Server Operations

| Nav item | Console tier | Discord today | Gap / proposed home | Status |
|---|---|---|---|---|
| Home | `SERVER_READ` | `core status/summary/health/readiness`, `data population` | Probably covered; check each Home widget | Unverified |
| Server Control | `SERVER_CONTROL` | `start`, `stop`, `restart`, `restart-service` | Covered by writes (move to `/dune operations`, OD3) | Verified |
| Access Control | `SERVER_CONTROL` | `admin roles` (Discord role mapping) | Panel contents unknown. Read it before deciding | Unverified |
| Backups | `BACKUPS_READ` | `data backups` (read), `create-backup` | Restore and adopt-backup: see exception E1 | Partly verified |
| Database | `DATABASE_READ` | `infra db` (status) | Backup/restore/direct mutation: see E1, E2 | Partly verified |
| Updates | `UPDATES_READ` | `trigger-update`, `self-update` (host operator) | Update status read and auto-update toggle may be missing | Unverified |
| Logs | `LOGS_READ` | `logs` group (7 sources) | Probably covered; check parity of sources | Partly verified |
| Settings | `SETTINGS_WRITE` | `infra` schedules and channels (bot settings only) | Game/server settings: split into safe settings vs E3 secrets | Unverified |

### Arrakis Management

| Nav item | Console tier | Discord today | Gap / proposed home | Status |
|---|---|---|---|---|
| Maps | `MAPS_READ` | `data maps` (read) | Map start/stop and partition control, if the console has them | Unverified |
| Players | `PLAYERS_READ` | Staff: `kick ban unban warn give-item clear-backpack fill-water teleport`; self: `whoami inventory storage find` | Staff: add xp, skill points, currency, faction, reset (check each against console, some need typed confirmation: E4). Player self-service: D15 | Partly verified |
| Guilds | `GUILDS_READ` | Staff `add`, `remove` only | Staff: promote, demote, disband, list, members. Leader self-service: D18 | Verified |
| Bases | `BASES_READ` | `refill-generators`, `refill-water` | List, permissions, custodian transfer, export: gap. Delete base: E4. Owner self-view: D15 `bases` | Partly verified |
| Vehicles | `VEHICLES_READ` | `spawn`, `despawn`, `respawn` | List and ownership read: gap. Self view: D15 `vehicles` | Partly verified |
| Exchange | `EXCHANGE_READ` | none found | Gap; read the panel first | Unverified |
| Live Map | `MAPS_READ` | `ops location` (text) | See exception E5 | Unverified |
| Landsraad | `LANDSRAAD_READ` | none found | Gap (read, then writes if any) | Unverified |
| Admin Tools | `ADMIN_TOOLS` | `give-item`, `grant` family (partly) | Check which tools exist and which are E4 | Unverified |
| Care Package | `CAREPACKAGE_GRANT` | `grant`, `grant-all` | Likely covered | Partly verified |

### Community

| Nav item | Console tier | Discord today | Gap / proposed home | Status |
|---|---|---|---|---|
| Addons | `ADDONS_READ` | none found | Read and update status as a gap; install/remove: E3 candidate | Unverified |

## Proposed exceptions (to flesh out, each needs an operator yes or no)

| # | Console capability | Proposed handling | Reason |
|---|---|---|---|
| E1 | Database restore, adopt-backup-battlegroup, any destructive restore | Console only; Discord may start a backup and read status | Restore can orphan player data; needs typed confirmations and often a host-level look (see the capacity/migration notes). Discord cannot show enough context |
| E2 | Direct database mutation | Console only | Free-form power; no safe Discord shape |
| E3 | Secrets and tokens (adapter token, passwords, Funcom token), addon install/remove | Console only | Secrets must not appear in Discord messages or logs (Requirement 24) |
| E4 | Actions that need a typed confirmation phrase in the console (reset progression, delete base, disband, clean inventory, ban) | Allowed in Discord only with a distinct confirm step: requester-only button plus a second confirmation for the worst ones; otherwise console only | A button is weaker than a typed phrase; decide per action |
| E5 | Live map, drag-and-drop editors, blueprint export/import, file download | Console only; Discord links to the console or gives a text summary | Visual or file-based, no useful Discord form |

## Next steps

1. Read each **Unverified** panel and upgrade its row to Verified (read-only work, suitable for a
   read-only sub-agent per panel group, the controller files nothing).
2. Operator answers E1-E5 (accept, reject or change).
3. For every **Gap** row, record the Core adapter route that exists or is missing (not yet
   checked; my expectation is that many are missing, because the adapter routes seen so far are the
   write actions above and a few reads, but that is unverified).
   This is the real size of the work and belongs in Core issues, per Requirement 18.
4. Fold the result into the command layout (OD1 names, OD9 groups) before any new command is built.
