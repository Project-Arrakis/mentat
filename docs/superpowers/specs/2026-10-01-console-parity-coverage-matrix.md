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
| Home | `SERVER_READ` | `core status/summary/health/readiness`, `data population` | Probably covered; check each Home widget | Verified (pass 1, see findings) |
| Server Control | `SERVER_CONTROL` | `start`, `stop`, `restart`, `restart-service` | Covered by writes (move to `/dune operations`, OD3) | Verified (pass 1, see findings) |
| Access Control | `SERVER_CONTROL` | `admin roles` (Discord role mapping) | Panel contents unknown. Read it before deciding | Verified (pass 1, see findings) |
| Backups | `BACKUPS_READ` | `data backups` (read), `create-backup` | Restore and adopt-backup: see exception E1 | Partly verified |
| Database | `DATABASE_READ` | `infra db` (status) | Backup/restore/direct mutation: see E1, E2 | Partly verified |
| Updates | `UPDATES_READ` | `trigger-update`, `self-update` (host operator) | Update status read and auto-update toggle may be missing | Verified (pass 1, see findings) |
| Logs | `LOGS_READ` | `logs` group (7 sources) | Probably covered; check parity of sources | Partly verified |
| Settings | `SETTINGS_WRITE` | `infra` schedules and channels (bot settings only) | Game/server settings: split into safe settings vs E3 secrets | Verified (pass 1, see findings) |

### Arrakis Management

| Nav item | Console tier | Discord today | Gap / proposed home | Status |
|---|---|---|---|---|
| Maps | `MAPS_READ` | `data maps` (read) | Map start/stop and partition control, if the console has them | Verified (pass 1, see findings) |
| Players | `PLAYERS_READ` | Staff: `kick ban unban warn give-item clear-backpack fill-water teleport`; self: `whoami inventory storage find` | Staff: add xp, skill points, currency, faction, reset (check each against console, some need typed confirmation: E4). Player self-service: D15 | Verified (pass 1, see findings) |
| Guilds | `GUILDS_READ` | Staff `add`, `remove` only | Staff: promote, demote, disband, list, members. Leader self-service: D18 | Verified (pass 1, see findings) |
| Bases | `BASES_READ` | `refill-generators`, `refill-water` | List, permissions, custodian transfer, export: gap. Delete base: E4. Owner self-view: D15 `bases` | Verified (pass 1, see findings) |
| Vehicles | `VEHICLES_READ` | `spawn`, `despawn`, `respawn` | List and ownership read: gap. Self view: D15 `vehicles` | Verified (pass 1, see findings) |
| Exchange | `EXCHANGE_READ` | none found | Gap; read the panel first | Verified (pass 1, see findings) |
| Live Map | `MAPS_READ` | `ops location` (text, stays as is) | **Exempt (operator, 2026-10-01): not to be implemented** | Decided |
| Landsraad | `LANDSRAAD_READ` | none found | Gap (read, then writes if any) | Verified (pass 1, see findings) |
| Admin Tools | `ADMIN_TOOLS` | `give-item`, `grant` family (partly) | Check which tools exist and which are E4 | Verified (pass 1, see findings) |
| Care Package | `CAREPACKAGE_GRANT` | `grant`, `grant-all` | Likely covered | Verified (pass 1, see findings) |

### Community

| Nav item | Console tier | Discord today | Gap / proposed home | Status |
|---|---|---|---|---|
| Addons | `ADDONS_READ` | none found | **Exempt (operator, 2026-10-01): not to be implemented** | Decided |

### Sidebar footer links (not nav items)

`App.tsx:984-986` has three links under the nav: **Requests**, **Report Issues** and **Get Help**.
Verified: all three are plain external links to the upstream Red-Blink Discord
(`REDBLINK_DISCORD_URL`), not console features. **Exempt (operator, 2026-10-01): not to be
implemented.**

## Operator decisions so far

| Item | Decision | Date |
|---|---|---|
| Live Map | Exempt, not implemented | 2026-10-01 |
| Addons | Exempt, not implemented | 2026-10-01 |
| Requests, Report Issues, Get Help (footer links) | Exempt, not implemented | 2026-10-01 |
| E1, E2, E3, E5 (console-only exceptions as written below) | Accepted | 2026-10-01 |
| E4 (typed-confirmation actions) | Open: decided per action once the panel pass lists them | 2026-10-01 |

With these exempt, 17 of the 19 nav items remain in scope.

## Proposed exceptions (to flesh out, each needs an operator yes or no)

| # | Console capability | Proposed handling | Reason |
|---|---|---|---|
| E1 | Database restore, adopt-backup-battlegroup, any destructive restore | Console only; Discord may start a backup and read status | Restore can orphan player data; needs typed confirmations and often a host-level look (see the capacity/migration notes). Discord cannot show enough context |
| E2 | Direct database mutation | Console only | Free-form power; no safe Discord shape |
| E3 | Secrets and tokens (adapter token, passwords, Funcom token) | Console only | Secrets must not appear in Discord messages or logs (Requirement 24) |
| E4 | Actions that need a typed confirmation phrase in the console (reset progression, delete base, disband, clean inventory, ban) | Allowed in Discord only with a distinct confirm step: requester-only button plus a second confirmation for the worst ones; otherwise console only | A button is weaker than a typed phrase; decide per action |
| E5 | Drag-and-drop editors, blueprint export/import, file download (the live map is already exempt above) | Console only; Discord links to the console or gives a text summary | Visual or file-based, no useful Discord form |

## Panel pass 1 findings (2026-10-01)

Source: three read-only readers over the Core repo (`console/web/src`, `console/api/src`),
reports consolidated by the controller. Citations are the readers' own `file:line` and were not
all re-checked. Where a reader could not tell, this says **not found**, which is not the same as
"absent". Discord adapter references: writes in `integrations/discord/writeActionRoutes.js` (WAR),
minimum tier in `writeActionMinTier.js`, reads in `routes.js`.

### What Discord already exposes (staff-facing)

- **Writes (WAR:103-142):** `player.kick/ban/unban/warn/give-item/clear-backpack/fill-water`,
  `base.refill-generators/refill-water`, `guild.add/remove`, `map.spawn/despawn/respawn/teleport`,
  `server.start/stop/restart`, `restart-service`, `updates.apply-game/fix-steamcmd`,
  `carepackage.enable/disable/grant/grant-all/scan/history-clear`, `backup.create`. Broadcast and
  announcements go through a separate bridge.
- **Reads:** status, readiness, services, maintenance, map-state, atlas, coriolis, plus the
  **self-scoped** player reads (`me`, faction, inventory, storage, find) and two staff reads
  (cheater tracking, item audit log). **There is no staff read of an arbitrary player, guild, base
  or vehicle.**

### Gap by nav item (in scope only)

| Nav item | Console capability with no Discord surface (summary) |
|---|---|
| Home | performance cards, Funcom token mismatch check, restart-queue view/cancel/restart-now |
| Server Control | not read in pass 1 (reader covered Home only); start/stop/restart exist |
| Access Control | the whole IAM policy editor (view per-tier policy, edit, test). **Security decision needed, see below** |
| Updates | game update *check*, console (stack) update check/apply, auto game-update settings, QA channel |
| Settings | almost entirely secrets (E3). Safe candidates: public-listing toggles, anonymous count, console port |
| Maps | status/memory/autoscaler/combat/spicefields/CHOAM reads, user-settings and ini editing, runtime settings, Sietch and Deep Desert views and updates, reconcile |
| Players | every staff read (list, profile, inventory, currency, vitals, specs, position...), and writes: currency, intel, faction reputation, XP, skills, specialization, journey, crafting and research unlocks, building sets, customizations, item edit/delete, faction assign, character recovery, repairs, reset progression, spawn vehicle, kick-all |
| Guilds | list, members, promote, demote, disband (add/remove exist) |
| Bases | list, permissions roster and edit, custodian transfer, child access, land claim, water/auto-refill, inventory view and edit, delete base, export |
| Vehicles | everything (list, permissions, storage, delete, custodian) |
| Exchange | everything (market board, transactions, config, market bot, seed plans) |
| Landsraad | everything (term, task goals, milestone preset, reward tiers, player contribution, modifiers) |
| Admin Tools | kick-all, shutdown broadcast, scheduled map messages, command history, MOTD, join/leave messages, character-transfer settings, daily restart, restart queue, IP-change restart, host-shutdown protection |
| Care Package | all reads (config, grants, history, eligible), config save, retry grant |

The reading side is the larger gap: Discord has many writes but almost no staff reads.

### Findings that change the plan

1. **Tier mismatch to check (important for the premise).** The Discord write bridge has its own
   minimum tiers: kick, ban, unban, fill-water, refill, spawn/despawn, care package are **admin**;
   `give-item`, `clear-backpack`, `stop`, `restart`, `updates` and `grant-all` are **owner**;
   **only `player.warn` is moderator**. If moderators are meant to manage day-to-day staff actions
   without console access, those tiers need a deliberate review against the console's own tiers
   (`players:moderate` etc.). Parity means the *same* tier as the console, unless you decide otherwise.
2. **Typed phrases are auto-filled by the Discord bridge** (WAR:54-62), so Discord writes already
   skip the console's typed-phrase safeguard. That makes E4 a real, current question, not just a
   future one: the confirm step is the requester-only button, nothing stronger.
3. **Several UI routes differ from the Discord ones** (UI uses `give-items` and `give-item-id`,
   Discord `player.give-item` uses the singular route; ban `reason` is not carried; `map.teleport`
   is not obviously the per-player teleport). Parity work must align contracts, not just add names.
4. **Access Control mirrors a security-critical editor.** Editing console IAM policy from Discord
   would let a Discord role change the console's own authorization. Recommend **read-only view and
   policy test only**, edit stays console-only (new exception **E6**, needs your decision).
5. **A possible console bug** reported by a reader, unverified: the web client sends POST to the
   IAM policy save route while the server matches PUT (`server.js:1582`). Not mine to fix here;
   worth a Core issue after someone confirms it.

### E4 candidates: console actions guarded by a typed phrase

Destructive or hard-to-reverse; decide per action (Discord with a second confirmation, or console
only). Phrases as reported: STOP SERVER, BAN PLAYER, CLEAN INVENTORY, RESET PROGRESSION, RESET
SPECIALIZATION, GRANT/RESET all keystones, RECOVER DELETED CHARACTER, REPAIR (faction, Landsraad
quests, gear, vehicle decay, login queue), KICK ALL ONLINE PLAYERS, SHUTDOWN BROADCAST,
SAVE ITEM / DELETE ITEM(S) / DELETE ALL ITEMS, APPLY AUGMENTS, DISBAND GUILD, DELETE BASE, EDIT LAND
CLAIM, SET CHILD ACCESS, DELETE VEHICLE, UPDATE SIETCHES, UPDATE DEEP DESERT, SPAWN/DESPAWN/RESTART
MAP, SAVE MAP SETTINGS, RESTORE MAP DEFAULTS, ENABLE/DISABLE MEMORY SWAP, SAVE AUTO GAME UPDATES,
SAVE/ENABLE/DISABLE/GRANT/RETRY/CLEAR CARE PACKAGE.
My proposal: allow in Discord with the existing requester-only button for routine ones (give,
grant, unlock, repair, kick, warn, broadcast, care package); require a **second, distinct
confirmation** for destructive ones (disband, delete base, delete vehicle, delete items, reset
progression/specialization, clean inventory, ban, stop/restart server, map spawn/despawn, edit land
claim); console only for bulk/free-form ones (raw ini edit, restore defaults, user-settings reset).

### Reader caveats

- Blueprints tab and the Vehicles tab route path were not verified; Server Control was not read.
- Some `actions.js` line numbers are approximate; the "GRANT AL..." and "RESET AL..." phrase tails
  were not read; a server-side phrase could exist where a reader found only a dialog.
- API-REFERENCE.md was not read by the Exchange/Landsraad/Maps reader.
- Discord Bot settings (a 1941-line section) were not fully read.

## Maps decisions (operator, 2026-10-01)

Maps in Discord is **instance control only**; all topology and configuration stays in the console.

| Action | Discord | Tier | Notes |
|---|---|---|---|
| Start instance (spawn) | yes | admin | Sietch (Survival_1), Deep Desert and Overmap |
| Stop instance (despawn) | yes | admin | same |
| Restart a **Sietch** | yes | **moderator** | via the console's countdown queue (players warned) |
| Immediate restart of a Sietch | yes | admin | no countdown |
| Restart **Deep Desert** | yes | **admin/owner only** | operator decision |
| Start/stop/restart **Overmap** | yes | **admin/owner only** | operator decision; it connects every map |
| Rename a **Survival_1** Sietch (Deep Desert has no rename: its name comes from the PvE/PvP layout) | yes | admin | **the backend restarts the Sietch automatically** (verified, see below); the confirm says so and shows the player count; whether a countdown applies is **unverified** |
| Set or remove a **Survival_1** Sietch password (Deep Desert: not offered in the console) | yes | admin (owner may too) | set through a Discord **modal** (not a slash option); ephemeral reply; reads show only set/not set; logs and audit record "password set/removed", never the value; needs a log-redaction test (Requirement 24) |
| Everything else in Maps (interactive modifiers, advanced and ini editing, user settings, adding or removing Survival_1 or Deep Desert instances, static-to-dynamic and back, memory/swap/autoscaler, runtime settings, CHOAM terminals, spicefields, reconcile) | **console only** | n/a | topology and capacity changes need the whole picture |

**Rule (operator, 2026-10-01): any change to an instance writes to an ini file, so it requires an
instance restart.** **Validated against Core's code (2026-10-01, `runtime/scripts/sietches.sh`):**
`set-display`, `set-password` and `set-settings` write the ini through `usersettings.py
partition-engine-set` (`server_display_name`, `server_login_password`), run `materialize-current`,
and then **restart the Sietch automatically if it is running** (`restart_sietch_partition_if_running`,
message "so sietch display/password changes are published by the running server"), for Survival_1.
So the restart is **not a separate prompt step, the save itself restarts the Sietch**.
Corrections to what I wrote earlier in this file:
- A Discord rename or password change does **not** end in "saved, pending restart". For a running
  Survival_1 Sietch it **restarts immediately**, disconnecting its players, so the confirm must say
  "this restarts the Sietch now" and show the player count.
- A **countdown (warning) is not guaranteed**: the backend calls the start script directly. Whether
  the console's countdown queue wraps it is **unverified**; until verified, treat rename and password
  as an immediate restart and keep them admin-only (a moderator can restart via the queue, but cannot
  trigger this).
- For non-Survival_1 maps (Deep Desert), the same scripts do **not** auto-restart (the restart branch is
  `if Survival_1`), so a change there is saved and only takes effect on the next restart. Unverified
  end to end, check before building.
- **The console prompt you remember is not in the current UI path.** In `MapsPanel.tsx` (~1722) the
  "Restart Required / Save And Restart" dialog is behind `const willRestart = false;`, so the Sietch
  save shows only "Save settings for <name>?" and then "Changes may take a short time to appear
  in-game". The restart warning you see may come from another path or a different build; I could
  not reproduce it from this checkout (a clone of the fork `main`, which may differ from what
  dune-prod runs).

**UPDATE (tested on dune-dev, supersedes the wording above): a Survival_1 rename or password
change restarts far more than one Sietch.** It restarts Survival_1, the Director, Survival_1 a second
time, and the Gateway (about 90 seconds, same sequence in 4 of 4 runs); the Deep Desert and Overmap
stayed up. Full evidence, timeline and code chain:
`2026-10-01-sietch-rename-password-restart-cascade.md`. Discord rename/password therefore stays
admin only with an explicit "restarts Survival_1 twice, the Director and the Gateway" warning.

**UPDATE 2 (second test series on dune-dev, same evidence document):** adding a Sietch (1 to 2) and
removing it (2 to 1) did **not** restart Survival_1, the Director or the Gateway (only the added or
removed Sietch started or stopped); renaming the **secondary** Sietch **did** restart the primary
Survival_1, the Director and the Gateway; an always-on Deep Desert cannot be stopped without first
setting it to dynamic, and on a small host the autoscaler's memory guard (map limit plus 4 GiB
reserve) can refuse to start it again. Implications for Discord Maps: **stop of an always-on map is
refused by the backend unless the mode is changed first (console-only)**, so Discord "stop" only
applies to dynamic maps; **start of a map can be refused by the memory guard** and Discord must show
that message, not a generic failure; **rename and password on any Survival_1 Sietch disconnect
Sietch 1's players** and need the full-cascade warning and admin tier.

**Changing the number of active Sietches (console only, validation attempt 2026-10-01).** Operator
says changing 3 to 4 or 4 to 3 restarts Survival_1. **The code I read does not show that:** the UI
sends `set-max` (when adding) then `set-active` (`MapsPanel.tsx:1646-1663`), with no restart action.
`sietches.sh set-active` calls `reconcile_map_dimensions` (`~1583-1807`), which adds or removes
partition rows, and a code comment there says a count change *must not replace* the running Director
or primary Survival_1: "additions can register directly, and removals are withdrawn by
despawning/deleting the secondary", then it publishes topology through `publish-sietch-overrides.sh
once` (not `restart`). So by the script, a count change does **not** restart Survival_1, though it
does despawn the extra Sietch when reducing. **Unresolved:** the observed restart may come from
something I did not read (the override publisher, the Director or FLS re-declaration, a different
build than this checkout). It matters little for Discord, because this operation stays console-only,
but the console's own warning text and any docs should match reality. **Downstream trace (second pass, same day):** followed `reconcile_map_dimensions` into
`refresh_survival_browser_state`, `publish-sietch-overrides.sh` (`once`, and `restart`, which only
stops and starts the publisher's own loop process), `relocate_survival_port_conflicts`,
`ensure_map_partitions`, `wait_for_survival_topology_settle` and `sync_partition_catalog_from_db`.
**No script-level restart of the Survival_1 container found.** One real side effect found:
`relocate_survival_port_conflicts` (`sietches.sh:~1150-1200`) runs `despawn-server.sh --force` then
`spawn-server.sh` on any **other** map (for example a Deep Desert) whose ports fall in the ports newly
reserved for the added Sietches; it refuses if that map has connected players. So raising the count
can restart a different, empty map. **Not traced:** `despawn-server.sh`/`spawn-server.sh` internals,
how the removal despawn happens, and what the game's own Director or Survival_1 process does when the
partition set changes (behavior outside these scripts could restart it, which would explain what the
operator sees). **Needs a controlled check on
dune-dev** (Requirement 32 procedure: dune-dev only, never dune-prod).

**Deep Desert: only the memory limit is modifiable (operator, 2026-10-01; code check, not a test).**
It stays **console only**. Whether it restarts depends on the path (`runtime/scripts/memory.sh`,
`console/api/src/tasks.js:480-482`, `server.js:4629`): the Maps panel **Save settings** expands a
memory change to `memory set-no-restart`, which applies the new limit to a running container live with
`docker update` (restart mode `none`), and stores it for the next start; the plain `memory set` path
(CLI default, and the separate `/api/maps/memory` route) **restarts the map if it is running** (Deep
Desert: despawn then spawn of that partition; Survival_1: `dune restart survival`; Overmap:
`dune restart overmap`). So "might cause a restart" is correct, depending on the path. **Tested on dune-dev (see the evidence document, third series):** the live path never restarted the
Deep Desert; the restart path **failed to apply** on an always-on Deep Desert (value saved, restart
refused); lowering below current use did not kill it but moved memory to swap and the limit was changed
by something unidentified. If memory is ever offered
in Discord it must use the live path, say which path ran, and warn about the lower-than-usage case.

Guard rails: the confirm button shows how many players are on the instance (the bridge auto-fills
the typed phrase, so nothing else shows the impact); every action is audited with the Discord user.

Open sub-points: (1) whether a manual **stop** of an on-demand Deep Desert (Dedicated Scaling,
`MinServers=0`) fights the autoscaler; check the code before building. (2) ~~Whether a password
change also needs a restart~~ resolved: yes, and the backend does it automatically (rule above). (3) The Sietch update route
carries the rename and password together and needs the phrase UPDATE SIETCHES; the Discord path
must not skip a restart the console would require.

## Existing tier matrices (binding sources, found 2026-10-01)

The operator recalled that tier matrices already exist for the RBAC work in the upstream PRs. Two
exist in Core; **new Discord commands must extend them, not replace them.** Sources: Core
`console/api/src/policy.js` (`DEFAULT_POLICIES`), `docs/rw-architecture.md` (section 0 invariant,
section 1 tier ladder, section 2 command groups A to G, section 3.3a), and
`console/api/src/integrations/discord/writeActionMinTier.js` (`WRITE_ACTION_MIN_TIER`).

### A. Console default policy on fork and upstream `main` (`policy.js`, read 2026-10-01): OLDER, superseded by C below

**Four tiers, not five: `observer` was retired and replaced by `player` (operator, 2026-10-01).** `main` still lists `observer` (identical to player there); the upstream RBAC PR branch (`tier1-upstream`) removes it (`DISCORD_ROLE_TIERS = [public, player, moderator, admin, owner]`, `observer` kept only in an `OBSOLETE_TIERS` cleanup set so old policy files are healed). Treat every mention of `observer` in this document and in `main` as `player`.

| Tier | Allowed by default |
|---|---|
| owner | everything (`*`) |
| admin | `setup`, `server`, `logs`, `backups`, `updates`, `players`, `guilds`, `bases`, `storage`, `blueprints`, `vehicles`, `exchange`, `maps`, `sietches`, `deepdesert`, `admin`, `landsraad`, `addons`, `carepackage` (all `*`) plus `database:read/query/export`. **Denied:** `settings:*`, `database:write-config/mutate/execute`, `server:restart`, `carepackage:clear-history`, `carepackage:grant-all`, `admin:history:clear` |
| moderator | read on server, maps, sietches, deepdesert, players, guilds, bases, storage, blueprints, vehicles, exchange, landsraad; `logs:*`; **`players:kick-all`**; `admin:broadcast`; `admin:map-chat` |
| player | read on the same set as moderator (no logs, no writes) |
| observer | identical to player |

Notes: an admin in the console can do **every** `players:*` action (including reset, delete-item,
edit-item, recover) because only the listed denials subtract. A moderator **cannot** kick or ban a
single player (`players:moderate` is not granted) but **can** kick all online players. The player and
observer tiers can read **all** players' data in the console (`players:read`); Discord `/player` is
deliberately narrower (own character only, D15).

### B. Discord write ladder (`rw-architecture.md` section 1, enforced by `WRITE_ACTION_MIN_TIER`)

Product requirement, set by audit (CRITICAL #729): "player" is **never** a write tier (section 0
invariant); moderator = `warn` only; admin = most writes; owner = destructive. Current rows:
moderator: `player.warn`. admin: `player.kick/ban/unban/fill-water`, `base.refill-generators/water`,
`server.start`, `server.restart-service`, `map.spawn/despawn/respawn/teleport`, `carepackage.grant/
enable/disable/scan`, `guild.add/remove`. owner: `player.give-item`, `player.clear-backpack`,
`server.restart`, `server.stop`, `carepackage.grant-all/history-clear`, `backup.create`,
`updates.apply-game/fix-steamcmd`.

**Discord is deliberately stricter than the console default** for `give-item`, `clean-inventory`
(owner on Discord, admin in the console) and `server.stop` (owner on Discord; the console only denies
`server:restart` to admin). The bridge checks its own table and does not read the console's editable
IAM policy, so **editing the policy in the console's Access Control tab does not change Discord
tiers** (relevant to the proposed exception E6).

### C. Console default policy in the upstream RBAC PR (`origin/tier1-upstream` @ `35e7999c`, `policy.js`): THE SHIPPING MATRIX

Tiers: owner, admin, moderator, player. Every non-owner tier also carries the same `Deny` block
(`CROWN_JEWEL_DENY_ACTIONS`: `settings:*`, `server:write-credentials`, `database:write-config/mutate/
execute`, system-backup download/import/restore and similar credential-bearing actions).

| Tier | Allowed by default (explicit list; anything not listed is owner-only) |
|---|---|
| owner | everything |
| admin | "operate the live server and moderate players; change nothing persistent". `server:start/stop/restart/restart-service/network-fix/storage-cleanup`; `players:read/kick-all/moderate/teleport`; `maps:read/spawn/despawn/teleport/restart/reconcile`; `admin:broadcast/broadcast-shutdown/map-chat`, MOTD and announcements read and write, history read **and clear**, transfer-settings read, item/vehicle/skill catalog reads; `logs:read`; read on bases, blueprints, carepackage, deepdesert, exchange, guilds, landsraad, sietches, storage, vehicles; `database:read/query`; `updates:check/read/self-check`; `backups:create/create-system/delete-system/read`; `setup:read`; `addons:read` |
| moderator | "live moderation only: read everything, talk to players, and act on individual griefers (kick/ban/teleport). No config, no economy, nothing destructive or persistent." Read on server, maps, sietches, deepdesert, players, guilds, bases, storage, blueprints, vehicles, exchange, logs, landsraad; `players:kick-all/moderate/teleport`; `admin:broadcast`; `admin:map-chat` |
| player | "a tight read-only self-service view": `server:read`, `players:read`, `guilds:read`, `maps:read` only. Deliberately **not** bases, storage, blueprints, vehicles, exchange, landsraad, sietches or deepdesert. Note in the code: these grants are still tier-wide (`players:read` is all players); own-only scoping is a tracked follow-up |

Consequence: **in this policy the economy and the destructive and persistent actions are owner-only**:
`players:give-item/grant/reset/repair/recover/delete-item/edit-item`, all `*:write-config`, guild
`membership/rank/disband`, base mutations (refills, permissions, delete), care package grant, enable,
disable and scan, map/sietch settings and updates, vehicles and exchange writes, settings.

### D. Where the Discord write ladder (B) and the upstream console policy (C) disagree

The bridge checks its own table (B) and not the console policy, so these differences are live:

| Action | Discord ladder (B) | Upstream console policy (C) | Note |
|---|---|---|---|
| kick, ban, unban | admin | **moderator** and up (`players:moderate`) | console is looser |
| kick-all online | not in Discord | moderator and up | no conflict, just missing |
| teleport (player or to a partition) | admin (`map.teleport`) | **moderator** and up (`players:teleport`, `maps:teleport` is admin) | partly looser in console |
| fill-water (`players:repair`) | admin | **owner** | Discord looser |
| base refill generators and water | admin | **owner** (`bases:mutate`) | Discord looser |
| guild add and remove | admin | **owner** (`guilds:membership`) | Discord looser |
| care package grant, enable, disable, scan | admin | **owner** | Discord looser |
| server stop and restart | owner | **admin** | Discord stricter |
| backup create | owner | admin (`backups:create`) | Discord stricter |
| give-item, clear-backpack | owner | owner | agree |
| grant-all, history clear, updates apply | owner | owner | agree |
| map spawn, despawn, respawn | admin | admin | agree |
| map restart by a **moderator** (the Maps decision above) | n/a (admin) | **not allowed**: moderator has `maps:read` only | **my Maps decision conflicts with C**: a moderator Sietch restart needs either a console-policy change or an exception |

**Open decision (operator):** which governs when they differ, the Discord ladder (B, audited as a
product requirement) or the shipping console policy (C)? Parity says the console policy; the ladder
was written earlier for Discord alone. Until decided, new tier proposals below follow C where C is
explicit and B where C is silent.

## Players (staff view): revised proposal, awaiting operator rulings (2026-10-01)

**Status: PROPOSED, not decided.** Revised after the operator pointed at the existing matrices. It
keeps every existing ladder row unchanged and only proposes tiers for **new** actions, by analogy with
those rows. Source of capabilities: the console Players panel as reported in panel pass 1.

Rules for the whole panel (proposed): staff reads are **ephemeral**; the target is a player chosen by
name; routine writes use the requester-only confirm button, destructive writes get a second, distinct
confirmation (E4); every write is audited with the Discord user.

| Group | Actions | Tier | Basis |
|---|---|---|---|
| View (read-only) | list and search, profile, inventory, currency, vitals, progression, skills and specialization, journey, crafting, research, vehicles, bases | **moderator** | console moderator has `players:read`; Discord reads for staff are not in the ladder (reads are not RW) |
| Sensitive view | exact position, teleport destinations | **admin** (withheld from moderators, OD23) | stricter than console on purpose |
| Light moderation | warn | moderator | **existing** ladder row |
| | kick, ban, unban, fill-water | admin | **existing** ladder rows |
| | kick-all online | admin proposed | **conflict:** console default gives it to moderator; ladder says moderator = warn only |
| Repairs | faction, Landsraad quests, gear, vehicle decay, login queue | admin | analogy: `fill-water` is admin (`players:repair`) |
| Routine grants | unlock crafting, research, building sets, customizations; journey node, tutorial; skill points and modules; teleport | admin | console admin; non-economy |
| Economy injection | give items (**existing: owner**), currency, intel, faction reputation, XP, specialization grants | **owner** | analogy: `give-item` and `carepackage.grant-all` are owner ("server-wide economy injection") |
| Destructive | clean inventory (**existing: owner**), reset progression, reset specialization or keystones, reset journey, edit or delete an item, assign faction, recover a deleted character | **owner**, plus the second confirmation | analogy: `clear-backpack` is owner; console admin can do these, Discord stricter |
| Not in Discord | raw item and vehicle catalogs, bulk or free-form | console only | E-rules |

**Superseded in part by C and D above (read first):** under the upstream console policy, moderators already may kick, ban, unban and teleport, and every economy, repair and destructive action is **owner-only**, not admin. The table below was written against the older ladder and `main` policy; re-derive the tiers from C once the D decision is made.

Open questions (only where the ladder is silent or in conflict):
1. **Kick-all online:** admin on Discord (my proposal), or owner? The console default gives it to
   moderator, which conflicts with "moderator = warn only".
2. **Economy injection:** currency, XP, intel, faction reputation, specialization grants at **owner**
   like `give-item`, or admin?
3. **Destructive and judgment calls:** is owner right for assign-faction and recover-deleted-character
   (console admin can do both today)?

Known contract mismatches to fix when building (from pass 1): the console uses `give-items` and
`give-item-id` where Discord `player.give-item` uses the singular route; the ban `reason` is not
carried through; `map.teleport` is not obviously the per-player teleport; Discord confirmation phrases
are auto-filled by the bridge (`writeActionRoutes.js:54-62`), so the console's typed-phrase safeguard
is skipped today.

## Next steps

1. Read each **Unverified** panel and upgrade its row to Verified (read-only work, suitable for a
   read-only sub-agent per panel group, the controller files nothing).
2. Operator answers E1-E5 (accept, reject or change).
3. For every **Gap** row, record the Core adapter route that exists or is missing (not yet
   checked; my expectation is that many are missing, because the adapter routes seen so far are the
   write actions above and a few reads, but that is unverified).
   This is the real size of the work and belongs in Core issues, per Requirement 18.
4. Fold the result into the command layout (OD1 names, OD9 groups) before any new command is built.
