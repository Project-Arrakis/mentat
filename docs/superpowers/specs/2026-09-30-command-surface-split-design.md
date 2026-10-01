# Command Surface Split: `/dune` into `/dune` + `/player` + `/goal` (mentat#422 + mentat#423)

**Status:** Design **v2.1**. v2 was revised after the Requirement 20 Layer 1 (design) eight-hat audit;
v2.1 applies the Round 2 re-verification (register, "Round 2"; findings V2-1 … V2-9). No code.
Six operator decisions are open (§14) and three operator-only preconditions must be run before the
flip (§7.6).
**Date:** 2026-09-30 (v1), revised 2026-09-29 (v2 and v2.1; the file name keeps the v1 date).
**Base:** v1 was measured on `origin/main` `f8709f0` (PR #430). Requirement 29 freshness re-check,
2026-09-29: `origin/main` is `db3db83` (PR #435 merged), one commit later. Re-measured on
`db3db83`: `/dune` is still 7473, so every budget below holds on both SHAs. The implementation
must re-run this check before each PR (§13).
**Citation SHAs (V2-9):** `src/` and `test/` line numbers are at `db3db83` unless labelled. This
design branch is based on `f8709f0`, so a reader checking citations in its worktree must use
`git show db3db83:<file>`. Where the two SHAs differ, both are given.
**Tracking:** mentat#422 (audience mixing), mentat#423 (split `/dune`), roadmap mentat#432 (batch 3).
**Audit register:** `docs/superpowers/specs/2026-09-30-command-surface-split-layer1-audit-register.md`.
**Tags:** decisions are `[D#]`, risks are `[R#]`, open operator decisions are `OD#`, operator-only
preconditions are `P#`, consolidation rulings are `R-A` … `R-H`.

Every number in this document was measured from real code. Budgets use `discordCommandCharBudget()`
copied verbatim from `test/commands.test.js`, run over `commandDefinitions({ includeWriteGroup: true })`.
Options were simulated by rearranging the real registered JSON. Counts of references in files are
point-in-time (as of `f8709f0`/`db3db83`) and must be re-run before implementation (§15).

---

## 0. What changed from v1, and why

The Layer 1 audit produced 88 hat findings (2 Critical, 21 High, 37 Medium, 28 Low) and one
consolidator finding, merged into 19 clusters. The register lists every finding and where it is
resolved. The binding rulings:

| Ruling | Change | Sections |
|---|---|---|
| **R-A** | v1's "legacy paths reply with a pointer and never execute" is dropped. One `resolveInvocation()` computes the key for every entry, in both layouts. Old paths **alias-execute** through the same gates under the resolved new key. The flag controls only what is **registered** and **displayed**. A pointer reply is used only where an old path cannot execute. | §5.2, §5.3, §7.3, §7.4 |
| **R-B** | Re-registration is decided by a hash of the rendered command JSON, not a file list. Failures alert and retry. A startup registered-vs-defined drift check is a prerequisite for the flip. | §5.7, §7.2 |
| **R-C** | Rollout order: mentat-link first and verified live; feed and strings follow the **registered** layout; restart before register; both scopes verified; guild-scope cleanup; rollback rehearsed. | §7.7, §7.8 |
| **R-D** | Legacy tree frozen by a snapshot; subcommand definitions shared; 7500 target per layout; readable goal text and #384 after legacy removal. | §5.8, §4.4, §10 |
| **R-E** | Before-record generated once by a committed script in its own PR; regeneration forbidden in CI; hand-written audience table; literal move table; pinned axes. | §9 |
| **R-F** | Discord Integrations override loss is a release blocker for hosted guilds; `/player` and `/goal` guild-only; registration scope is an operator precondition. | §6.4, §7.6 |
| **R-G** | Key resolution and routing hardening; no schema change. | §5.2, §5.4, §5.6 |
| **R-H** | Audit evidence, versioning, documentation owners, PR sequencing, rollback, announcement, Requirements 28 and 29. | §7.8, §7.9, §8, §10, §12, §13 |

Doc-accuracy fixes: §6.4's claim that reading per-guild command permissions needs a user token is
withdrawn and marked UNVERIFIED (§6.4, P3); §3.3 item 8 is already fixed by PR #436 (`6d2275b`); the
deploy hook's failure message never prints (CONS-1, mentat#440); counts are dated.

**v2.1 (Round 2 re-verification):**
- V2-1: new rollout step 0 pins `legacy` in the hosted `.env` before PR-3 deploys, and the hook
  refuses an implicit change of registered layout (§7.2, §7.7).
- V2-2, V2-3: the DM, confirm-button and Steam-callback fallbacks to the process-default Core are
  recorded as pre-existing exceptions and tracked in **mentat#442** (§6.6, §9.10).
- V2-4: pointer cases 2 and 3 run after the gates (§5.3).
- V2-5: personal goals follow the user (§6.4, §6.6, §9.10).
- V2-6: OD6(b) delta (§14).
- V2-7: preconditions are gated on the hosted flip (§7.6).
- V2-8: drift comparisons use the real writes state (§7.2, §7.7).
- V2-9: before-record SHA and citation SHAs (§9.1, header).

---

## 1. Goal and non-goals

### 1.1 Goal
1. **The budget ceiling stops being a per-feature fight.** `/dune` is 7473 of Discord's hard 8000
   limit and the test target is 7500 (`test/commands.test.js:2214` at `db3db83`; `:1976` at `f8709f0`). The target has been
   re-baselined four times (7800 → 7975 → 7452 → 7500), and existing descriptions were trimmed each
   time (goal options are now "Id." and "Qty."). Phase 2's `goal sync` (+20) leaves 7. Draft PR #384's
   `admin service-setup` measures **360** chars, so `main` + #384 = **7833** (over target).
2. **Each command's audience is clear** (#422). `/dune player` holds 7 actions against other players;
   `/dune server` mixes 10 reads with 4 lifecycle writes.
3. **Player features are easier to find**: `/player` and `/goal` are top-level in the `/` picker.
4. **Existing users are not stranded**: old paths keep working (§5.3) while people re-learn.

Note on (1): because the legacy layout stays registrable until it is removed and the 7500 target
applies to both layouts (R-D), the budget relief for new `/dune` features arrives at legacy
removal, not at the flip (§5.8, §10).

### 1.2 Non-goals
- **No mentat authorization change.** No gate is loosened, tightened or reordered. The one
  deliberate Discord-level change is `contexts: [Guild]` on the two new commands (§6.4), which
  mentat's gates never relied on.
- **No changes to Core**, its `commandCatalog.js`, its action ids (`player.kick` and so on), or the
  `admin sync-commands` drift check (§5.9). Core text that names Mentat paths is handed over as
  Core#1087 (Requirement 18).
- **No schema change.** The split must not bump `SCHEMA_VERSION` or add a migration (it would
  collide with the main v8 / deploy v9 divergence, mentat#438).
- No new features in the split itself. `goal sync` belongs to Phase 2; `/order` (D14 v2.2) is a separate, later feature that this design only reserves the name and budget for.
- No `default_member_permissions` or `integration_types` change.
- No fix for the dormant single-tenant `commandRoleIds` keys: filed as mentat#439.

---

## 2. Background: how the surface works today (verified in code, `db3db83`)

| Fact | Where |
|---|---|
| `commandDefinitions()` returns `/dune` and `/confirm-connection`. | `src/commands.js:345-351`, `src/ownerConfirmation.js` |
| `/dune` is one `SlashCommandBuilder`: 9 read groups, plus 7 write groups when `includeWriteGroup` is true. `/dune` header: "Dune server operations and observability." | `src/commands.js:90-343` |
| Write subcommands are generated from `WRITE_ACTIONS`; `player` and `server` entries are merged into the read groups. | `src/commands.js:65-74, 125, 206, 332-340`; `src/writeActions.js:5-119` |
| Single dispatcher: returns `false` unless `isChatInputCommand()` and `commandName === "dune"`. Key = `group:subcommand`. | `src/commands.js:362-371` |
| Gate order: console registration (`core:setup` exempt), zero-role guild with owner bypass, `isCommandAllowed(key)` (`admin:roles` exempt), cooldown `${userId}:${key}`, `diagnostic` option needs admin, per-handler gates (`isAdminActor`, `canWrite(tier)` in `handleWriteCommand`, host-operator id for `bot:self-update`, `requireGuildGoalAccess`). | `src/commands.js:399-484, 761-779`; `src/writeHandler.js:103-220` |
| Embed selection branches mostly on the bare subcommand name; goal branches also check `group === "goal"`; the ops branch matches `OPS_SUBCOMMAND_NAMES.includes(subcommand)` with no group check. | `src/commands.js:740, 846-934` |
| Autocomplete is routed in `index.js` only for `commandName === "dune"` and bypasses `executeDuneCommand`'s gates; each handler re-derives scoping. After #435, goal `progress` autocomplete also calls `isCommandAllowed(…, "goal:progress", …)`. | `src/index.js:418-427`; `src/commands.js:1788` |
| Registration is one bulk `rest.put`, guild-scoped if `DISCORD_GUILD_ID` is set, else global. A bulk overwrite deletes absent commands. It does not log the command names or writes state. | `scripts/register-commands.js:9-16` |
| The deploy hook re-registers only if `src/commands.js` or `src/opsCommands.js` changed, after the restart. `npm run register` is piped into `tail -5` without `pipefail`, so **a failed registration is reported as success** and the WARNING branch is unreachable (CONS-1). | `scripts/deploy-post-receive.sh:54, 123-142`; `scripts/command-defs-changed.sh:24`; mentat#440 |
| `GET /api/commands` is `getCommandRegistry()`, a curated write-free list of `{group, title, commands[{name, desc, role}]}`, with no `Cache-Control` header. | `src/commands.js:2089-2213`; `src/setupServer.js:1202-1207` |
| mentat-link hardcodes `"/dune " + group.group + " " + cmd.name`. | `mentat-link/js/command-accordion.js:133` |
| `admin sync-commands` compares Core's catalog with `src/commands-registry.json`; it never reads the Discord tree. | `src/commands.js:2011-2076`; `src/registryLoader.js:215-234` |
| Pending write confirmations live in an in-memory `Map`, keyed by nonce, holding the Core action id; a restart drops them. | `src/writeConfirmation.js:31, 211-238` |

---

## 3. Current-state inventory (as of `f8709f0`; unchanged at `db3db83`)

### 3.1 Measured per-group cost (`includeWriteGroup: true`, total 7473/8000)

| Group | Total | Header | Subs | Write-merged cost inside |
|---|---:|---:|---:|---:|
| core | 203 | 29 | 4 | 0 |
| server | 758 | 42 | 14 | 173 (restart 31, stop 25, start 27, restart-service 90) |
| data | 883 | 34 | 4 | 0 (calculator alone = 723) |
| player | 1382 | 54 | 19 | 480 (kick 80, ban 58, unban 38, warn 91, give-item 103, clear-backpack 58, fill-water 52) |
| goal | 385 | 10 | 5 | 0 |
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

Writes disabled: `/dune` = 4577. `/confirm-connection` = 102. 101 subcommands: 64 read-only, 28
`WRITE_ACTIONS`, 9 legacy write stubs.

An earlier review quoted 6124 / 1538 / 698 for a whole-group split; those figures could not be
reproduced. The Architect hat independently re-measured B2 at 6230 / 898 / 404.

### 3.2 Audience of every subcommand, with evidence
Classes, from the real gates in multi-tenant mode: **public** (bypasses RBAC), **player** (any
configured tier, or anyone in open mode; `src/commands.js:1036-1062`), **moderator/admin/owner**
(per-action tier), **host-operator** (one configured user id).

| Group | Subcommand(s) | Audience | Evidence |
|---|---|---|---|
| core | about, ping, help | player | RBAC only |
| core | setup | player (console-registration exempt) | `:1035` |
| server | health, summary, readiness-detail, services, services-detail, maintenance, coriolis, atlas | player | `:520-543` |
| server | status, readiness | player; admin for `diagnostic` | `:480-484` |
| server | start, restart-service | admin | `writeActions.js:52,54` |
| server | restart, stop | owner | `writeActions.js:41,50` |
| data | population, backups, maps, calculator | player | `:545-554` |
| player | link, verify, characters, enable, disable, default, unlink, faction, whoami, inventory | player (self) | `:579-714` |
| player | storage, find | player (self); `scope: guild` via Core's guild route | `:715-733` |
| player | warn | moderator | `writeActions.js:18` |
| player | kick, ban, unban, fill-water | admin | `writeActions.js:8,12,16,30` |
| player | give-item, clear-backpack | owner | `writeActions.js:23,28` |
| goal | create, on-hand, delete | player (personal); admin for guild scope | `requireGuildGoalAccess` `:1300-1307` |
| goal | list, progress | player, including guild scope | `:1504-1581` |
| logs | all 7 | player | `:735-738` |
| ops | all 11 | player | `:740-759` |
| admin | doctor, sync-commands, cooldowns, latency, events | admin | `:761-779` |
| admin | roles | public | `RBAC_EXEMPT_COMMANDS` `:1021` |
| admin | broadcast | moderator | `src/broadcast.js:13-25` |
| infra | version, servers, ports, db | player | RBAC only |
| write | maintenance-note … remove-channel (8) | admin | `writeHandler.js:30-50` |
| write | cache | owner | `writeHandler.js:51` |
| base | refill-generators, refill-water | admin | `writeActions.js:34,36` |
| map | spawn, despawn, respawn, teleport | admin | `writeActions.js:59-67` |
| carepackage | grant, enable, disable, scan | admin | `writeActions.js:76-84` |
| carepackage | grant-all, history-clear | owner | `writeActions.js:78,86` |
| guild | add, remove | admin | `writeActions.js:90,95` |
| operations | create-backup, trigger-update | owner | `writeActions.js:101,103` |
| bot | self-update | host-operator | `writeActions.js:117`; `writeHandler.js:154-158` |

Single-tenant mode has no moderator tier; `canWrite` resolves any write role to admin
(`src/writes.js:89-93`). Unchanged by this design.

### 3.3 Ambiguous or questionable classifications (flagged, not changed here)
1. `admin roles` is public (#238) but sits in "admin"; the registry labels it `admin`.
2. `admin broadcast` is moderator tier inside `admin`.
3. `player warn` warns a whole map; moderator tier; moves with the other moderation actions.
4. `server status/readiness` carry an admin-only option on a player command (runtime-checked).
5. Goal create/on-hand/delete are player or admin depending on `scope`.
6. `player storage/find` describe a `scope` choice "all (admin)" that does not exist; see mentat#433.
7. Operator-leaning reads open to any tier: `logs *`, `data backups`, `ops soc`, `ops prometheus`,
   `infra *`. Product question, out of scope.
8. ~~`write cache` help tier mismatch in PR #436~~ **Resolved** in #436 head `6d2275b` ("Derive
   legacy write:* help entries from LEGACY_WRITE_STUBS so tiers cannot drift"). No follow-up.

---

## 4. Options

All budgets measured. Header texts are in §4.3.

| Option | Commands (chars / 8000) | Audience-clean? | Breaking for |
|---|---|---|---|
| **D** status quo | `/dune` 7473 | No | nobody |
| **A** `moderation` group inside `/dune` only | `/dune` 7517 | Yes | 11 write actions |
| **B1** whole-group split | 5706 / 1378 / 404 | **No** (`/player ban` top-level) | player and goal users |
| **B2** audience-clean split (**recommended**) | `/dune` **6230**, `/player` **898**, `/goal` **404** | Yes | player and goal users, plus 11 write actions |
| **C** split by audience | 2870 / 898 / 404 / `/mod` 604 / `/admin` 2754 | Yes, most | nearly every privileged command |

B2 with writes disabled: `/dune` 3290. With the two registered `moved` shims (§7.3): `/dune`
**6408** (v1 header texts) or **6469** (v2 header texts, §4.3).

### 4.1 What each option means for users
- **D.** No breakage; #384 cannot land; Phase 2 leaves 7 chars.
- **A.** Fixes #422, worsens #423 (+44).
- **B1.** Solves the budget but lists `ban` and `clear-backpack` in a command shown to everyone. Rejected.
- **B2.** Solves #422 and (after legacy removal) #423. Players re-learn two prefixes; moderators
  and admins re-learn 11 paths. Old paths keep working (§5.3), so re-learning is not forced.
- **C.** Breaks every privileged path; `/admin` would mix subcommands and groups (discord.js 14.27's
  builder accepts it; Discord API acceptance unverified). Its extra benefit (hide `/mod` per command
  in Integrations) relies on Discord permissions that mentat's tier model does not use.

### 4.2 Recommendation `[D1]`: Option B2 (OD4)
73 of 101 subcommands keep their exact path. C can follow later as an additive split (3-segment
keys, §5.2).

### 4.3 Placement decisions and texts under B2
- `[D2]` Top-level names `/player` and `/goal` (**OD1**; collision risk R7 is now Medium).
- `[D3]` The 7 actions against other players move to a new `/dune` group, working name
  **`moderation`** (**OD9**).
- `[D4]` The 4 server lifecycle writes move into `/dune operations` (**OD3**, **OD9**).
  `/dune server` becomes read-only.
- `[D13]` `/dune data calculator` placement is **OD6**; v2 recommends `/goal calculate` (§14).
- **Header texts (v2, full sentences, UX-9/14/16):**
  - `/dune`: "Server status, operations and staff tools. Players: see /player and /goal." (74)
  - `/player`: "Your Dune: Awakening character: link, inventory, storage." (57)
  - `/goal`: "Dune: Awakening personal and guild farming goals." (not yet measured; was 65 with "orders")
  - `/order`: "Guild orders: farming goals with a due date, tracked for the whole guild." (not yet measured)
  - `/dune moderation` (working name): "Staff actions on players: kick, ban, warn, items (moderator+)." (62)
  - Budget effect against v1's header texts (arithmetic with the budget function): `/dune` +61
    (header +33, `moderation` +28) → **6291**, or **6469** with the `moved` shims; `/player` +13 →
    911; `/goal` +40 → 444. The implementation PR's budget test is the authority.
- **Goal subcommand text (OD8):** readable texts ("Goal id", "Quantity", "Goals to list") are
  written into the **shared** goal adders only after legacy removal (R-D), because the legacy
  tree shares them. (Superseded by D14 v2.2: `due-at` leaves the goal adders, so `/goal create` no longer mentions orders.)

### 4.4 Goals, orders and Phase 2
- `[D14]` (**v2.2, operator decision 2026-10-01, replaces "an order is a goal with `due-at`"**):
  orders are their own top-level command, `/order`, with its own entity. Operator answers:
  1. `due-at` is **required** on create and **editable** afterwards.
  2. Orders are **guild-scoped only** (no personal orders). `owner_id` is always
     `interaction.guildId`, resolved from the interaction, never a parameter (isolated-tenant rule).
  3. A past-due open order is **marked overdue** (shown in `list` and `progress`) and the **guild
     leader is informed**. v1 default: leader = Discord guild owner (`guild.ownerId`, as
     `isGuildOwner()` already means); the notice is posted by the bot in the guild's own configured
     channel mentioning the owner, once per order (idempotent flag), never a DM and never through the
     process-default Core (mentat#442). Channel: **OD15, resolved 2026-10-01**: a per-guild
     "overdue-order notice channel" setting, **asked during bot setup** (setup wizard step, stored in
     the guild's own settings row, changeable later by admin). No hardcoded IDs in the repo.
  - Surface (like `/goal`): `/order create|on-hand|list|progress|edit|delete`. Gates follow guild
    goals (`admin` tier or Discord owner for writes, `requireGuildGoalAccess`); `/goal` becomes
    personal-and-guild farming goals without `due-at`.
  - Storage: new `orders` table or `kind` column on `goals`, plus `overdue_notified_at`. **Blocked
    on mentat#438** (no migration until schema v8/v9 is reconciled). **OD16, resolved 2026-10-01: no
    conversion.** The operator states no dated goals exist (orders are a new feature). The
    migration still asserts it: it counts goals with `due_at IS NOT NULL` and stops with a clear
    error if any exist, rather than assuming. The `goals.due_at` column stays (additive-only,
    Requirement 26) but `/goal` stops exposing `due-at`.
  - Budget: `/order` is a separate command definition with its own 8000 limit, so `/dune` stays
    7473/8000 and #423's budget pressure eases. Authorization keys: new `order:*` keys in the
    authorization record. **OD17, resolved 2026-10-01: yes**, live stock also applies to orders (key `order:sync`), with
    the stock source an **explicit guild-base designation in Core** (operator chose Option 2; the
    game data has no base-to-guild link, so it cannot be inferred). That is Phase 2c, a separate
    design plus a Core change filed per Requirement 18, so `/order sync` ships after `/order` itself.
    `/order`'s budget must include it then.
  - **Designation lives under `/player` (operator, 2026-10-01):** a player who is a guild leader can
    **view their bases** (`/player bases`) and **designate one as the guild base**
    (`/player guild-base`). With no designated base there is **no live-stock sync** for orders;
    `/order sync` says so and points at the designation. Defaults pending confirmation:
    **OD18** "guild leader" means the linked character is the **in-game guild leader** (Core's
    `guild_members` leader role, verified by Core, never trusted from the client), not the Discord
    guild owner; **OD19** only a base the leader **owns** (rank 1) can be designated; **OD20** one
    designation per Discord guild, re-designating replaces it, and it stops counting if the
    designator is no longer the in-game leader or no longer owns that base. The designation is
    stored in Core and applies only to the Discord guild where the command ran
    (`interaction.guildId`, no guild parameter). This is a **write** path (signed actor, per-guild
    secret, audited), so it is part of the 2c design and its audit, not a quick add. `/player` budget
    (911) has room, to be re-measured.
  - Scheduler: overdue detection reuses the existing scheduler (`src/scheduler.js`); needs its own
    Layer 1 note (cadence, restart safety, guild without a channel).
- **FAQ:** "How do I place an order?" answers `/order create`.

- **Phase 2's `goal sync`** keeps key `goal:sync` (§5.2). It lives in the shared goal adders, so it
  appears in both layouts: legacy `/dune` **7473 + 20 = 7493** (7 below target), split `/goal` 424.
  This is the only pre-approved change to the frozen legacy tree (§5.8). If Phase 2 ships first,
  `/dune` is 7493 until the flip; either order works.

---

## 5. Code structure

### 5.1 One declarative surface map `[D16]` (layout-aware)
New `src/commandSurface.js`, the single source of truth for where each logical group is invoked,
per layout:

```
SURFACE = Map(topLevelCommand -> descriptor)          // keyed by the Discord command name
  "dune"               -> { groups: Map(rawGroup -> logicalGroup) }
  "player"             -> { logicalGroup: "player" }  // direct subcommands
  "goal"               -> { logicalGroup: "goal" }
  "confirm-connection" -> { handler: "external" }     // routed in index.js, listed for totality

INVOCATION[layout][logicalGroup] -> prefix string
  split:  player -> "/player",      goal -> "/goal",      moderation -> "/dune moderation", ...
  legacy: player -> "/dune player", goal -> "/dune goal", moderation(kick…) -> "/dune player", ...

LEGACY_MOVES = literal table of 28 entries (29 under OD6(b), §14):
  17 prefix moves  ("dune","player",X) -> ("player", X)   and   ("dune","goal",X) -> ("goal", X)
  11 path moves    ("dune","player","kick") -> ("moderation","kick") x7
                   ("dune","server","restart") -> ("operations","restart") x4
```

`invocationFor(key, layout)` returns the user-facing string. **`layout` is the registered layout**
(§7.2), falling back to the configured layout when the registered one is unknown. Help, the public
feed, error strings (the 48 `/dune player|goal` references in `src/`, including
`steamLinkServer.js:238-497`, `embedFormat.js:403, 530, 547, 583, 1847`, `commands.js:1318, 1440`),
pointer replies and Phase 2's new strings all use it.

### 5.2 Keys and the single resolver `[D5]` (R-A, R-G)
- **Logical group** = the `/dune` subcommand group, or the top-level name for `/player`/`/goal`.
- **Key** = `${logicalGroup}:${subcommand}`. A future non-`dune` command with its own groups uses
  `${command}:${group}:${subcommand}` (3 segments, never equal to a 2-segment key).
- `resolveInvocation(interaction) -> { logicalGroup, subcommand, key, legacy: bool, route }` is the
  **only** place a key is computed. It looks up `(commandName, rawGroup, sub)` in `SURFACE` and
  `LEGACY_MOVES` (both `Map`s), so `/dune player kick` resolves to `moderation:kick` and
  `/dune player whoami` to `player:whoami`, **in every layout**. Dispatcher, autocomplete router,
  `helpPayload`, the test harness and the pointer all call it. Every gate (`isCommandAllowed`,
  cooldown, `forcedPublic` at `:502`, `findWriteAction` in `handleWriteCommand`) receives the
  resolved key and logical group, never the raw Discord group.
- Keys unchanged for 90 of 101 subcommands (89 under OD6(b), §14); only the 11 moved writes change key (`player:kick` →
  `moderation:kick` x7, `server:restart` → `operations:restart` x4). `WRITE_ACTIONS[].group` changes
  for exactly those 11. **Core action ids do not change**, so audit events, Core routes and
  `write/preview` payloads are untouched. Because the legacy path resolves to the same key as the new
  path, there is one cooldown key and one RBAC key per action (SEC-4).
- Tested (§9.4): `resolveInvocation` is total over every registered path in {legacy, split} ×
  {writes on, off} plus the shims, and the only aliases are the 28 in the literal move table.

### 5.3 Dispatch: alias-execute, pointer only where execution is impossible (R-A)
- `executeDuneCommand` becomes `executeSlashCommand` (old name kept as an alias). Guard:
  `interaction.isChatInputCommand()` **and** `SURFACE.has(commandName)`; `confirm-connection` stays
  routed first in `index.js`.
- **Every registered or stale path executes** through the unchanged gate chain under the resolved
  key. A stale client sending `/dune player inventory` or `/dune player ban target:… reason:…` after
  the flip runs `/player inventory` or `/dune moderation ban` with the same gates, tier, cooldown and
  confirmation as the new path. Discord validated the options against the schema the client had,
  which is the same option set (option parity is pinned, §9.2).
- **Pointer replies are used only in these cases:**
  1. The registered **`moved` shim** subcommands (§7.3). The name `moved` is never a real
     subcommand; a test asserts it, so a shim can never be mistaken for, or alias to, an executable
     path in any layout (fixes SEC-1).
  2. A legacy-path interaction that arrives **without a required option** of the target
     subcommand (checked against the real definition). Not expected from Discord; defensive.
  3. A legacy path whose target is **not registered** under the current writes setting (for
     example a moved write when `includeWriteGroup` is false): same reply as today's writes-disabled
     path, plus the pointer text.
- **Where each pointer runs (V2-4):**
  - Case 1 (the `moved` shim) runs right after `resolveInvocation`, before any gate. It reveals only
    public command names.
  - Cases 2 and 3 run **after** the console-registration, zero-role and RBAC gates
    (`src/commands.js:399-470`), at the point where today's handler would reject. Unregistered and
    RBAC-denied callers therefore keep their before-record class (`not-connected`, `zero-role`,
    `rbac-denied`). They do not learn that writes are disabled. Case 3 runs where today's
    writes-disabled reply comes from (`src/writeHandler.js:104-105`, after the cooldown gate), so its
    before-record class is unchanged; only the reply text gains the pointer.
- **Pointer purity:** no pointer reads the adapter, the DB (beyond the gates that already run before
  it), a confirmation, `incrementCommandCount`, or any option value beyond presence checks. The shim
  (case 1) consumes no cooldown. Its text comes
  only from the literal move table (unknown names get the generic "moved to `/player`" text). A spy
  test pins all of this (§9.5). It reveals only public command names.
- Embed selection and branches use the resolved logical group and key (§5.6), so `/goal` embeds
  cannot fall back to the generic formatter (R2).

### 5.4 Stored state: nothing to migrate (R-G, DBA)
- `SCHEMA` has no command, group or key column (`guild_roles` stores tiers; `guild_settings` has no
  per-command column; `goal_audit_log.action` is a domain verb; `live_messages.message_key` is a
  feature enum). **The split must not bump `SCHEMA_VERSION` or add a migration** (mentat#438).
- Cooldowns (`src/cooldown.js:5`) and pending write confirmations (`src/writeConfirmation.js:31`)
  are in-memory `Map`s, cleared on restart; confirmations are keyed by nonce and hold Core action
  ids, which do not change. No confirmation can cross a layout change.
- Single-tenant `commandRoleIds` (`src/config.js:243-253`) uses bare keys that never match
  (mentat#439). None of the 9 affected keys moves.
- `[D6]` Operator-facing config is unchanged except the new `DUNE_COMMAND_LAYOUT` (§5.7).

### 5.5 Autocomplete: one exported router (R-A, QA-5)
`routeAutocomplete(interaction, db)` is extracted from `index.js:418-427`, exported, and routes on
`resolveInvocation`'s logical group:

| Resolved | Handler | Its own gate (unchanged) |
|---|---|---|
| `data:calculator` (or `goal:calculate` if OD6 moves it; matched by **key, before** the `goal` group row) | `handleCalculatorAutocomplete` | none needed (static recipe data) |
| logical group `goal` (from `/goal …` **or** legacy `/dune goal …`) | `handleGoalAutocomplete(interaction, db)` | personal by `owner_id`; guild goals only via `isAdminActor` (on-hand/delete) or `isCommandAllowed("goal:progress")` (progress, #435, `src/commands.js:1788`); `db` null → `[]` |
| a `moved` shim | respond `[]` | shims have no options |
| anything else | respond `[]` once | |

Legacy `/dune goal` keeps its suggestions in the legacy layout (v1's `[]` regression is gone).
`getSubcommandGroup()` is called with its default (`required=false`), which returns `null` for
`/goal` (discord.js `CommandInteractionOptionResolver.js:123-127`).

### 5.6 Routing hardening (R-G)
- The ops branch requires `logicalGroup === "ops"` (today `src/commands.js:740` has no group check).
- The embed chain on bare subcommand names (`:846-934`) becomes a key-indexed `FORMATTERS` `Map`
  with the generic formatter as fallback.
- All caller-derived lookups (`SURFACE`, `LEGACY_MOVES`, `FORMATTERS`, `commandRoleIds`) use `Map`
  or `Object.hasOwn`.
- Structure test: every registered key reaches exactly one dispatch branch and one formatter, and
  no bare-name match crosses logical groups (route id returned from dispatch, §9.4).

### 5.7 Layout flag (R-B)
- `DUNE_COMMAND_LAYOUT=legacy|split`, parsed in `loadConfig` as a strict enum like
  `parseRbacMode` (`src/config.js:473-476`): unset → the release default (§8, OD7); any other value
  throws at startup. Not a secret; safe to log. Must live in the `.env` the hook sources, not in a
  systemd drop-in.
- Passed explicitly: `commandDefinitions({ includeWriteGroup, layout })`. The builder never reads
  `process.env`, so tests build both layouts in one run. `register-commands.js` and the bot both
  read it through `loadConfig`.
- Logged at startup and at registration, with the registered groups, and shown in `admin doctor`.
- **The flag is global, never per guild.** It is one process-wide value that selects the one tree
  registered globally for every guild (§6.6). There is no per-guild layout, and none may be added in
  this change.

### 5.8 Shared definitions and the frozen legacy tree (R-D)
- Player and goal subcommands are built by shared adders `addPlayerSubcommands(parent)` and
  `addGoalSubcommands(parent)`, mounted on the top-level builder (split) or on a group (legacy).
  The 11 moved writes use the same `addWriteSubcommands` either way.
- **The legacy tree is frozen:** a committed JSON snapshot of today's `commandDefinitions()` (writes
  on and off, taken at the before-record SHA, §9.1) must deep-equal
  `commandDefinitions({ layout: "legacy" })`. The only pre-approved difference is Phase 2's
  `goal sync` (+20, legacy 7493). Any other difference fails CI.
- **Budget test per command and per layout:** each registered command ≤ 7500 target and < 8000 hard
  limit, in both layouts, shims included. Today: legacy `/dune` 7473 (7493 with `goal sync`), split
  `/dune` 6469 with shims and v2 header texts.
- Consequences: OD8's readable goal text and PR #384 (360 chars; legacy would be 7833) land **after**
  legacy removal (§10).

### 5.9 What does not change
Core, `commandCatalog.js`, `src/commands-registry.json`, `diffRegistries` and `admin sync-commands`,
write confirmation buttons (nonce), `/confirm-connection`, `WRITE_ACTIONS` action ids and params,
the invite scopes and permission integer.

### 5.10 Files touched, and existing tests that will break
Source: `src/commands.js`, new `src/commandSurface.js`, `src/writeActions.js` (11 `group` values),
`src/index.js` (routers), `src/embedFormat.js`, `src/steamLinkServer.js`, `src/config.js`
(layout parse), `scripts/register-commands.js` (logging, layout), the deploy hook (via mentat#440),
`.env.example`. mentat-link: `js/command-accordion.js`, `index.html`, `docs/index.html`.

Tests that break outright and must change **only with a before-record row as justification**
(QA-9, ARCH-9):
1. `test/commands.test.js:64` group-name list (includes `goal`, `player`; gains `moderation`).
2. `test/commands.test.js` write-merge test (`registeredGroups.get("player")`, `findWriteAction("player","kick")`).
3. `test/commands.test.js:1970-1976` at `f8709f0` (the test ending at `:2214` at `db3db83`) single `/dune` budget test → per command and per layout.
4. `test/writeActions.test.js:73-86` group collision; `test/writeHandler.test.js:349, 376, 502, 516, 520` pass `group: "player"` for kick/warn/give-item.
5. PR #436's `test/helpWriteVisibility.test.js`: merged-group list `["player","server"]` (`:91`), the tree walk that assumes group→subcommand nesting, and the `commandRoleIds` override `{"player:kick": …}` (`:140`), which must become `moderation:kick` or it silently stops testing.
6. `test/discord-bot-test-harness.js:82-118` ("registers all 25 slash commands"), which reads top-level options as groups.
7. `test/userGuideDrift.test.js`: parses only `/dune <g> <s>`; must parse every top-level command via the surface map and exempt the mapping table by a fenced marker.
8. `test/commandRegistryContract.test.js` ("public group corresponds to a real group"; `prefix`).
9. Literal strings in `test/embedFormat.test.js`, `test/adapterClient.test.js`, `test/commands.test.js`.
10. `test/deploy-hook.bats` fixtures for `COMMAND_DEF_FILES` (replaced by the hash, #440).
11. `test/goalAutocomplete.test.js:19`, `test/calculatorAutocomplete.test.js:9`, `test/embedFormatRegression.test.js:152, 182, 202`, `test/syncCommands.integration.test.js:51`, `test/fixtures/mockInteraction.js`, and the local `mockInteraction` in `test/commands.test.js:38-62` (all hardcode `commandName: "dune"`).

---

## 6. Security and RBAC

### 6.1 Invariant
For every (caller × context × mode × command), the authorization outcome after the change equals
the before-record, where "before" uses the old path and "after" uses both the new path and the old
path (which now alias-executes). No gate is weakened, reordered or bypassed.

### 6.2 Why the design preserves it structurally
- 90 of 101 keys are unchanged (89 under OD6(b)); the 11 moved writes change key but their gate is the tier carried
  in the `WRITE_ACTIONS` entry (`writeHandler.js:143, 176`), and multi-tenant `isCommandAllowed` is
  not key-sensitive (`src/commands.js:1041-1049`).
- Old and new paths resolve to the same key before any gate (§5.2), so there is one RBAC key and one
  cooldown key per action.
- Confirmations are nonce-keyed, requester-bound and in memory (§5.4). `bot self-update` stays
  under `/dune bot`.
- Pointers are pure and only on non-executable shapes (§5.3).

### 6.3 Tested invariants (R-F)
- **Privileged writes stay under `/dune`:** every `WRITE_ACTIONS` entry, every legacy write stub
  and every `admin:*` diagnostic is registered under `/dune` in both layouts. This keeps any
  Discord-side restriction a guild put on `/dune` covering all privileged actions, and must not be
  lost silently if option C is taken later.
- `/player` and `/goal` register no write action.

### 6.4 Discord-level permissions and contexts `[D11]` (R-F, SEC-2, CLOUD-2/4/6)
- **`default_member_permissions` stays unset** on every command: mentat's tiers come from role
  mapping, and a Discord permission would lock out role-mapped admins.
- **`contexts` (DM exposure):** today no command sets `contexts`/`dm_permission`, so every command is
  usable in bot DMs and private channels. `/player` and `/goal` are guild features: character links
  resolve through the guild's own Core, guild goals belong to the guild, and multi-tenant gates need
  a `guildId`. **Personal goals are not per guild** (V2-5). `goals` has no guild column
  (`src/database.js:153-175`), and personal goals are keyed on the user id only
  (`listGoalsByOwner`/`getGoalScoped`, `:1319-1328`), so a user sees the same personal goals in every
  guild. That is intended and unchanged. v2 sets **`contexts: [Guild]`** on `/player`
  and `/goal`. `/dune` is unchanged in this change. The before-record includes DM rows (§9.3); if it
  shows any `/dune player|goal` path that succeeds in a DM today for a real caller (for example a
  `DISCORD_ALLOWED_USER_IDS` user, or any user with `DISCORD_RBAC_MODE=open`), that is a reason to
  revisit before PR-3 merges, and the finding goes to #423. In multi-tenant mode such a DM reaches the
  process-default Core today; that pre-existing gap is tracked in mentat#442 (§6.6 item 5).
- **Integrations overrides (release blocker for hosted guilds):** per-command overrides a guild
  admin set on `/dune` do not apply to the new `/player` and `/goal` ids, so a guild that limited
  `/dune` to a role or channel would see `/player`/`/goal` open to everyone its default allows.
  mentat's own gates still apply, but the combined policy widens (`rbac_mode=open` guilds most).
  Before the hosted flip: enumerate guilds that have a **`/dune`-specific** override entry (an entry
  whose id is the application id is the app-wide default and does carry over), and notify their
  owners through the existing owner-DM path. **Whether the bot token can read
  `GET /applications/{app}/guilds/{guild}/commands/permissions` is UNVERIFIED** (the Security hat
  says yes per Discord's permissions-v2 model; the Cloud hat and v1 said a user token is needed). It
  is precondition **P3** (§7.6). If the read is not possible with the bot token, the fallback is to
  notify every hosted guild owner before the flip.
- Per-guild Integrations overrides are **per-guild Discord state**. The split neither reads nor
  copies one guild's overrides into another; each guild owner re-applies their own (§7.9).
- **No credential change:** no new OAuth scope, permission integer, token or redirect URI; the
  existing `bot applications.commands` invite covers new top-level commands; installed guilds need
  no re-authorization.

### 6.5 Public feed (R-C, NET-2/3/7, UX-12)
- `getCommandRegistry()` stays write-free; `moderation` is write-only and must not appear.
- Each group gains an additive `prefix` built by `invocationFor` from the **registered** layout, and,
  during the transition window, a `formerly` field ("/dune player").
- mentat-link renders `prefix` only if `typeof prefix === "string"` and it matches
  `^/[a-z-]+( [a-z-]+)?$`, else falls back to `"/dune " + group`; a contract test covers absent,
  empty and non-string values; each group renders inside its own try/catch.
- `/api/commands` sends `Cache-Control: no-cache` (test asserts no long-lived cache header), so the
  cut-over is not frozen by a future cache rule. Browser heuristics (minutes) are the expected worst
  case.
- The feed describes the **hosted** bot. The site and docs say so, with a line for self-hosters
  still on the legacy layout (see OD7).

---

### 6.6 Tenant isolation invariant (operator requirement, binding)
The bot is multi-tenant. Each Discord guild is a separate tenant bound to its own row in `guilds`:
its own encrypted `adapter_token` and its own Core `console_url` (`src/database.js:19-20, 519-549`).
There is one shared `DISCORD_BOT_TOKEN` (`src/config.js:212`); tenant isolation is the per-guild
row, not a per-guild Discord identity. **Guild A must not and cannot run any command against
guild B. There are no cross-guild commands.**

The split must preserve this exactly:
1. **No new tenant selector.** The split adds no command, option, autocomplete path, shim or
   pointer that takes a Discord guild or tenant id, and nothing it adds resolves tenant state
   (guild row, `adapter_token`, `console_url`, guild settings, guild roles, guild goals) from anything
   but `interaction.guildId`. Personal goals are user state rather than tenant state: they are keyed
   on `interaction.user.id` and are the same in every guild (§6.4, V2-5). Only guild goals are tenant
   state.
2. **Guild resolution is unchanged** for the moved commands and for `/player` and `/goal`: every
   handler receives the guild from the interaction exactly as today (`src/commands.js:372` onwards,
   `AdapterClient._resolveConfig(guildId)` at `src/adapterClient.js:277-283`). Alias-executed legacy
   paths go through the same code, so they resolve the same guild.
3. **Existing options that look similar are not tenant selectors**, and stay allowlisted by name with
   this reason: `/dune guild add|remove` `guild-id` is an **in-game** Dune guild id sent to the
   invoking tenant's own Core (`src/writeActions.js:88-97`); the `scope: guild` choice on
   `player storage|find` and the goal commands means "the invoking Discord guild", never another one.
4. **Commands are identical for every guild.** Registration is one global tree, the same for all
   guilds (§7.1). A per-guild command set (for example operator-guild-only commands) would need
   guild-scope registration and a separate design; it is **explicitly out of scope**.
5. Existing behaviour recorded, not changed. When there is no active row, `_resolveConfig` falls back
   to the process config (`src/adapterClient.js:277-283`, `src/index.js:163-176`). For **guild slash
   commands**, the console-registration gate stops an unregistered guild before any adapter call
   (`not-connected`, §9.3), and the before-record pins this. `core:setup` is exempt but makes no
   adapter call.

   **Three pre-existing paths reach the process-default Core without an active tenant row** (V2-2,
   V2-3). They are not introduced or widened by the split, and are tracked for a fix in
   **mentat#442 (High)**:
   - **(a) DMs.** `guildId` is null, so the registration gate (`:399`) and the zero-role gate
     (`:449`) are skipped, and `isCommandAllowed` falls through to single-tenant RBAC
     (`:1041, 1053-1058`). With `DISCORD_RBAC_MODE=open`, or a user in `DISCORD_ALLOWED_USER_IDS`,
     a DM of `/dune server status` (or an alias-executed `/dune player …`) reaches
     `DUNE_CONSOLE_API_URL`.
   - **(b) The write-confirm button.** It calls `writeExecute(…, interaction.guildId)`
     (`src/writeConfirmation.js:290`), and neither the guild status nor the console binding is
     re-checked at the click. Core rejects a nonce it did not issue (410), so the effect is a
     misdirected request, not an execution.
   - **(c) The Steam-link callback.** It calls the adapter with `session.guildId`
     (`src/steamLinkServer.js:363-365, 485`) and does not re-check the guild status.

   The split does not rely on them, and it narrows (a) for the new commands: `/player` and `/goal`
   carry `contexts: [Guild]`. §9.10 asserts today's behaviour for (a)–(c), marked with #442, so the
   fixture neither passes vacuously nor blocks the split. Whichever of PR-3 and the #442 fix lands
   second flips those rows to "zero adapter calls".

Tests: §9.10.

## 7. Registration and migration

### 7.1 How registration works here
- `npm run register` makes one bulk `PUT` to one scope (guild if `DISCORD_GUILD_ID` is set, else
  global). It replaces that scope's whole set; same-named commands keep their id. It never touches
  the other scope, so a guild-scope copy survives a global PUT (`docs/troubleshooting.md:124`).
- Propagation: `docs/discord-setup.md:224` says up to an hour for global commands; current behaviour
  is believed faster, and clients cache the list. UNVERIFIED; measured in UAT (§9.9).
- `admin sync-commands` is unrelated (read-only Core-catalog drift check).

### 7.2 Registration decided by content, failures loud, drift detected (R-B; prerequisite mentat#440)
1. At deploy, render `JSON.stringify(commandDefinitions({ includeWriteGroup, layout }))` under the
   deployed `.env`, hash it, compare with the hash stored after the last **successful** PUT, and
   register on any difference. This covers every source file and every env value that feeds the
   tree (writes flag, layout), so no file list can rot.
   **Layout guard (V2-1):** the hook refuses to register a tree whose layout differs from the last
   successfully registered layout unless `DUNE_COMMAND_LAYOUT` is set **explicitly** in the sourced
   `.env`. A code-default change alone never flips a deployment's registered layout. It alerts like a
   failed register instead. This is part of PR-0 (mentat#440).
2. Detect failure correctly (`pipefail` or an explicit status check, CONS-1); retry once; on a second
   failure raise the ops alert (the existing Discord ops webhook) and exit the hook non-zero after the
   restart.
3. `register-commands.js` logs scope, layout, writes state, top-level commands and `/dune` groups.
4. **Startup drift check (in scope, prerequisite for the flip):** at `ready`, fetch the registered
   set for the bot's scope (`client.application.commands.fetch()`, or the guild scope when
   `DISCORD_GUILD_ID` is set), compare with
   `commandDefinitions({ includeWriteGroup: writesEnabled(config), layout })` for the bot's own resolved
   layout (the defaults would give `includeWriteGroup=false` and report false drift on a bot with
   writes on, V2-8),
   log `error` on any difference, and derive the **registered layout** (`split` if `/player` is
   registered, `legacy` if `/dune` has a real `player` group, else `unknown`). `invocationFor`, help
   and the feed use the registered layout; `unknown` falls back to the configured layout. The check
   never blocks startup.
5. Tests: the hash decision (bats), a failing register (bats), and an import-graph test that the
   hash input (`commandDefinitions`) covers every module it imports (§9.8).

### 7.3 Transition shims (replaces v1's T1)
- In the **split** layout, `/dune` additionally registers two deprecated groups, each with one
  option-less subcommand named `moved`:
  - `/dune player` "Moved to /player. Moderation moved to /dune moderation." → `moved` "Use /player
    instead. This entry runs nothing." (111 chars)
  - `/dune goal` "Moved to /goal." → `moved` "Use /goal instead. This entry runs nothing." (67 chars)
  - Total +178: split `/dune` 6230 → **6408** (6291 → **6469** with the v2 header texts).
- No per-subcommand shims (v1's 1075-char T1 is dropped): old full paths still **execute** for stale
  clients (§5.3), and the picker shows one clearly deprecated entry per old group instead of 19
  "Moved" entries (UX-4). No shim is registered for the 4 moved server writes (`/dune server` stays a
  real read group); staff learn them from the announcement and help.
- In the **legacy** layout, the frozen old tree is registered; `/player` and `/goal` are not.
- The release note states that during the window the picker shows `/dune player moved` and
  `/dune goal moved` next to `/player` and `/goal`.

### 7.4 Pointer text (UX-1, UX-2, UX-5, UX-16)
Ephemeral plain text (no colour or emoji dependence), full sentences:
- **`moved` shim, player:** "`/dune player` has moved. Your commands are now under </player …>
  (for example </player whoami:ID>). Staff actions on other players are under
  </dune moderation …>. Nothing was run. If you still see old commands, reload Discord (Ctrl+R on
  desktop; restart the app on mobile)."
- **`moved` shim, goal:** same pattern with </goal …>.
- **Legacy path missing a required option (case 2):** "`/dune player link` is now `/player link`.
  Nothing was run. Try: `/player link character:<name>`" — typed option values are echoed as a
  copy-pasteable line (never secret-bearing options; none exist on these commands today).
- **Moved write not available (case 3):** "`/dune player ban` is now `/dune moderation ban`, and write
  commands are disabled on this bot. Nothing was run."
- **Link/verify flow (UX-17):** the pointer for `link`/`verify` adds "If you have a link page open,
  continue there; then use </player verify:ID>."
- **Clickable mentions** (`</player whoami:ID>`) ship in the same PR as the pointer and help,
  using ids from the startup fetch (§7.2 item 4); if an id is unknown, fall back to the code-text
  form.

### 7.5 What users see; help layout (UX-11, UX-14)
1. The picker shows `/dune`, `/player`, `/goal` (and `/confirm-connection`), plus the two `moved`
   entries during the window.
2. Stale clients keep working (alias-execute).
3. Help (`/dune core help`) is ordered by audience: "Your character" (`/player`), "Goals"
   (`/goal`), "Server info" (`/dune …` reads), then staff sections classified as in #436. A
   "Moved recently" block lists the 17 prefixes and 11 paths during the window. All strings come
   from `invocationFor` with the registered layout.
4. `/dune`'s header says it is the server/staff surface (§4.3), so players are pointed to `/player`
   and `/goal` from the picker itself. Moving `admin roles` to `core` is a follow-up (§16).

### 7.6 Operator-only preconditions (R-F, NET-4, SEC-2, CLOUD-5)
These need the hosted bot VM (see the `meta` Live Systems section) or the bot token and are run by the
operator (or a session the operator authorizes), read-only, and recorded as a comment on #423
**before the hosted flip (§7.7 step 5)**. That flip is an env change in either OD7 outcome; PR-6
exists only if OD7 = a (V2-7). Put the token in a shell variable, never inline.

- **P1 registration scope and fallback exposure.** On the VM:
  `grep -E '^(DISCORD_GUILD_ID|DISCORD_CLIENT_ID|DUNE_DISCORD_WRITES_ENABLED|DUNE_COMMAND_LAYOUT|DUNE_CONSOLE_API_URL|DISCORD_RBAC_MODE|DISCORD_ALLOWED_USER_IDS)=' ~/arrakis-control-panel/.env`
  (the deploy target's working copy named by the hook). Also check whether
  `DUNE_DISCORD_ADAPTER_TOKEN` or `_FILE` is set; record set or unset only, never the value.
  `DUNE_CONSOLE_API_URL`, `DISCORD_RBAC_MODE` and `DISCORD_ALLOWED_USER_IDS` decide whether the
  mentat#442 DM fallback is live on the hosted bot (V2-2). Record the result on #442 as well. Then with
  `TOKEN` = `DISCORD_BOT_TOKEN` (or the file named by `DISCORD_BOT_TOKEN_FILE`) and `APP` =
  `DISCORD_CLIENT_ID`:
  `curl -s -H "Authorization: Bot $TOKEN" https://discord.com/api/v10/applications/$APP/commands | jq -r '.[].name'`.
  Expected for a multi-tenant hosted bot: `DISCORD_GUILD_ID` unset, global set = `dune`,
  `confirm-connection`. **If `DISCORD_GUILD_ID` is set on the hosted bot, the rollout plan changes**
  (a guild-scoped registration reaches one guild only) and this design must be revisited first.
- **P2 stale guild-scope copies.** For each guild in `GET /users/@me/guilds` (same token):
  `GET /applications/$APP/guilds/$GID/commands` must return `[]`. Any non-empty result is cleaned
  with an explicit empty `PUT` before the flip.
- **P3 reading Integrations overrides.** On dune-dev's guild first:
  `GET /applications/$APP/guilds/$GID/commands/permissions` with the bot token. If it returns 200,
  run it for every hosted guild and list the guilds with an entry whose `id` equals `/dune`'s
  command id; notify those owners. If it returns 401/403, record that, and notify every hosted guild
  owner instead. Either way the notification is sent before the hosted flip (release blocker).

### 7.7 Rollout runbook (R-C)
0. **Pin the hosted layout (V2-1).** Before PR-3 deploys, set `DUNE_COMMAND_LAYOUT=legacy` explicitly
   in the hosted `.env`, whichever way OD7 is decided, and record the `grep` on #423. Under OD7(b),
   the code default is `split` from rc.6. Without this pin, the PR-3 deploy would register `split`
   globally before P1–P3, the P3 owner notification (a release blocker), the rollback rehearsal and
   the announcement. The hook's layout guard (§7.2 item 1) is the second line of defence.
1. Merge prerequisites: mentat#440 (hash registration, failure alerting, drift check), PR #436.
2. Merge the mentat-link PR (layout-agnostic `prefix`/`formerly` rendering). **Verify it is live on
   Pages** (fetch the deployed `js/command-accordion.js` and confirm the `prefix` branch) before any
   bot change that alters the feed.
3. Deploy the bot code (PR-3). **With OD7(a)** (code default `legacy`) or **OD7(b)** (code default
   `split`), the hosted bot runs `legacy` because of step 0. The registered tree is byte-identical to
   today (snapshot test), the hook's hash is unchanged, so no PUT happens, and the feed still reports
   `/dune player` because the registered layout is legacy. Self-hosters who deploy PR-3 without the
   variable get the code default. Under OD7(b) that is `split`, and the hook's layout guard refuses
   the change until they set the variable explicitly (release note, §7.9).
4. Run P1–P3 and record them on #423.
5. Hosted flip: set `DUNE_COMMAND_LAYOUT=split` in `.env`, **restart first** (the dispatcher accepts
   both layouts, so no window without a handler), **then register** (the hook's hash detects the
   change; a manual `npm run register` is equivalent). Expected registrations during rollout plus
   rollback rehearsal: at most 4 global PUTs.
6. Verify, both scopes: `scripts/verify-registered-commands.js` (new, §9.9) compares global **and**
   each guild scope with `commandDefinitions({ includeWriteGroup: writesEnabled(config), layout })`
   (V2-8) and exits non-zero on drift; expect exactly `dune`,
   `player`, `goal`, `confirm-connection` globally and `[]` per guild; `moderation` present when
   writes are on. The startup log shows `registeredLayout=split`.
7. Functional check in **dune-dev's guild and one non-dev hosted guild**: one new path and one old
   path as owner and as a Player-tier member; one `moved` shim; `/api/commands` shows split
   prefixes. Confirm the non-dev guild's replies come from its own Core (§6.6).
8. Clean up any guild-scope copy created during UAT with an explicit empty `PUT` to that guild scope
   (CLOUD-5).
9. Send the announcement (§7.9).
10. After the window, PR-7 removes the shims, the legacy layout and the flag (§8).

### 7.8 Rollback plan (GRC-10)
- **Trigger** (owner: the operator; the implementation session proposes): within 7 days of the hosted
  flip, any of: a mentat gate outcome differs from the before-record on a live path; `/player` or
  `/goal` fails in more than one guild; the drift check reports drift that a re-register does not
  clear; a guild owner reports a Discord-permission exposure that cannot be fixed per guild.
- **Steps:** set `DUNE_COMMAND_LAYOUT=legacy`, restart, register (restart-first order again), then
  run the §7.7 step 6 verification expecting the legacy set, and clear any guild-scope copies.
- **Verify:** `verify-registered-commands.js` passes for legacy; startup log shows
  `registeredLayout=legacy`; `/api/commands` shows `/dune player`; one `/dune player whoami` and one
  `/dune player kick` preview run.
- **Rehearsed** on dune-dev during UAT (§9.9) before the hosted flip.
- A code revert is not the rollback: it would leave `/player` registered with no handler (R11).
- After users have learned the new names, rollback is for a failed rollout, not a preference change.

### 7.9 Communication (UX-6, GRC-10)
- **Release note / CHANGELOG** ("Breaking", under the version in §8): the old → new table (17 prefixes,
  11 paths); that old paths keep working until the removal release date; the `moved` picker entries;
  self-hosters must register (the hook does it only if they use it); the Integrations note (§6.4); no
  re-invite needed; the new env var, and that the hook will not change a registered layout until it is
  set explicitly (§7.2 item 1). Plus `docs/changes/PR-NNNN-command-surface-split.md`.
- **In Discord, at the hosted flip:** one announcement per guild to its configured alert/digest
  channel where one exists (and to the owner by DM where not), with a 5-line player table and an
  11-line staff table and a link to the mentat-link "What moved" section. Help carries a one-line
  banner during the window.
- **mentat-link:** a "What moved" section with the same table; the accordion's `formerly` text.
- **Core:** Core#1087 (filed) rewords Core's user-visible text; `/dune data verify` is wrong today.
  Not blocking.
- **Support load owner:** the operator, for the first 7 days after the hosted flip.

---

## 8. Flag, versioning and releases `[D9]` (R-H, GRC-3)

`package.json` is `1.0.0-rc.5` (tag `v1.0.0-rc.5`, 2026-08-10); `CHANGELOG.md` follows SemVer with
an `Unreleased` section. The hosted bot deploys from `main` on every merge; tags are cut separately.
"One minor release" has no meaning in an `-rcN` scheme, so the window is defined by dates and rc
numbers:

| Step | Contents | Version | Audit gateway (Requirement 20) |
|---|---|---|---|
| 1 | PR-0 … PR-5 (prerequisites, before-record, resolver, layout + `/player`/`/goal` + shims, mentat-link, docs). Code default per OD7; the hosted bot is pinned to `legacy` (§7.7 step 0). | next cut: **v1.0.0-rc.6** | L1 (this register), L2 per PR, L3 `/code-review high` per PR; release-level L3 over the rc.6 diff |
| 2 | Hosted flip (env on the VM, §7.7) — not a release. PR-6 flips the code default to `split` (only if OD7 = a). | PR-6 ships in **v1.0.0-rc.7** | L3 diff audit referencing rc.6's L1/L2 |
| 3 | PR-7 removes the `moved` shims, the legacy layout, legacy alias-execution and the flag. | the first rc (or 1.0.0) cut **at least 30 days after the hosted flip and after rc.7 is published**; a dated issue is filed at the flip | L3 diff audit; the before-record test is retired in the same PR with justification |

Legacy alias-execution for stale clients costs no registration budget; OD2 decides whether it
outlives the shims (recommended: remove together at step 3).

---

## 9. Testing strategy (R-E)

### 9.1 The before-record (own PR, generated once)
- `scripts/generate-authz-before-record.mjs` runs the real `executeDuneCommand` with a stub adapter
  and stub interactions over the axes in §9.3 and writes
  `test/fixtures/authz-before-record.json` (sorted keys, stable order). Header fields: source SHA,
  node version, script sha256, row count.
- **Pinned SHA (v2.1, V2-9).** The ruling named `f8709f0`. Two merges after it change
  before-record rows:
  - PR #435 (`db3db83`) changed goal autocomplete scoping. The call at `src/commands.js:1788` exists
    only from `db3db83`.
  - PR #436 (a PR-1 prerequisite, head `6d2275b`) changes caller-dependent help classification in
    `src/commands.js`.

  A record taken at `f8709f0` would either equal the PR-1 base, in which case the pin is ceremonial,
  or make PR-1 red on its first day. **All rows are therefore generated at PR-1's merge base**, which
  contains #435 and #436. The script also runs the dispatch rows at `f8709f0` and records the result
  as an equality cross-check. Every row outside help and goal autocomplete must be equal; any other
  difference is investigated before PR-1 merges. The header records both SHAs and the cross-check
  result. This supersedes Round 1 correction 10 in the register.
- Merged in its own PR (PR-1) **before any refactor**, with a hand-written
  `test/fixtures/authz-audience-table.md` (101 rows: path → audience/tier from §3.2) and a test that
  the before-record's outcome classes agree with it (an oracle not derived from the code).
- CI check: after PR-1, any PR that changes the before-record or the script fails unless it is a PR
  whose only change is a regeneration with its own justification (enforced by a path-filter job that
  fails when those files change together with `src/`).
- The summary (row counts per caller × mode) is posted on #423 and in `docs/changes/`.

### 9.2 Pinned inventories (QA-2, QA-4, ARCH-8)
- An **inline literal** (in the test file, not imported from `src/`) of the 17 prefix and 11 path
  moves (plus `data:calculator` → `goal:calculate` under OD6(b)); `LEGACY_MOVES` must deep-equal it, and before/after rows are paired through the literal.
- For the 11 moved writes, a literal `{ newKey: { tier, coreActionId, confirmPhrase, params } }`
  (for example `moderation:give-item` → owner, `player.give-item`).
- A literal sorted list of the 101 pre-split paths; bijection with the post-split tree (new, moved,
  unchanged) minus shims.
- **Option parity:** option names, types, required flags, choices and min/max for every moved
  subcommand deep-equal the pre-split snapshot.
- JSON snapshot of today's `commandDefinitions()` (writes on and off); legacy layout deep-equals it
  (§5.8).

### 9.3 Matrix axes (pinned, with a row count)
caller {public no-role, observer, moderator, admin, owner (real `guild.ownerId`), host-operator,
allowed-user id, member of an unregistered guild} × context {guild, DM} × tenancy {multi, single} ×
rbac {restricted, open} × writes {on, off} × extras where applicable {`diagnostic` none/true; goal
`scope` none/personal/guild; single-tenant `commandRoleIds` override none/present; cooldown-hit
(second call within the window)}. Outcome classes: `not-connected`, `zero-role`, `rbac-denied`,
`admin-denied`, `diagnostic-denied`, `write-tier-denied`, `host-operator-denied`,
`guild-goal-denied`, `cooldown`, `write-preview(action, params)`, `executed(route)`, plus the
recorded cooldown key. The total row count is asserted. Fresh state per row (`resetCooldowns()`,
confirmation reset, new `:memory:` DB per mode), injected clock, and a run-twice determinism test.

### 9.4 Layout, resolver and write tests
- Both layouts: every old path and every new path matches the before-record (old paths now execute);
  `moved` shims give `pointer` with zero side effects; the flag parse (`legacy|split|unset|garbage`).
- `resolveInvocation` totality and the alias set (§5.2); spies assert the key passed to
  `isCommandAllowed` and `checkCooldown` is identical for old and new paths.
- One-branch-per-key and one-formatter-per-key (§5.6).
- Help tier equals the behavioural tier: invoke `handleWriteCommand` one tier below (denied) and at
  the tier (preview) for every write key.
- Moved-write confirmation round trip for all 11: preview payload equals the before-record (action
  id, params); requester click executes, another user is denied; `writeAuditEvent.action` is the
  unchanged Core id; `forcedPublic` parity.
- Tested invariants of §6.3 and `contexts` of §6.4.

### 9.5 Routing, autocomplete and pointer tests
- `routeAutocomplete` matrix: commandName {dune, player, goal, confirm-connection, other} × group
  {null, data, goal, player, moved} × sub, asserting which handler fires (spy), exactly one
  `respond`, no DB access for shims; the guild-goal leak tests re-run under `/goal` for {public,
  observer, role-less member in a restricted guild, admin} × {on-hand, delete, progress, list}.
- Dispatcher: autocomplete and unknown `commandName` return `false` with no reply and no side effects.
- Pointer: all pointer cases, with and without stale options present, ephemeral, exact text from the
  literal, zero adapter/DB/cooldown/`incrementCommandCount` calls; the shim does not consume the
  real command's cooldown.

### 9.6 Shared interaction factory
`test/fixtures/discordInteraction.js` exports `interactionFor("/player whoami", opts)`, which
derives `commandName`/group/subcommand from the **registered** JSON (it fails for an unregistered
path) and implements `getSubcommandGroup(required)` like discord.js. It replaces the five local mock
copies. Tests keep at least one literal expected string per string family (`/player link`,
`/goal create`, `/dune moderation kick`), plus a grep guard that no `src/` string contains
`/dune player|goal` outside the allowlist.

### 9.7 Docs drift
`test/userGuideDrift.test.js` parses every top-level command via the surface map; the mapping table
is exempted by a fenced marker.

### 9.8 CI
- The full suite runs once per layout (a CI matrix on `DUNE_COMMAND_LAYOUT` via injected config).
- Import-graph test: the modules `commandDefinitions()` imports are all inside the hash input (§7.2).

### 9.9 Live UAT on dune-dev (QA-13)
- `docs/uat/command-split-checklist.md` with an expected-result sheet derived from the
  before-record (one row per outcome class), named roles (owner, admin, moderator, observer,
  no-role) on dune-dev's guild, destructive writes stopped at preview.
- Registration: use a guild-scope registration on dune-dev only if the application has no global
  `/dune` there; otherwise use global plus the layout rollback rehearsal, since guild + global would
  show duplicates. Clean up guild scope with an empty PUT.
- Measure propagation and the stale-client behaviour (a cached client invoking an old path).
- **Rollback rehearsal:** split → legacy → split with §7.8's verification each time.
- Evidence (REST output, screenshots) posted as a comment on #423.
- Then `npm test`, `npm run check`, `/code-review high` (Layer 3).

---

### 9.10 Tenant isolation tests (§6.6)
- **No tenant selector:** walking `commandDefinitions()` in both layouts, no command has an option
  named `guild`, `guild_id`, `guild-id`, `guildid`, `tenant`, `tenant_id` or `server_id`, except the
  allowlisted `/dune guild add|remove` `guild-id` (in-game guild; reason recorded in the test).
- **Guild only from the interaction:** a spy on `getGuildConfig`/`_resolveConfig`, the guild-settings,
  guild-roles and goal DB readers, and every autocomplete handler asserts that every call receives
  `interaction.guildId` and nothing derived from options.
- **Two-guild fixture:** guilds A and B, each with its own `guilds` row (distinct `adapter_token`,
  distinct `console_url` pointing at distinct stub Cores), settings, roles and goals. For **every one
  of the 101 paths**, in both layouts, including alias-executed legacy paths, the `moved` shims and
  every autocomplete route, an interaction from guild A: never reads guild B's row, token, Core URL,
  settings, roles or goals; sends every adapter request to A's stub Core with A's token only; and
  returns no B data. The fixture also covers:
  - **The write-confirm button round trip** for every write action (V2-3). The preview and the
    click both hit A's stub Core only.
  - **A shared user in both guilds** (V2-5). That user's personal goals are visible in A and in B,
    because they are user state. A's guild goals never appear in B, and B's never appear in A.
- **Unregistered A**, with a third stub Core as the process config, asserting zero calls to it:
  - **Every guild slash-command path is `not-connected`**, with zero adapter calls, never falling
    through to B or to the process config.
  - Carve-outs, with their own expected classes (V2-4):
    - `core:setup` is exempt from the gate (`src/commands.js:1035`). Its expected class is its setup
      reply, with zero adapter calls.
    - The `moved` shims give `pointer`, because they run before the gate.
    - Autocomplete returns choices, not replies. Goal autocomplete returns A's rows only, or `[]`,
      and the calculator returns static data. Both make zero adapter calls.
- **Pre-existing fallbacks (§6.6 item 5, mentat#442):**
  - **DM rows**, in multi-tenant mode × {restricted without allowed ids, `open`, allowed-user id}.
    `/player` and `/goal` are not invocable in a DM (`contexts: [Guild]`). They reach no handler, and
    that is asserted.
  - For `/dune` paths, including alias-executed `/dune player|goal`, the rows assert **today's**
    outcome. That includes the process-config adapter call where RBAC admits the caller, and each
    such row is marked `KNOWN-GAP #442`.
  - **The button after A's row turns suspended between preview and click**, and **the Steam callback
    for a non-active guild**, are recorded the same way.
  - The rows flip to "zero process-config adapter calls" in whichever of PR-3 and the #442 fix lands
    second. A `KNOWN-GAP` row may only change toward fewer adapter calls.
- A DM interaction reads no guild row at all.

## 10. Interaction with open work and PR sequencing (R-H, ARCH-8, GRC-9)

| PR | Content | Issue | Branch | Depends on | Visible effect |
|---|---|---|---|---|---|
| PR-0 | Registration hash, failure detection, alert, logging, startup drift check, layout guard (§7.2 item 1) | #440 | `issue/440-register-hash` | — | none (ops only) |
| — | PR #436 (help write visibility) | #424 | `fix/help-write-visibility-424` | — | help |
| PR-1 | Before-record script and fixtures, audience table, JSON snapshot | #423 | `issue/423-authz-before-record` | #436 | none |
| PR-2 | `resolveInvocation`, `routeAutocomplete`, routing hardening, `/dune` only | #423 | `issue/423-resolver` | PR-1 | none |
| PR-3 | Layout flag, shared adders, `/player`, `/goal`, shims, `invocationFor`, pointer text, feed `prefix`/`formerly`, `contexts` | #423, #422 | `feat/423-command-split` | PR-0, PR-2, PR-4 live | none with default legacy |
| PR-4 | mentat-link prefix rendering, "What moved" (mentat-link repo) | #423 | `feat/423-command-prefix` | — | none until the feed changes |
| PR-5 | Docs (§12) | #423 | `docs/423-command-split` | PR-3 | docs |
| (flip) | Hosted env change per §7.7 | #423 | — | P1–P3 recorded | the split, hosted |
| PR-6 | Default `split` (only if OD7 = a) | #423 | `feat/423-default-split` | hosted flip stable 7 days | self-hosters |
| PR-7 | Remove shims, legacy layout, alias-execution, flag | dated issue | `chore/423-remove-legacy-layout` | ≥30 days after flip, rc.7 out | legacy gone |
| after | OD8 readable goal text; PR #384 `service-setup` (360) | #372 | — | PR-7 | budget relief |

Other open work:
- **PR #435** is merged (`db3db83`); goal autocomplete scoping is on the base.
- **PR #437 / Phase 2** (`goal sync`): key stable; it must use `invocationFor` for its new strings
  ("run `/goal sync` again", "Link your character first: `/player link`"); legacy `/dune` becomes
  7493. Either order works.
- **PR #384** measured 360 chars (`main` + #384 = 7833 > 7500); sequenced after PR-7 (comment on #372).
- PR #389, #431: no command-definition change.
- One worktree per repo at a time (Requirement 16); this branch is design-only and merges by PR.

---

## 11. Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Routing refactor changes an authorization outcome | High | Before-record at pinned SHAs, independent audience table, literal move table (§9) |
| R2 | Handlers branch on the raw Discord group and fall through | Medium | Single resolver; `FORMATTERS` map; one-branch-per-key test |
| R3 | Muscle-memory breakage and support load | Medium | Old paths alias-execute; announcement; help "Moved recently"; mentions |
| R4 | Registered tree diverges from deployed code (file list, failed register reported as success) | High | Hash-based registration, failure detection and alerting, startup drift check (#440) |
| R5 | Propagation or client caching delays | Low-Med (unverified) | Dispatcher accepts both layouts; measured in UAT |
| R6 | Integrations overrides on `/dune` do not cover `/player`/`/goal` | Medium | Release blocker: P3 enumeration and owner notification; `contexts: [Guild]` |
| R7 | Name collision with other bots' `/player`/`/goal` | **Medium** (was Low) | OD1; bot name in embed footers; `/goal` header starts with the game name; FAQ entry |
| R8 | Landing page shows wrong invocations | Medium | Feed from the registered layout; mentat-link first, verified live; `formerly` |
| R9 | Core text names old or wrong paths (`/dune data verify` wrong today) | Medium | Core#1087 |
| R10 | Leftover guild-scope registration | Low-Med | P2; both scopes verified on rollout and rollback; empty PUT after UAT |
| R11 | Code revert leaves `/player` registered with no handler | Medium | Rollback by flag (§7.8) |
| R12 | Textual conflicts with #436, Phase 2 and #384 | Medium | §10 sequencing |
| R13 | A future group collides with a top-level key | Low | Alias-set test |
| R14 | Autocomplete routed too broadly or too narrowly | Medium | `routeAutocomplete` on the resolved group; matrix |
| R15 | Self-hosters upgrade without registering | Medium | Startup drift check logs an error; strings follow the registered layout; release note |
| R16 | Verbosity creep once budgets relax | Low | Per-command, per-layout 7500 target |
| R17 | A `moved` shim or pointer executes something | Low | Name never a real subcommand; purity spy tests |
| R18 | Legacy layout freezes new `/dune` features until PR-7 | Medium | Accepted; sequencing stated (§10) |

---

## 12. Documentation impact (Requirement 14, R-H)

Counts are references to moved paths (`/dune player|goal`, the 11 writes) by `git grep -c -E` on
`origin/main` `db3db83` (§15). Owner "impl" = the session implementing the named PR.

| Doc | Refs | Change | PR | Owner |
|---|---:|---|---|---|
| `docs/user-guide.md` | 39 | Three top-level commands; mapping table (fenced marker for the drift test) | PR-5 | impl |
| `docs/faq.md` | 19 | Paths; "two bots have /player"; "how do I place an order"; reload Discord | PR-5 | impl |
| `docs/configuration.md` | 17 | Paths; `DUNE_COMMAND_LAYOUT` | PR-5 | impl |
| `docs/quick-start-guide.md` | 13 | Paths | PR-5 | impl |
| `docs/troubleshooting.md` | 6 | Paths; stale guild scope; drift-check error | PR-5 | impl |
| `docs/admin-guide.md` | 4 | Moved writes; registration; Integrations note; announcement | PR-5 | impl |
| `docs/architecture.md` | table | Write table groups; dispatch via `resolveInvocation`; **gate-order section** (resolver before gates; pointer only on `moved` shims); registration hash | PR-3 | impl |
| `docs/discord-setup.md` | | Propagation wording (`:224`); four commands; invite needs no change | PR-5 | impl |
| `docs/steam-link-design.md`, `-implementation-prompt.md`, `-security-review.md`, `-architecture.md`, `-grc.md` | 21, 6, 4, 4, 1 | design/architecture: update active paths; security-review, grc, implementation-prompt: dated records, add a superseded-paths banner | PR-5 | impl |
| `docs/roadmap.md` | 9 | Paths in open items | PR-5 | impl |
| `docs/multi-tenant-design.md`, `docs/chronicles-of-kanly-tier-mapping.md` | 1, 1 | Banner if still linked from the user guide; else no change | PR-5 | impl |
| `docs/rw-command-design.md`, `docs/rw-architecture.md`, `docs/ro-roadmap-state-2026-08-06.md` | 1, 1, 1 | Historical: banner only | PR-5 | impl |
| `docs/crafting-resource-planning-overview.md` | 0 | Mention `/goal` as the entry point | PR-5 | impl |
| `docs/superpowers/*`, `docs/design/*`, `docs/changes/PR-0430*`, `PR-0435*` | ~70 | Dated historical records: not rewritten | — | — |
| `compliance/policies/data-classification.md` | 1 | Path | PR-5 | impl |
| `compliance/runbooks/*` | 0 | grep recorded: no hits | — | — |
| `.env.example` | | `DUNE_COMMAND_LAYOUT` | PR-3 | impl |
| `CHANGELOG.md`, `docs/changes/PR-NNNN-command-surface-split.md` | new | Breaking entry, mapping table, versions (§8) | PR-3 / PR-6 | impl |
| Phase 2 spec (#437) | | `/goal sync`, `invocationFor`, legacy budget 7493 | #437 | Phase 2 session |
| mentat-link `index.html`, `docs/index.html`, `CHANGELOG.md` | 17, 15, 2 | Mock-ups, noscript fallback, "What moved" | PR-4 | impl |
| `meta` docs (GitBook source for docs.dunedocker.app): `docs/discord-bot/user-guide.md`, `steam-link-design.md`, `rw-command-design.md`, `docs/server/rw-architecture.md`, `docs/server/security/discord-player-link-hardening.md`, `docs/landing/index.html`, `docs/marketing/*` (22 files with hits) | | Operational guides updated; marketing and historical files bannered or left dated | separate `meta` PR after PR-5 | a `meta` session (Requirement 16) |
| `dune-ops-observability-addon` | 0 | grep recorded: no hits | — | — |
| Core user-visible strings | 6 lines | Core#1087 | Core PR | Core session (Requirement 18) |

---

## 13. Audit evidence plan (Requirement 20, R-H)

| Layer | What | Where the evidence goes |
|---|---|---|
| L1 (design) | This audit: register + STRIDE table | `…-layer1-audit-register.md`; comment on #423 (posted), pointer on #422 (posted) |
| L1 follow-up | P1–P3 results; OD decisions | comments on #423 |
| L2 (per PR) | Eight hats on each implementation PR's code; findings filed as issues; STRIDE table | comment on #423 per PR (and #440 for PR-0, mentat-link's tracking comment for PR-4) |
| L3 (per PR) | `/code-review high` on each PR diff; STRIDE table | comment on the PR and on #423 |
| Release | rc.6 / rc.7 / removal release gateways (§8) | comment on #423 with the release's evidence list |
| Authorization record | The before-record summary and the equality result after PR-3 | #423 comment and `docs/changes/PR-NNNN-command-surface-split.md` (SOC 2 CC8.1 evidence) |

**Requirement 28 check** (2026-09-29): `gh issue list --repo Project-Arrakis/mentat --label
ops-monitor --state open` → 0 issues; `remediation-ready` → 0; `needs-human-review` → 0.
**Requirement 29 check** (2026-09-29): base `f8709f0` → `origin/main` `db3db83`; budget unchanged.
Re-run both before each PR.

---

## 14. Open decisions for the operator

Items marked **open** need the operator; the others carry a recommendation v2 applies unless
overridden.

1. **OD1: top-level names — open.** (a) `/player` + `/goal` (issue text; short; key segment matches);
   (b) `/character` + `/goals`; (c) `/dune-player` + `/dune-goal`. Evidence: Discord allows the same
   name across apps and shows each app's icon, but a user who types `/player` and presses Enter picks
   the first match, and music/game bots commonly use `/player` (UX-8; not measured). R7 is now
   Medium. **Recommendation: (a)**, with the game name first in `/goal`'s description and the bot
   name in embed footers; revisit if the hosted guilds already run a bot with `/player`.
2. **OD2: transition length.** `moved` shims and legacy alias-execution until PR-7 (≥30 days after
   the hosted flip and after rc.7). **Applied.**
3. **OD3: server lifecycle writes — open.** (a) `/dune operations` (audience-clean); (b) stay in
   `/dune server` (fewer breaks, #422 half fixed). **Recommendation: (a)**, subject to OD9's name.
4. **OD4: option.** B2. **Applied.**
5. **OD5: resolved by operator 2026-10-01** as a separate `/order` command (see D14 v2.2), not
   `/goal order`. Open follow-ups: **OD15** (resolved: per-guild setup question, see D14; a guild that skips it sees overdue only in `list`), **OD16** (resolved: no conversion, migration asserts zero dated goals), **OD17** (resolved: yes, via a Core guild-base designation, phase 2c).
6. **OD6: calculator placement — open.** (a) stay in `/dune data`; (b) `/goal calculate` with
   `/dune data calculator` aliased during the window. Evidence: after the split the calculator is the
   only player tool left in the staff/server command (UX-13), it feeds goal creation, and `/goal` has
   room (723 chars). Cost: one more re-learned path and a key change `data:calculator` →
   `goal:calculate` (a 29th move; the before-record covers it). **Recommendation changed to (b).**
   **If (b) is accepted (V2-6, measured with `discordCommandCharBudget` at `db3db83`):**
   - **Costs.** The calculator subcommand costs 723 chars, or 722 when named `calculate`. Split
     `/dune` becomes **5568**, or **5746** with the `moved` shims (from 6291/6469). `/goal` becomes
     **1166** (from 444). Legacy `/dune` is unchanged at 7473, because the legacy tree is frozen.
   - **Counts.** Wherever §5.1, §5.2, §6.2 and §9.2 say 28 moves, 90 of 101 unchanged keys and 11
     changed keys, read **29 moves, 89 unchanged, 12 changed**. `data:calculator` → `goal:calculate`
     is a prefix-and-name move, and no tier changes, because it is player tier on both sides.
   - **Alias status.** `/dune data calculator` is **not registered** in the split layout, so it costs
     no budget. It stays as a stale-client alias only: it alias-executes through `resolveInvocation`
     like the other legacy paths until PR-7.
   - **Autocomplete routing.** The `goal:calculate` key row is matched before the logical-group `goal`
     row (§5.5), so calculator suggestions never reach `handleGoalAutocomplete`.
   - **Help.** The "Moved recently" block lists it among the moves.
7. **OD7: layout default for self-hosters — open.** (a) `legacy` default in rc.6, `split` in rc.7;
   (b) `split` default from rc.6, `legacy` only as a rollback value. Evidence: with R-A, old paths
   keep executing in either layout, and v2 derives strings and the feed from the registered layout,
   so the stranding risk (a) guarded against is mostly gone; (a) keeps two documented worlds for a
   release (UX-7). **Recommendation: (b)**, provided #440's drift check and layout guard ship first
   (the drift check makes the registered-layout strings correct for self-hosters who have not
   registered; the guard stops a code-default change from flipping a deployment). The hosted bot is
   pinned to `legacy` before PR-3 in either case (§7.7 step 0, V2-1).
8. **OD8: readable goal descriptions.** Yes, after PR-7 (R-D). **Applied.**
9. **OD9: new group names — open.** For the 7 actions on other players: (a) `moderation`;
   (b) `players` ("act on players"); (c) split into `moderation` (kick, ban, unban, warn) and
   `support` (give-item, clear-backpack, fill-water). For the lifecycle writes: (a) `operations`
   (existing group, no header cost, but next to `ops`); (b) rename `operations` to `server-control`
   (moves `create-backup`/`trigger-update` too: 2 more paths). Evidence: `give-item`,
   `clear-backpack`, `fill-water` are not moderation in plain English and `warn` is map-wide
   (UX-3); `ops` vs `operations` are near-identical (UX-15, SEC-6). **Recommendation: (c) for the
   player actions if the operator accepts one more group header (~40 chars), else (a); keep
   `operations`** (renaming it breaks two more paths for a naming gain only), and start its header
   with "Owner/admin server actions".

---

## 15. Unverified items and reproduction
- Discord propagation time and stale-client behaviour (measured in UAT).
- Whether the bot token can read per-guild command permissions (P3).
- The hosted bot's registration scope and any stale guild-scope copies (P1, P2).
- Whether the mentat#442 DM fallback is live on the hosted bot (it depends on `DUNE_CONSOLE_API_URL`,
  the adapter token, `DISCORD_RBAC_MODE` and `DISCORD_ALLOWED_USER_IDS`; P1).
- Discord's daily command-create limits under repeated global PUTs (the Cloud hat's "200/day" is
  unverified; the plan uses at most 4 global PUTs).
- Discord's API acceptance of a command mixing subcommands and groups (only for option C).
- How `/player` ranks next to other bots' commands in the picker (OD1).
- Budgets: the repo's own function; localizations are not counted (none used).

**Reproduce:** import `commandDefinitions` and `WRITE_ACTIONS` on the base SHA, apply
`discordCommandCharBudget`, and rearrange the JSON as in §4. Shim cost: add the two groups of §7.3.
#384: `git fetch origin pull/384/head` and measure `admin service-setup` (360). Reference counts:
`git grep -c -E '/dune (player|goal)|/dune server (restart|stop|start|restart-service)' origin/main -- docs compliance README.md .env.example`.

## 16. Follow-ups (not part of this change)
1. mentat#439: dormant single-tenant `commandRoleIds` keys (fix changes behaviour).
2. mentat#440: registration hash and failure handling (a **prerequisite**, PR-0).
3. Core#1087: Core user-visible text (`/dune data verify` wrong today).
4. Review the §3.3 classifications (logs, backups, soc/prometheus for any tier; `admin roles` into
   `core`; storage/find `scope` text; mentat#433).
5. PR-7 removal (dated issue filed at the hosted flip).
6. Option C later, if still wanted.
7. `docs/discord-setup.md:89` invite `permissions=0` vs `permissions=128` elsewhere (CLOUD-6).
8. mentat#442 (High): multi-tenant DM, write-confirm button and Steam-link callback fall back to the
   process-default Core without an active guild row (V2-2, V2-3). Pre-existing; the §9.10 `KNOWN-GAP`
   rows track it.
