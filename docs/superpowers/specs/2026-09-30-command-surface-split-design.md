# Command Surface Split: `/dune` into `/dune` + `/player` + `/goal` (mentat#422 + mentat#423)

**Status:** Design only. No code. Awaiting the Requirement 20 Layer 1 (design) eight-hat audit.
**Date:** 2026-09-30. **Base:** `origin/main` at `f8709f0` (PR #430 merged).
**Tracking:** mentat#422 (audience mixing), mentat#423 (split `/dune`), roadmap mentat#432 (batch 3).
**Tags:** decisions are `[D#]`, risks are `[R#]`, open operator decisions are `OD#`.

Every number in this document was measured from the real code on `origin/main`. The measurement
used `discordCommandCharBudget()` copied verbatim from `test/commands.test.js:1951`, run over
`commandDefinitions({ includeWriteGroup: true })`. Every option was simulated by rearranging the
real registered JSON, not estimated. The scratch scripts are not committed; §14 says how to
reproduce the numbers.

---

## 1. Goal and non-goals

### 1.1 Goal
Change the Discord command surface so that:
1. **The budget ceiling stops being a per-feature fight.** `/dune` is 7473 of Discord's hard
   8000-character limit. The test's soft target is 7500 (`test/commands.test.js:1976`), which
   leaves 27 characters. That target has been re-baselined four times (7800 → 7975 → 7452 → 7500),
   and each time existing descriptions were trimmed to fit (goal options are now "Id." and "Qty.").
   Phase 2's `goal sync` (20 chars) would leave 7. The draft PR #384 (`admin service-setup`, about
   350 chars) cannot land at all today.
2. **Each command's audience is clear.** `/dune player` is described as your own character but
   holds 7 actions against other players (kick, ban, unban, warn, give-item, clear-backpack,
   fill-water). `/dune server` mixes 10 reads with 4 server lifecycle writes (restart, stop, start,
   restart-service).
3. **Player features are easier to find.** In Discord's `/` picker, `/player` and `/goal` appear
   as top-level entries instead of being nested two levels inside `/dune`.
4. **Existing users are not stranded.** The change breaks muscle memory, so it has to be staged.

### 1.2 Non-goals
- **No authorization change.** No gate is loosened or tightened. Several classifications look
  questionable (§3.3). They are listed as follow-ups, not changed here.
- **No changes to Core**, its `commandCatalog.js`, its action ids (`player.kick` and so on), or the
  `admin sync-commands` drift check. §5.6 shows that check is unaffected.
- No new features. `goal sync` belongs to Phase 2 and `/goal order` is deferred (§4.4).
- No `default_member_permissions`, `contexts` or `integration_types` changes (§6.4 `[D11]`).
- No fix for the dormant `commandRoleIds` keys (§5.4). It is filed as a follow-up.

---

## 2. Background: how the surface works today (verified in code)

| Fact | Where |
|---|---|
| `commandDefinitions()` returns two commands: `/dune` and `/confirm-connection`. The second is the precedent for more than one top-level command. | `src/commands.js:345-351`, `src/ownerConfirmation.js` |
| `/dune` is built by one `SlashCommandBuilder` with 9 read groups, plus 7 write groups when `includeWriteGroup` is true (16 in total). | `src/commands.js:90-343` |
| Write actions are generated from `WRITE_ACTIONS`. The `player` and `server` entries are merged into the existing read groups; the other groups are created new. | `src/commands.js:65-74, 125, 206, 332-340`; `src/writeActions.js:5-119` |
| There is a single dispatcher. It returns `false` unless `commandName === "dune"`. The key is `group:subcommand`. | `src/commands.js:362-371` |
| Gate order: (1) console registration (`CONSOLE_REGISTRATION_EXEMPT_COMMANDS = {core:setup}`), (2) zero-role guild, owner bypass, (3) `isCommandAllowed(key)`, except `RBAC_EXEMPT_COMMANDS = {admin:roles}`, (4) cooldown `${userId}:${key}`, (5) the `diagnostic` option requires admin, (6) per-handler gates: `isAdminActor` for `admin:*` diagnostics, `canWrite(tier)` inside `handleWriteCommand`, the host-operator id for `bot:self-update`, `requireGuildGoalAccess` for guild goals. | `src/commands.js:399-484, 761-779`; `src/writeHandler.js:103-220` |
| Embed selection branches mostly on the **bare subcommand name**. The goal branches are also guarded by `group === "goal"`. The ops branch matches `OPS_SUBCOMMAND_NAMES.includes(subcommand)` with **no group check**. | `src/commands.js:740, 846-934` (goal guards `888-897`) |
| Autocomplete is routed in `index.js` only for `commandName === "dune"`: `data`+`calculator` goes to `handleCalculatorAutocomplete`, and any `goal` subcommand goes to `handleGoalAutocomplete(interaction, db)`. This path **bypasses** `executeDuneCommand`'s gates, so each handler re-derives its own scoping. | `src/index.js:418-427`; `src/commands.js:1615-1775` |
| Registration is one bulk `rest.put`, either guild-scoped (if `DISCORD_GUILD_ID` is set) or global. A bulk overwrite deletes any command that is not in the body. | `scripts/register-commands.js:9-16` |
| The deploy hook re-registers **only if** `src/commands.js` or `src/opsCommands.js` changed. It runs after the restart, and a failed registration only prints a WARNING. | `scripts/deploy-post-receive.sh:123-142`; `scripts/command-defs-changed.sh:24` |
| The public `GET /api/commands` feed is `getCommandRegistry()`, a curated, write-free list of `{group, title, commands[{name, desc, role}]}`. | `src/commands.js:2089-2213`; `src/setupServer.js:1204-1205` |
| mentat-link hardcodes the invocation as `"/dune " + group.group + " " + cmd.name`. | `mentat-link/js/command-accordion.js:133` |
| `admin sync-commands` compares **Core's catalog** with the committed `src/commands-registry.json` (`group:sub` keys that come from Core). It never reads the Discord tree. | `src/commands.js:2011-2076`; `src/registryLoader.js:215-234` |

---

## 3. Current-state inventory

### 3.1 Measured per-group cost (`includeWriteGroup: true`, total 7473/8000)

| Group | Total | Header (name+desc) | Subs | Write-merged cost inside |
|---|---:|---:|---:|---:|
| core | 203 | 29 | 4 | 0 |
| server | 758 | 42 | 14 | 173 (restart 31, stop 25, start 27, restart-service 90) |
| data | 883 | 34 | 4 | 0 (calculator alone = 723) |
| player | 1382 | 54 | 19 | 480 (kick 80, ban 58, unban 38, warn 91, give-item 103, clear-backpack 58, fill-water 52) |
| goal | 385 | 10 | 5 | 0 (create 202, on-hand 41, list 73, progress 29, delete 30) |
| logs | 354 | 42 | 7 | 0 |
| ops | 612 | 27 | 11 | 0 |
| admin | 420 | 43 | 7 | 0 |
| infra | 188 | 55 | 4 | 0 |
| write (legacy stubs) | 814 | 55 | 9 | n/a |
| base | 174 | 68 | 2 | n/a |
| map | 289 | 66 | 4 | n/a |
| carepackage | 354 | 82 | 6 | n/a |
| guild | 220 | 70 | 2 | n/a |
| operations | 223 | 80 | 2 | n/a |
| bot | 169 | 66 | 1 | n/a |
| `/dune` header | 45 | | | |

Writes disabled: `/dune` = 4577. `/confirm-connection` = 102. There are 101 subcommands in total:
64 read-only, 28 `WRITE_ACTIONS` and 9 legacy write stubs.

**Discrepancy with the earlier review.** That review quoted a whole-group split at `/dune` 6124,
`/player` 1538, `/goal` 698. I could not reproduce those figures. From current code, the whole-group
split (B1 below) measures **5706 / 1378 / 404**, and the audience-clean split (B2) measures
**6230 / 898 / 404**. The earlier figures probably used different descriptions or included planned
goal subcommands. This document uses only the numbers measured here.

### 3.2 Audience of every subcommand, with evidence

Audience classes, from the real gates in multi-tenant mode:
- **public**: bypasses the RBAC gate.
- **player**: any configured Mentat tier, including observer/"Player", or any member in open mode.
  The only gate is `isCommandAllowed` (`src/commands.js:1036-1062`), and in multi-tenant mode that
  is "holds any configured tier".
- **moderator**, **admin**, **owner**: per-action tier.
- **host-operator**: one configured Discord user id.

| Group | Subcommand(s) | Audience | Evidence |
|---|---|---|---|
| core | about, ping, help | player | no handler gate, RBAC only |
| core | setup | player (plus console-registration exempt) | `CONSOLE_REGISTRATION_EXEMPT_COMMANDS` `:1035` |
| server | health, summary, readiness-detail, services, services-detail, maintenance, coriolis, atlas | player | RBAC only (`:520-543`) |
| server | status, readiness | player, **admin for the `diagnostic` option** | `:480-484` |
| server | start, restart-service | admin | `WRITE_ACTIONS` tier (`writeActions.js:52,54`) |
| server | restart, stop | owner | `writeActions.js:41,50` |
| data | population, backups, maps, calculator | player | RBAC only (`:545-554`) |
| player | link, verify, characters, enable, disable, default, unlink, faction, whoami, inventory | player (self-scoped) | RBAC only; Core scopes to the actor (`:579-714`) |
| player | storage, find | player (self), with `scope: guild` served by Core's guild route | `:715-733`; Core decides guild visibility |
| player | warn | moderator | `writeActions.js:18` |
| player | kick, ban, unban, fill-water | admin | `writeActions.js:8,12,16,30` |
| player | give-item, clear-backpack | owner | `writeActions.js:23,28` |
| goal | create, on-hand, delete | player (personal); **admin for guild scope** | `requireGuildGoalAccess` `:1300-1307` |
| goal | list, progress | player, including guild scope | `:1504-1581` |
| logs | all 7 | player | RBAC only (`:735-738`) |
| ops | all 11 | player | RBAC only (`:740-759`) |
| admin | doctor, sync-commands, cooldowns, latency, events | admin | `isAdminActor` checks `:761-779` |
| admin | roles | **public** | `RBAC_EXEMPT_COMMANDS` `:1021` |
| admin | broadcast | moderator | `canBroadcast` gives `canWrite("moderator")` (`src/broadcast.js:13-25`) |
| infra | version, servers, ports, db | player | RBAC only |
| write | maintenance-note, maintenance-window, alert-channel, alert-threshold, digest-schedule, post-schedule, add-channel, remove-channel | admin | `LEGACY_WRITE_STUBS` tier (`writeHandler.js:30-50`) |
| write | cache | owner | `writeHandler.js:51` |
| base | refill-generators, refill-water | admin | `writeActions.js:34,36` |
| map | spawn, despawn, respawn, teleport | admin | `writeActions.js:59-67` |
| carepackage | grant, enable, disable, scan | admin | `writeActions.js:76-84` |
| carepackage | grant-all, history-clear | owner | `writeActions.js:78,86` |
| guild | add, remove | admin | `writeActions.js:90,95` |
| operations | create-backup, trigger-update | owner | `writeActions.js:101,103` |
| bot | self-update | host-operator | `writeActions.js:117`; `writeHandler.js:154-158` |

Single-tenant mode has no moderator tier. There, `canWrite` resolves any write role to admin
(`src/writes.js:89-93`), so moderator-tier actions need the admin role. This split does not change that.

### 3.3 Ambiguous or questionable classifications (flagged, not changed here)
1. **`admin roles` is public.** It is deliberately RBAC-exempt so a locked-out user can see why
   (#238), but it sits in a group named "admin" and `getCommandRegistry()` labels it `role: "admin"`.
2. **`admin broadcast` is moderator tier inside the admin group.**
3. **`player warn` targets a map, not a player.** The description says "Warn everyone on a map
   (not a DM)". It is moderator tier. It still acts on other players, so it moves with the other
   moderation actions.
4. **`server status/readiness` have an admin-only option on a player command.** This stays as is;
   the option is checked at runtime.
5. **Goal create/on-hand/delete are player or admin depending on `scope`.** This stays in `/goal`.
6. **`player storage/find` describe a `scope` of "owned (default), guild, or all (admin)".**
   The only choices are `owned` and `guild`. Also see mentat#433: Core's `INVENTORY_READ` may reject
   ordinary Players.
7. **Operator-leaning reads open to any tier:** `logs *`, `data backups`, `ops soc`,
   `ops prometheus`, `infra *`. They are classified "player" by the real gate. Whether they should
   be is a product question, out of scope.
8. **Real tier mismatch found in the open PR #436.** `LEGACY_WRITE_STUBS` gives `write cache` tier
   **owner** (`writeHandler.js:51`, enforced at `:117`). But `WRITE_HELP_ENTRIES` tags it `admin`,
   and #436's help classifier calls `canWrite(..., null)` for every `write:*` entry, which defaults
   to admin. So an admin sees `write cache` as "available" in help and is then denied. #436's own
   matrix test uses tier `null` for the legacy keys, so it encodes the same mismatch. The failure is
   fail-closed at execution, so it is a help-accuracy bug, not an access bug. Reported for #436.

---

## 4. Options

All budgets are measured. Proposed header descriptions: `/player` "Your character: linking,
inventory, storage." (44), `/goal` "Farming goals and orders." (25), `/dune moderation` "Act on
other players (moderator+)." (34).

| Option | Commands (chars / 8000) | Audience-clean? | Breaking for |
|---|---|---|---|
| **D** status quo, trim forever | `/dune` 7473 (93.4%) | No | nobody |
| **A** keep `/dune`, move the write-merged actions to a `moderation` group, server writes to `operations` | `/dune` **7517** (94.0%) | Yes | 11 write actions only |
| **B1** whole-group split | `/dune` 5706, `/player` 1378, `/goal` 404 | **No**: `/player ban` becomes top-level | all player and goal users |
| **B2** audience-clean split (**recommended**) | `/dune` **6230** (77.9%), `/player` **898** (11.2%), `/goal` **404** (5.0%) | Yes | player and goal users, plus 11 write actions |
| **C** split by audience | `/dune` 2870, `/player` 898, `/goal` 404, `/mod` 604, `/admin` 2754 | Yes, the most | nearly every privileged command too |

With writes disabled, B2's `/dune` is 3290.

### 4.1 What each option means for users
- **D.** No breakage. The ceiling stays, and every future subcommand has to trim unrelated text
  first. #384 cannot land and Phase 2 leaves 7 chars. Neither issue gets fixed.
- **A.** This fixes #422 but makes #423 **worse** (+44 chars for the new group header). The budget
  problem is unsolved. Moderators and admins still have to re-learn 11 paths.
- **B1.** Solves the budget. Keeps the defect #422 names, now more visible: the `/player` command,
  shown to everyone, lists `ban` and `clear-backpack`. Rejected.
- **B2.** Solves the budget. `/dune` gets 1770 chars of headroom against the 8000 limit (1270
  against the 7500 target). `/player` and `/goal` each have more than 7000 free. Fixes #422:
  `/player` holds only self-scoped actions, and actions against other players live in
  `/dune moderation`. Players re-learn two prefixes (`/dune player X` becomes `/player X`,
  `/dune goal X` becomes `/goal X`); the subcommand names do not change. Moderators and admins
  re-learn 11 paths.
- **C.** Most audience-pure, and it has the most headroom. But it breaks every privileged command
  path, not just the 11 misplaced ones. It moves `admin *` diagnostics under a new top-level command
  whose name clashes with the existing `admin` group, and it needs `/admin` to mix direct
  subcommands with subcommand groups. discord.js 14.27's builder accepts that (checked locally), but
  **Discord's API acceptance was not verified**. Its one real extra benefit is that a guild admin
  could hide `/mod` and `/admin` per command in Discord's Integrations settings. That benefit is
  opt-in and relies on Discord permissions, which mentat's role-mapping tier model does not use
  (§6.4). The cost is a larger break without a matching gain.

### 4.2 Recommendation `[D1]`: Option B2
B2 solves both issues with the smallest breaking set: only the prefix changes for player and goal
commands, plus 11 privileged paths. Every other command (`core`, `server` reads, `data`, `logs`,
`ops`, `admin`, `infra`, and the write groups) keeps its exact path, so 73 of 101 subcommands
keep their exact path. C can still come later as a further
additive split, because the key scheme in §5.2 allows 3-segment keys.

### 4.3 Placement decisions under B2
- `[D2]` **The names are `/player` and `/goal`,** matching the issue text and the existing
  `player`/`goal` key segments. Collision risk with other bots is in `[R7]` / OD1.
- `[D3]` **The 7 actions against other players move to a new group, `/dune moderation`** (kick,
  ban, unban, warn, give-item, clear-backpack, fill-water). The name describes the audience (acting
  on other players), not the tier; tiers stay per action (moderator, admin or owner).
- `[D4]` **The 4 server lifecycle writes move into the existing `/dune operations` group** (restart,
  stop, start, restart-service). That group is already "owner/admin server operations"
  (create-backup, trigger-update), so there is no new header cost. `/dune server` becomes
  read-only. The alternative, keeping them in `server`, is OD3.
- `[D13]` **`/dune data calculator` stays where it is.** It is stateless math used by everyone.
  Moving it to `/goal` would add 723 chars to `/goal` for no audience gain. OD6.

### 4.4 Goals, orders and Phase 2
- `[D14]` **There is no `/order` command and no order entity.** An order is a goal with `due-at`
  (`goals.due_at`, `src/database.js:153-175`).
- **An `order` entry-point subcommand is possible later but deferred.** Measured as
  `/goal order` = `create` without `scope` and with a deadline-focused description: 196 chars,
  bringing `/goal` to 671 including a readable `sync`. The budget allows it; the product decision
  (does an order mean guild scope? is `due-at` required?) is not made. OD5.
- **Phase 2's `goal sync` becomes `/goal sync`.** Its logical key stays `goal:sync` (§5.2), so the
  Phase 2 design's `COMMAND_COOLDOWN_MS["goal:sync"]`, `FORCE_EPHEMERAL_COMMANDS` and its
  autocomplete scoping carry over unchanged. Only its user-facing text changes from
  `/dune goal sync` to `/goal sync`. Cost in `/goal`: +20 chars with the Phase 2 terse text (424),
  or +71 with readable text (475). The terse goal descriptions ("Id.", "Qty.", "Goals.") can be
  restored, because `/goal` has more than 7000 chars free.
- **Sequencing with Phase 2 (its Open Decision 5).** Either order works, because the key is stable.
  If Phase 2 ships first, it takes `/dune` to 7493 until the split lands.

---

## 5. Code structure

### 5.1 One declarative surface map `[D16]`
Add one table (in a new `src/commandSurface.js`) that is the single source of truth for where
each logical group is invoked:

```
logicalGroup -> { command: "dune" | "player" | "goal", group: <discord group name> | null, title, audience }
  core        -> { command: "dune",   group: "core" }
  ...
  player      -> { command: "player", group: null }
  goal        -> { command: "goal",   group: null }
  moderation  -> { command: "dune",   group: "moderation" }
LEGACY_MOVES: "dune player *" -> "/player *", "dune goal *" -> "/goal *",
              "dune player kick" -> "/dune moderation kick" (x7), "dune server restart" -> "/dune operations restart" (x4)
```
Help, the public registry feed, pointer replies, user-facing strings (48 `/dune player|goal`
references in `src/`, including `embedFormat.js`, `steamLinkServer.js` and `commands.js` error
text) and tests all read the invocation string from this map (`invocationFor("player:link")`
returns `/player link`), so strings cannot drift again.

### 5.2 Key format `[D5]`: the logical key is unchanged for everything that exists today
- **Logical group** = the subcommand group for `/dune`, or the top-level command name for
  single-level commands (`/player`, `/goal`).
- **Key** = `${logicalGroup}:${subcommand}`. For a future non-`dune` top-level command that has
  its own groups: `${command}:${group}:${subcommand}` (3 segments, which can never equal a
  2-segment key).
- Consequences:
  - `/player whoami` has key `player:whoami`, the same as `/dune player whoami` today.
  - `/goal progress` has key `goal:progress`, the same as today. PR #435's hardcoded
    `isCommandAllowed(interaction, "goal:progress", ...)` in autocomplete stays correct.
  - Cooldown keys `${userId}:goal:on-hand` and similar are unchanged; tests that call
    `clearCooldown({commandName: "goal:on-hand"})` keep working.
  - **Only the 11 moved write actions change keys:** `player:kick` becomes `moderation:kick` (x7)
    and `server:restart` becomes `operations:restart` (x4). `WRITE_ACTIONS[].group` changes for
    exactly those 11 entries. **Core action ids (`player.kick`, `server.restart`, ...) do not
    change**, so audit events (`writeAuditEvent` logs the Core `action`), Core's route table and
    `write/preview` payloads are untouched.
- A test asserts that logical keys are unique across all registered commands. `/dune` must never
  again get a group named `player` or `goal` (apart from the time-boxed pointer shims, §7.3,
  which never reach key computation).

### 5.3 Dispatch and routing changes
- `executeDuneCommand` becomes `executeSlashCommand` (keeping the old export name as an alias for
  tests and callers). The first line changes from `commandName !== "dune"` to "`commandName` is in
  the surface map". It then computes `(logicalGroup, subcommand, key)` as in §5.2. **Every line
  after key computation is unchanged**, including all gates, cooldown, deferral, the dispatch
  chain, redaction and embed selection, because they already branch on `key`/`group`, and `group`
  now holds the logical group. This is why the goal branches guarded by `group === "goal"`
  (`:888-897`) keep working. If the raw Discord group (`""` for `/goal`) were used instead, the goal
  embeds would silently fall back to `formatGenericEmbed`. That is `[R2]`.
- **Legacy-path pointer, before any gate `[D7]`:** if `commandName === "dune"` and the group is
  `player` or `goal`, or the path is one of the 4 moved server writes, the dispatcher replies
  ephemerally "This command moved to `/player whoami`." and returns. It **never executes**, applies
  no cooldown and calls no adapter. The reply only names another publicly registered command, so
  putting it before the gates discloses nothing. This single rule covers stale clients, the
  deploy-hook window (new code running with old registration), and registered shims (§7.3).
- `index.js`: the chat-input branch is unchanged apart from the renamed function. The
  `confirm-connection` branch stays first.
- The `WRITE_ACTIONS` table: `group` changes for 11 entries. `addWriteSubcommands(g, "moderation")`
  and `addWriteSubcommands(opsGroup, "server"→"operations")` replace the merges at `:125`/`:206`.
  `findWriteAction(group, name)` keeps its signature, since the logical group is what gets passed.
- `buildDuneCommand` keeps building `/dune`, minus the `player` and `goal` groups, plus
  `moderation`. New `buildPlayerCommand()` and `buildGoalCommand()` move the existing builder code
  verbatim (subcommands attach to the top-level builder instead of a group builder).
  `commandDefinitions()` returns `[dune, player, goal, confirm-connection]` (4 of 100 global).

### 5.4 RBAC and cooldown key migration: nothing stored needs migrating
- **Database:** verified by reading `SCHEMA` in `src/database.js`. `guild_roles` stores tiers
  (`role_type`), not commands. `guild_settings` has no per-command column. Goals and audit tables
  store no command key. **No per-command override is stored anywhere in the DB.** The live
  production DB was not inspected; the schema makes it impossible either way.
- **Cooldowns:** in memory only (`src/cooldown.js:5`), cleared on restart. Nothing to migrate, and
  the keys are preserved anyway (§5.2).
- **Single-tenant `commandRoleIds` (env):** `src/config.js:243-253` builds keys as **bare names**
  (`health`, `about`, `ping`, `status`, `status-summary`, `readiness`, `services`, `population`,
  `backups`). `isCommandAllowed` looks them up by `group:subcommand` (`:1058`), so **these env
  overrides never match and are dormant today** (a pre-existing defect; `status-summary` is not
  even a real subcommand). The tests only use `group:sub` keys they inject directly (for example
  `test/commands.test.js:174`). The split changes none of the affected keys (`server:*`, `core:*`,
  `data:*` stay the same). Fixing the dormant keys would make `DISCORD_*_ROLE_IDS` take effect,
  which changes behaviour. It is kept out of this change and filed as a follow-up (§12).
- `[D6]` Operator-facing config (`DUNE_DISCORD_WRITES_ENABLED`, role env vars, `guild_roles`) is
  unchanged. No operator action is required except re-registration (§7).

### 5.5 Autocomplete: every handler keeps its own gate `[D10a]`
Autocomplete bypasses `executeDuneCommand`'s gates (`index.js:405-427`), so routing must be exact:

| Command/path | Handler | Its own gate (unchanged) |
|---|---|---|
| `commandName === "dune"`, `data` + `calculator` | `handleCalculatorAutocomplete` | none needed: static recipe data, no user data |
| `commandName === "goal"` (any subcommand) | `handleGoalAutocomplete(interaction, db)` | personal goals by `owner_id = user.id`; guild goals only when `isAdminActor` (on-hand/delete) or `isCommandAllowed("goal:progress")` (progress, after #435); `db` null gives `[]` |
| `commandName === "dune"`, `goal` (shim or stale) | **respond `[]`** | a pointer shim has no options, so there is no autocomplete; responding `[]` avoids ever running goal lookups on a legacy path |
| anything else | respond nothing / return | |

`handleGoalAutocomplete` reads only `getSubcommand()` and focused-option names, never the group,
so it works unchanged under `/goal`. A test must show that `handleGoalAutocomplete` is **not**
reached for `commandName` `player` or `dune`+`player`, and that the guild-goal leak tests in
`test/goalAutocomplete.test.js` pass with `commandName: "goal"`.

### 5.6 What does not change
Core, `commandCatalog.js`, `src/commands-registry.json`, `diffRegistries` and `admin sync-commands`
(these compare Core's `group:sub` catalog names, never the Discord tree), write confirmation
buttons (keyed by nonce), `/confirm-connection`, and `WRITE_ACTIONS` action ids and params.

### 5.7 Files touched (estimate)
`src/commands.js` (builders, dispatcher preamble, `helpPayload` display, `getCommandRegistry`,
error strings), new `src/commandSurface.js`, `src/writeActions.js` (11 `group` values),
`src/index.js` (autocomplete routing, function name), `src/embedFormat.js` and
`src/steamLinkServer.js` (strings via the map), `scripts/command-defs-changed.sh` (the file list,
`[R4]`), and a `src/config.js` layout flag (§8). Tests: `test/commands.test.js` (budget test made
per-command; `mockInteraction` gains `commandName`), `test/commandRegistryContract.test.js`,
`test/goalAutocomplete.test.js`, `test/calculatorAutocomplete.test.js`,
`test/helpWriteVisibility.test.js` (after #436), `test/writeActions.test.js`,
`test/writeHandler.test.js`, `test/discord-bot-test-harness.js`, and new characterization tests
(§9). mentat-link: `js/command-accordion.js`, and the static `index.html`/`docs/index.html` text
(34 references).

---

## 6. Security and RBAC

### 6.1 Invariant
**For every (caller type × command), the authorization outcome after the change is identical to
before, where "before" uses the old path and "after" uses the new path.** No gate is weakened,
reordered or bypassed.

### 6.2 Why the design preserves it structurally
- The key is unchanged for 90 of 101 subcommands (§5.2), so `isCommandAllowed`,
  `RBAC_EXEMPT_COMMANDS`, `CONSOLE_REGISTRATION_EXEMPT_COMMANDS` and the cooldown all see the same
  strings.
- The 11 moved writes change key, but their gate is not key-based. `handleWriteCommand` resolves
  the tier from `findWriteAction(group, sub).tier` (`writeHandler.js:145-183`), and the tier values
  are unchanged. `isCommandAllowed` in multi-tenant mode is not key-sensitive ("any tier"). In
  single-tenant mode it is key-sensitive only through `commandRoleIds[key]`, which cannot contain
  `player:kick` from env today (§5.4).
- Write confirmation (`registerRealPendingConfirmation`, requester-only buttons, Core nonce
  preview/execute, typed confirm phrases) runs after dispatch and is keyed by nonce, so it is
  untouched. `requiresDualConfirmation` is currently set on no action (mentat#404); the `forcedPublic`
  lookup at `:502` still uses `findWriteAction(logicalGroup, sub)`.
- `bot self-update` stays under `/dune bot` with its host-operator check.
- Legacy pointers never execute (§5.3), so they cannot become a gate bypass.

### 6.3 The matrix test `[D8a]`
Modelled on `test/helpWriteVisibility.test.js` (PR #436): `callerSet()` × modes × `assertMatrix`.
1. **Characterization first, in its own PR before the refactor.** Build a harness that runs the
   real `executeDuneCommand` with a stub adapter (records calls) and a stub interaction for every
   registered path × caller ∈ {public (no role), observer, moderator, admin, owner (real
   `guild.ownerId`), host-operator, allowed-user id} × {multi-tenant restricted, multi-tenant open,
   single-tenant restricted, single-tenant open, single-tenant with a write-admin role outside the
   read lists} × {writes on, writes off}. Record an **outcome class** for each: `not-connected`,
   `zero-role`, `rbac-denied`, `admin-denied`, `diagnostic-denied`, `write-tier-denied`,
   `host-operator-denied`, `guild-goal-denied`, `write-preview(action, params)`, `executed(route)`.
   Commit the result as a JSON golden file generated from **pre-split code**.
2. **After the split:** the same harness runs every new path, and the old path maps to the new one
   through `LEGACY_MOVES`. It asserts equality with the golden file per (caller, mode, logical
   route). Legacy paths must produce `pointer` for every caller and every mode, with zero adapter
   calls.
3. Help: `available` must equal "may actually run it" for every new invocation (extend #436's
   `assertMatrix` to all commands).
4. Autocomplete matrix: the same callers against `/goal` id/node suggestions (no guild goals for a
   non-admin on on-hand/delete; no guild goals for a role-less member on progress in a restricted
   guild). `commandName` `dune`+`goal` returns `[]`.

### 6.4 Discord-level permissions `[D11]`
Today no command sets `default_member_permissions`, `dm_permission`/`contexts` or
`integration_types` (grep finds none in `src/`). The new commands set **the same (none)**, and a
test asserts all top-level commands carry identical values for those fields. **Do not use
`default_member_permissions` to hide `/dune moderation` or anything else:** mentat's tiers come
from role mapping, so an Admin-tier role without Discord's Manage Server permission would lose
access. Bot-side gates stay authoritative.

**Consequence `[R6]`:** Integrations per-command permission overrides that a guild admin may have
set on `/dune` are tied to `/dune`'s command id. A bulk overwrite keeps `/dune`'s id, but `/player`
and `/goal` start with no override, so they are visible to everyone the guild's default allows.
mentat's own gates still apply, so no mentat gate weakens, but a Discord-side restriction a guild
admin chose would not carry over. This cannot be checked from here (it needs the per-guild
command-permissions API with a user token), so it goes in the release note (§7.5).

### 6.5 Public feed
`getCommandRegistry()` stays write-free (#203/#436): the `moderation` group is write-only and must
not appear, and #436's test has to add `moderation` to its write-only group list. The feed gains an
**additive** `prefix` field per group (§7.5).

---

## 7. Migration plan (breaking change)

### 7.1 How Discord registration works here
- `npm run register` makes one bulk `PUT` (global, or guild if `DISCORD_GUILD_ID` is set). It
  **replaces the whole set**: commands not in the body are deleted, same-named commands keep their
  id, new names get new ids.
- **Propagation (unverified):** Discord historically documented up to an hour for global command
  updates, and `docs/discord-setup.md:224` repeats that. Current behaviour is believed to be
  near-instant, but clients cache the command list and some need a reload. The design has to work
  under either.
- **Stale guild-scoped copies:** if a guild-scoped registration ever existed alongside the global
  one (`docs/troubleshooting.md:124`), a global PUT does not remove it, and the old `/dune player`
  would stay in that guild. The runbook checks both scopes (§7.4).
- **The deploy hook** re-registers after restart, and only when `src/commands.js` or
  `src/opsCommands.js` changed. `src/writeActions.js`, which `[D3]`/`[D4]` edit and which already
  shapes the Discord tree today, and `src/ownerConfirmation.js` and the new `src/commandSurface.js`
  are **not** in that list (`[R4]`). They must be added in the same PR. A registration failure is
  only a WARNING, so new code can run against old registration indefinitely. The legacy pointer
  (§5.3) keeps that state safe but degraded.
- **`admin sync-commands` is unrelated.** It is a read-only Core-catalog drift check and never
  registers anything (`:2000-2010`).

### 7.2 Keeping old paths working during the transition
Three possibilities were measured:

| Mode | What users see when typing `/dune player` | `/dune` cost | Verdict |
|---|---|---|---|
| T0: no old registration | nothing (the group is gone); stale clients get a pointer reply | 6230 | cheapest, worst discovery |
| **T1: registered option-less pointer shims** | the `player`/`goal` subcommands, each described "Moved: use /player whoami.", running one replies with the pointer | **7305** with descriptive text (+1075: player 724, goal 173, server writes 178); **6610** with "Moved." (+380) | **recommended `[D8]`** |
| T2: keep the full old tree registered and alias-execute it | the old tree works | about 8000 (6230 + 1382 + 385 before server shims) | impossible, and it would list every command twice |

`[D8]` **T1 with descriptive text (7305, under the 7500 target) for a fixed window**, then the
shims are removed. The code-level pointer (no registration cost) stays for longer to catch stale
clients. Proposed lengths: shims for one minor release or 30 days, whichever is later; code
pointer for 90 days (OD2). The shim subcommands have **no options**, so they cannot be confused
with execution paths. A test asserts that every shim subcommand has zero options and that its
dispatch outcome is `pointer`.

### 7.3 What existing users see
1. After registration, the `/` picker shows `/dune`, `/player` and `/goal` as separate entries.
2. `/dune player` still expands during the window, and each entry says where it moved. Running one
   gives an ephemeral pointer.
3. After the window, `/dune player` is gone. A stale client gets the pointer, or Discord's own
   "outdated command" error (**unverified** exactly which).
4. Moderators and admins: 11 paths move (`/dune moderation *`, `/dune operations restart|stop|start|restart-service`).
   Everything else in `/dune` stays the same.
5. Help (`/dune core help`) lists the new invocations, taken from the surface map.

### 7.4 Rollout runbook (for the implementation plan)
1. Merge the prerequisites (§10). Merge mentat-link's `prefix`-aware accordion **first** (§7.5).
2. Deploy with `DUNE_COMMAND_LAYOUT=legacy` (the default in the first release, §8). This is a code
   change only, with the same registered tree. The golden matrix proves no behaviour change.
3. Switch the host to `split`: set the env var, then `npm run register`, then restart.
4. Verify: `GET /applications/{id}/commands` (global) **and** each guild scope shows exactly
   `dune`, `player`, `goal`, `confirm-connection`. Run each new path once as owner and once as
   observer on dune-dev's guild. Run one legacy path and confirm the pointer. Check that
   `/api/commands` returns `prefix`.
5. Release notes and docs (§7.5). The next release flips the default to `split`.
6. After the window: remove the shims and the legacy layout.

### 7.5 Communication
- **Release note / CHANGELOG** ("Breaking"): an old→new mapping table covering the 17 player and
  goal prefixes and the 11 moved writes; the shim window end date; a note for self-hosting
  operators that `npm run register` is required (their deploy hook may not run); a note for guild
  admins that Integrations permission overrides on `/dune` do not carry over to `/player` and
  `/goal` `[R6]`; and a `docs/changes/PR-NNNN-command-surface-split.md` entry following the
  existing convention.
- **Landing page `[D10]`:** `getCommandRegistry()` gains an additive `prefix` per group (`"/dune server"`,
  `"/player"`, `"/goal"`). mentat-link's accordion renders `(group.prefix || "/dune " + group.group) + " " + cmd.name`.
  This is backward-compatible both ways, so mentat-link deploys first. Its static `index.html` and
  `docs/index.html` mock-ups (34 references) are updated in the same mentat-link PR.
- **In-product strings:** the 48 `src/` references are generated from the surface map (§5.1).
- **Docs:** see §11.
- **Core (out of repo):** Core's in-game whisper says "Use /dune **data** verify"
  (`linkProvider.js:198`, which is already stale since 2026-07-24), and its error text says "use
  /dune player unlink" (`linkProvider.js:119`, `duneDb.js:16870`). Per Requirement 18, file a Core
  issue to reword these (a bot-neutral phrase, or the new path). This does not block the split.

---

## 8. Rollout, rollback and feature flag `[D9]`
- **Flag:** `DUNE_COMMAND_LAYOUT=legacy|split`. It decides which tree `commandDefinitions()` returns.
  **The dispatcher accepts both layouts at all times:** `/player`, `/goal`, `/dune moderation` and
  `/dune operations restart*` always execute, and the legacy paths always point. In `legacy` layout,
  `/dune player *` must still execute, so in legacy layout the pointer rule is disabled and the old
  tree runs through the same pipeline. Its key `player:whoami` is identical, and the moved writes
  reach the new write table through `LEGACY_MOVES`. The golden matrix covers both layouts.
- **Rollback** is a config change, not a code revert: set `legacy`, run `npm run register`,
  restart. Reverting the code instead would leave `/player` registered with no handler (Discord's
  "application did not respond") until someone re-registers `[R11]`.
- **Can it be rolled back after users learn the new names?** Yes, functionally: the old tree comes
  back and the new names disappear from the picker. That confuses people, so rollback is for a
  failed rollout (within days), not a later preference change.
- **The flag is temporary.** It is deleted together with the shims. Carrying two trees costs
  nothing in the budget, since only one is registered, but it is code debt.

### Discord limits (checked against the design)
- **Global commands:** 4 of 100 under B2. Open issues propose more top-level commands (#364
  `/profile`, #371 `/renown`, #367 `/exchange trace`, titles only); still far below 100.
- **Subcommand groups per command:** `/dune` 15 of 25 (was 16). **Options per command/group:**
  `/player` 12 of 25, `/goal` 5 of 25 (6 with `sync`, 7 with `order`), `moderation` 7 of 25,
  `operations` 6 of 25, `data calculator` 17 of 25 (unchanged).
- **8000 chars per command:** §4. The test becomes per-command: each ≤ 7500 target and < 8000 hard
  limit, with shims included while registered `[D12]`.

---

## 9. Testing strategy
1. **Characterization golden matrix (§6.3)** on pre-split code, merged before the refactor.
2. **Structure tests:** logical-key uniqueness across all commands; every registered path has a
   dispatch branch (a sweep asserting no `Unknown command:` outcome for any registered path);
   Discord limits per command; identical permission/context fields on every top-level command;
   shims have no options.
3. **Per-command budget test** replacing the single `/dune` assertion.
4. **Routing tests:** `commandName` in {dune, player, goal, confirm-connection, unknown} ×
   {chat input, autocomplete, button}; an unknown command returns `false` without replying.
5. **Embed-selection regression:** for every route, the embed title/formatter used is the same as
   before, which catches `[R2]`.
6. **Help and registry:** extend #436's "help surface equals registered tree" to all commands, and
   the contract test's "public group corresponds to a real group" to the surface map; `prefix`
   present and correct.
7. **Deploy hook:** extend `test/deploy-hook.bats` so that a change to `src/writeActions.js`,
   `src/commandSurface.js` or `src/ownerConfirmation.js` triggers registration.
8. **Live UAT on dune-dev's guild:** register with a guild-scoped `DISCORD_GUILD_ID` first, run the
   matrix manually for owner, admin, moderator, observer and no-role, then switch to global.
9. Run the full suite (`npm test`, `npm run check`), plus `/code-review high` as Layer 3.

---

## 10. Interaction with open work
| Item | Interaction | Sequencing |
|---|---|---|
| **PR #435** (goal follow-ups, 216 lines in `src/commands.js`, including autocomplete scoping that hardcodes `"goal:progress"`) | Compatible: the key is unchanged (§5.2). Conflicts textually in `commands.js`. | **Merge before** implementation starts. |
| **PR #436** (#424 help write visibility) | Its `WRITE_ACTION_HELP_ENTRIES` derive `${group}:${name}`, so they follow the 11 regrouped entries automatically. Its tests iterate only `buildDuneCommand` and hardcode `["player","server"]` as the merged groups, so they need updating. Also the `write cache` tier mismatch (§3.3 item 8). | **Merge before** (roadmap #432 batch 2 already says so). |
| **PR #437 / Phase 2** (`goal sync`) | Key `goal:sync` is stable. Only its text and its `M-T22` budget test change. It relieves Phase 2's Open Decision 5. | Either order works. |
| **PR #384** (draft, `admin service-setup`, about 350 chars) | Cannot fit today (7473 + 350 > 7500). Fits under B2 (about 6580). | After the split. |
| PR #389, #431 | No command-definition change. | Independent. |
| mentat-link | Accordion `prefix` support, plus static text. | Deploy **before** mentat. |

---

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | The routing refactor silently changes an authorization outcome | High | Golden matrix from pre-split code (§6.3); key preserved for 90/101; tier-based write gate unchanged |
| R2 | Handlers or embed selection branch on the raw Discord group (`""` for `/goal`) and fall through to generic/unknown | Medium | Logical group passed everywhere (§5.3); embed-regression and "no Unknown command" sweep tests |
| R3 | Muscle-memory breakage and support load | Medium | Pointer shims (§7.2), code pointer, mapping table in release notes, help shows new paths |
| R4 | Registration not re-run: the hook's file list omits `writeActions.js`, `ownerConfirmation.js` and the new `commandSurface.js`; a failed register is only a WARNING | High | Extend `COMMAND_DEF_FILES` in the same PR, with a bats test; runbook step 4 verifies the registered set; the code pointer keeps a stale registration safe |
| R5 | Discord propagation or client caching delays | Low-Med (unverified) | Dispatch accepts both layouts; a pointer in either direction |
| R6 | Guild Integrations overrides on `/dune` do not apply to `/player` and `/goal` | Medium (cannot be checked from here) | Release note to guild admins; mentat gates unchanged |
| R7 | Name collision with other bots' `/player` or `/goal` in the same guild | Low | The picker shows the app name; OD1 offers namespaced names |
| R8 | The landing page shows wrong invocations | Medium | Additive `prefix`; mentat-link deploys first |
| R9 | Core in-game text points at old or wrong paths | Low | Core issue (Requirement 18); already stale today |
| R10 | Leftover guild-scoped registration keeps the old tree in one guild | Low-Med | Runbook checks both scopes |
| R11 | Code rollback leaves `/player` registered with no handler | Medium | Rollback by flag, not code revert (§8) |
| R12 | Textual conflicts with #435, #436, #384 and Phase 2 in `src/commands.js` | Medium | Sequence per §10; one worktree at a time (Requirement 16) |
| R13 | A future `/dune` group named `player` or `goal` collides with a top-level key | Low | Key-uniqueness test |
| R14 | Autocomplete routed too broadly (goal lookups on a legacy or other command) or too narrowly (no suggestions) | Medium | Explicit routing table (§5.5); autocomplete matrix tests |
| R15 | Self-hosting operators upgrade but never re-register (no deploy hook) | Medium | Release note; flag default stays `legacy` for one release; follow-up startup check comparing registered vs defined commands |
| R16 | Verbosity creep once budgets relax | Low | Per-command 7500 target stays enforced |

---

## 12. Documentation impact (Requirement 14)

Counts are references to moved paths (`/dune player|goal`, the 11 writes) found by grep.

| Doc | Refs | Change | When |
|---|---:|---|---|
| `docs/user-guide.md` | 39 | Rewrite the command-group section: three top-level commands; mapping table | Same PR as the flip |
| `docs/faq.md` | 19 | Update paths | Same PR |
| `docs/configuration.md` | 17 | Update paths; document `DUNE_COMMAND_LAYOUT` | Same PR |
| `docs/quick-start-guide.md` | 13 | Update paths | Same PR |
| `docs/admin-guide.md` | 4 | Moved writes; re-registration step; Integrations note | Same PR |
| `docs/troubleshooting.md` | 6 | Paths; "old `/dune player` still shows" (stale guild scope) entry | Same PR |
| `docs/architecture.md` | table | Write Capabilities table groups become `moderation`/`operations`; dispatch/routing description (the drift check validates names only, not groups) | Same PR |
| `docs/crafting-resource-planning-overview.md` | 0 direct | Mention `/goal` as the entry point | Same PR |
| `docs/steam-link-*.md` (5 files) | 36 | Update `/dune player link|verify` | Same PR (active references) |
| `docs/discord-setup.md` | | Propagation wording (`:224`) and the 4 commands | Same PR |
| `CHANGELOG.md`, `docs/changes/` | new | Breaking entry with mapping table | Same PR |
| Historical specs/plans (`superpowers/*`, `design/*`, `rw-*`, roadmap files) | about 70 | **Not rewritten:** they are dated historical records (same convention as `meta`'s README) | none |
| Phase 2 spec (#437) | | `/dune goal sync` becomes `/goal sync`, budget test wording | In #437 or the Phase 2 implementation |
| mentat-link `index.html`, `docs/index.html`, `CHANGELOG.md` | 34 | Static mock-ups and noscript fallback | mentat-link PR (before mentat) |
| `compliance/policies/data-classification.md` | 1 | Path | Same PR |

---

## 13. Open decisions for the operator

1. **OD1: names.** (a) `/player` + `/goal` (issue text; short; the key segment matches);
   (b) `/character` + `/goals`; (c) namespaced `/dune-player` + `/dune-goal` (no collisions, longer
   to type). **Recommendation: (a).**
2. **OD2: transition length.** (a) shims for one minor release or 30 days (whichever is later),
   code pointer for 90 days; (b) no registered shims (T0), code pointer only; (c) shims for 90
   days. **Recommendation: (a).**
3. **OD3: server lifecycle writes.** (a) move to `/dune operations` (audience-clean, #422 fully
   fixed); (b) keep them in `/dune server` (fewer breaks, #422 half fixed). **Recommendation: (a).**
4. **OD4: option.** B2 (recommended) or C (also adds `/mod` + `/admin`, breaks every privileged
   path; its Discord API acceptance of mixed subcommands and groups is unverified).
   **Recommendation: B2.** C can be done later.
5. **OD5: `/goal order` entry point.** (a) defer (product semantics undecided); (b) add now as
   `create` with `due-at` required. **Recommendation: (a).** The budget (196 chars) is not the
   blocker.
6. **OD6: calculator placement.** (a) stay in `/dune data`; (b) move to `/goal calculate`.
   **Recommendation: (a).**
7. **OD7: layout flag default.** (a) first release defaults to `legacy` (self-hosters opt in), the
   next flips to `split`; (b) flip immediately with the flag only as rollback. **Recommendation:
   (a) for self-hosters; the hosted bot flips as soon as runbook step 4 passes.**
8. **OD8: restore readable goal descriptions** ("Id." becomes "Goal id") now that `/goal` has room.
   **Recommendation: yes,** in the same PR, as text only.

---

## 14. Unverified items and uncertainty
- Discord global propagation time and client caching behaviour today; what a stale client shows
  when it invokes a deleted command.
- Whether any guild has Integrations permission overrides on `/dune` `[R6]`.
- The hosted bot's registration scope (whether `DISCORD_GUILD_ID` is set on the bot VM) and whether
  stale guild-scoped commands exist. The VM was not inspected.
- Discord's API acceptance of a top-level command mixing subcommands and groups (only matters for
  option C). Only discord.js 14.27's builder was checked.
- The budget function is the repo's own test function. Localizations are not counted, and none are
  used.
- Where the earlier review's 6124/1538/698 figures came from (§3.1).
- How `/dune` and `/player` rank in Discord's picker next to other bots' commands.

**How to reproduce the numbers:** import `commandDefinitions` and `WRITE_ACTIONS` on
`origin/main`, apply `discordCommandCharBudget` (from `test/commands.test.js`), and for each option
rearrange the registered JSON as described in §4 (groups moved or removed verbatim, headers as given
in §4). Shims are subcommands with no options and the description "Moved: use <new path>.".

## 15. Follow-up work (not part of this change)
1. Fix the dormant single-tenant `commandRoleIds` bare keys (`src/config.js:243-253`). This changes
   behaviour: it activates `DISCORD_*_ROLE_IDS`.
2. `write cache` help tier mismatch (owner vs admin), on PR #436 or a new issue.
3. Core issue: stale `/dune data verify` whisper and `/dune player unlink` error text (Requirement 18).
4. A startup check that compares registered commands (`client.application.commands.fetch()`) with
   `commandDefinitions()` and logs drift `[R15]`.
5. Use Discord command mentions (`</player whoami:ID>`) in pointer replies and help, so the new
   path is one click away.
6. Review the §3.3 classifications (logs, backups, soc/prometheus for any tier; `admin roles`
   placement; the storage/find `scope` description; mentat#433).
7. Remove the shims, the legacy layout and the flag at the end of the window (dated issue).
8. Optionally, option C later if a per-audience top-level split is still wanted.
