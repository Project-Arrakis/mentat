# Live Stock Integration, Personal Scope — Design (Phase 2)

**Status:** design, not yet implemented, not yet audited. No code in this
document except one illustrative query shape (clearly marked).

**Spec context:** Phase 2 of the crafting/resource-planning effort described in
`docs/crafting-resource-planning-overview.md`. Phase 1 (`/dune data calculator`)
and Phase 3 (`/dune goal`, `docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md`,
implemented in PR #430) are shipped. Phase 2 is an optional enhancement: it lets a
player *choose* to fill a **personal** goal's on-hand numbers from the game
database instead of typing them.

**Audit status:** **Requirement 20 Layer 1 (eight-hat design audit) has NOT been run
on this document.** Every design decision a reviewer should audit is tagged
`[D<n>]`, every operator-facing choice `[OD<n>]`, every risk `[R<n>]`, so the
Layer 1 findings register can cite them. Claims about Core are cited as
`path:line` on the fork's `origin/main` (commit `ace31877`, 2026-09-27, read only
via `git show`/`git grep` against git objects; no working tree was read). Anything
not verifiable that way is in the **Unverified** list, not asserted.

## Goal and Non-Goals

**Goal.** A player who has linked their Discord account to their in-game character
can, for one of their own personal goals, ask mentat to read their current stock
of that goal's items from the game and use it as the goal's on-hand numbers —
with the player always seeing what changed before or as it changes, and with the
manual `/dune goal on-hand` path unchanged and always available.

**Non-goals (explicit).**
- **Guild scope is OUT.** Guild goals/orders keep Option 1 (leader/officer manual
  entry). **Option 2 (a real guild-base designation in Core) stays deferred**; this
  design adds no guild query, no guild route, and mentat must refuse to sync a
  guild goal `[D1]`.
- **Per-member contribution attribution is OUT** (unchanged from the overview:
  the engine gives no per-actor deposit signal).
- No recipe/crafting math in Core. Core answers "how many of these item ids does
  this linked player have"; all domain logic stays in mentat.
- No automatic/background refresh, no push notifications, no scheduled sync.
- No new mentat table or column `[D2]` (see Data Model).
- No direct Postgres access from mentat. The only path is
  `adapterClient.js` → Core adapter → `duneDb.js` (`docs/architecture.md`, "Boundaries").

## Verified Findings About Core

All citations are `origin/main` of `/root/projects/repos/dune-awakening-selfhost-docker`.

### F1. The existing `owned`-scope container search

`searchItemsInContainers(db, { playerControllerId, query, scope })`,
`console/api/src/duneDb.js:17117`. The `owned` branch (`:17120`–`:17152`):
- Starts from `dune.items i`, joins `dune.inventories inv on i.inventory_id = inv.id`,
  `dune.placeables p on p.id = inv.actor_id`, then
  `dune.actor_fgl_entities afe on afe.entity_id = p.owner_entity_id`,
  `dune.permission_actor_rank par on par.permission_actor_id = afe.actor_id`,
  `dune.permission_actor pa on pa.actor_id = par.permission_actor_id`.
- Ownership filter: `where par.player_id = $1 and par.rank = 1` (`:17146`–`:17147`).
  `$1` is the linked `player_controller_id`. Rank 1 = Owner, "exactly one per base"
  (`docs/console/base-permissions.md:19`); ranks 2/3 are Co-Owner/Associate (`:20`–`:21`).
- Item identity: `i.template_id ilike $2` with `$2 = '%<query>%'` (`:17148`, `:17118`) —
  a **substring, case-insensitive** match, not exact.
- **No cross-base logic is needed:** the join has no `distinct`/per-base limit, so
  every base the player owns is included (confirms the overview's claim).
- Row shape is **one row per item stack** (`group by i.id, ...`, `:17149`), capped
  by `limit 200` (`:17151`). It returns stacks, not totals; a caller cannot get an
  exact total from it: a >200-stack result is silently truncated, and `ilike '%Silicone%'`
  would also match any other id containing that substring.
- Inconsistency with the storage listing: `playerOwnedStorageQuery` filters
  `p.is_hologram = false and p.owner_entity_id is not null and p.owner_entity_id != 0`
  and requires an inventory row (`duneDb.js:17053`–`:17077`); the owned *search*
  has no `is_hologram` filter. The new query must apply the stricter filters `[D3]`.
- Player-carried inventory is a **separate** query family:
  `searchItemsInPlayerInventory(db, playerPawnId, query)` (`:17194`), keyed on
  `inv.actor_id = <player pawn id>` with **no** `inventory_type` filter, `ilike`, `limit 200`;
  `playerInventory` (`:2759`) uses `inventory_type = 0` (backpack only). Inventory
  types are documented at `:2693`–`:2710`: backpack 0, worn gear 1, held gear 15,
  schematics 30; emote containers 14/27 deliberately excluded.

### F2. Item-id compatibility with mentat's catalog (the deciding question)

**Answer: yes, mentat's catalog `id` is the same namespace as `dune.items.template_id`,
so the adapter can accept a mentat item id directly and match `template_id = <id>`.**
Evidence:
1. Core's own lookup keys the catalog by `id` and looks rows up by `template_id`:
   `adminItemMetadata()` builds `Map` keyed by `String(item.id)`
   (`duneDb.js:7185`–`:7200`); `enrichWithDisplayName` does
   `metadata.get(String(templateId))` (`integrations/discord/inventoryProvider.js:48`–`:49`).
   That code path is live: its own comments record a live user report where raw
   `template_id`s such as "AzuriteOre" were fixed into display names ("Copper Ore")
   via exactly this map (`inventoryProvider.js:17`–`:33`), and the CHANGELOG records
   the fix shipped (`CHANGELOG.md:863`).
2. mentat's vendored catalog is a deduplicated copy of that same file
   (`src/gameItemCatalog.js:1-15`, source `runtime/data/admin-items.json`).
   Verified this session by diffing ids: 2,558 rows / 7 duplicate ids in Core's
   `origin/main` file (`RespawnBeacon, Stilltent, Thumper, UniqueThumper,
   UniqueThumper_02, UniqueThumper_03, Stilltent_Unique_01`), 2,551 in mentat's
   copy, **0 ids in mentat's copy missing from Core's file and 0 the other way**.
3. All 27 ids in mentat's `RECIPE_KEY_TO_GAME_ITEM_ID` bridge (`src/gameItemIdBridge.js`)
   were checked programmatically against Core's `origin/main` `admin-items.json`: 27 of 27
   present (e.g. `Silicone` → "Silicone Block", `DuraluminumRod` → "Duraluminum Ingot",
   `T6ResourceA` → "Titanium Ore").
4. No two ids differ only by case (checked), so case-sensitive `=` is safe.
5. One id contains a hyphen (`MTX_G-suit_Ornithopter_Swatch`); all others match
   `[A-Za-z0-9_]+`, max length 60 (checked). Id validation `[D4]` must allow `-`.

**Caveat (Unverified U1):** this proves the *catalog namespace* equals the
*display-name lookup namespace*, and the live fix shows it works for the items
players actually hold. It does not prove every bridge id — notably `Oil`
(mapped from `fuel_cell`) and `T5RadiatedCoreComponent` — appears in a live
`dune.items` row with that exact spelling. The dune-dev UAT (below) must run an
explicit id-presence sweep before mentat relies on any id.

### F3. The Discord-adapter route pattern (`PLAYERS_FIND`)

- Route constant: `DISCORD_ADAPTER_ROUTES.PLAYERS_FIND: "/api/integrations/discord/players/find"`
  (`integrations/discord/adapter.js:70`); listed in `DISCORD_LIVE_ADAPTER_ROUTES`
  (`adapter.js:165`). A route not in that list is "planned" (`adapter.js:180`–`:182`).
- Handler (`integrations/discord/routes.js:604`–`:619`): `POST` only;
  `readJsonWithActorSignature(req)` → `validateDiscordActor(body.actor)` →
  `requireDiscordCapability(actor, mapping, DISCORD_CAPABILITIES.INVENTORY_READ)` →
  `requireLinkedPlayer(db, actor.userId)` → provider call with
  `playerControllerId: linked.player_controller_id`. **The target player is derived
  only from the actor, never from a body field**, which is the property this design
  depends on for privacy.
- `requireLinkedPlayer` (`linkProvider.js:320`–`:326`) → `getLinkedPlayer`
  (`duneDb.js:16525`), which returns **one** character: the single-link table row,
  else the multi-account default.
- Catalog: `commandCatalog.buildCommandCatalog` **throws** if a live route lacks a
  `COMMAND_METADATA` entry or vice versa (`commandCatalog.js:737`–`:745`); the
  PLAYERS_FIND entry is at `:547`–`:556`. Internal aggregates without a Discord
  option surface use `params: []` with a comment (`GUILD_FACTION_SUMMARY`, `:566`–`:577`).
- Audit: **PLAYERS_FIND has no `audit()` call**; PLAYERS_CHEATER_TRACKING /
  PLAYERS_ITEM_AUDIT_LOG do (`routes.js:644`, `:664`), as do the link routes (`:407`, `:432`).
- Rate limiting: no rate limiter on the inventory read routes was found in
  `routes.js`; the limiters that exist are link/verify-specific
  (`linkProvider.js:219`, `multiAccountLinkProvider.js:213`, `:277`). Query bounding
  exists for OPS routes (`routes.js:131`–`:142`, `:305`: transaction + `set_config('statement_timeout', ...)`,
  default 5000 ms, bounded 250–30000) and globally in the pool
  (`db.js:56`–`:57`, default 15000 ms).
- Actor signature: `readJsonWithActorSignature(req)` with no options treats the
  signature as optional unless `DUNE_DISCORD_ACTOR_SECRET`/`actorSignatureRequired`
  applies; link routes pass `{ requireActorSignature: true }` (`routes.js:200`–`:210`, `:400`+).
- Adapter is off unless enabled: `discordAdapterEnabled` (`adapter.js:184`–`:186`).

### F4. **Tier finding that changes the design: `INVENTORY_READ` is moderator-and-up**

`policy.js:107`–`:115` gives `public` `{STATUS, CORIOLIS, ATLAS}` and `observer` (mentat's
"Player") `{STATUS, CORIOLIS, ATLAS, READINESS, SERVICES}`; `INVENTORY_READ`,
`STORAGE_READ`, `GUILD_READ` first appear in `moderator` (`:125`–`:127`).
A Core test states it outright: "Observer tier (below INVENTORY_READ's moderator
floor) is rejected" (`test/discordAdapter.test.js:2070`). Yet mentat registers
`player:find` / `player:inventory` as `role: "player"` (`src/commands.js:1864`–`:1866`)
and forwards the user's real Discord `roleIds` (`src/rbac.js:172`–`:174`).
Consequently, **on this Core, an ordinary Player-tier user calling
`PLAYERS_FIND` / `PLAYERS_INVENTORY` is rejected with 403 `not_authorized`
(`policy.js:263`–`:265`) unless the operator maps Player roles into the moderator role
list.** Reusing `INVENTORY_READ` for this feature would therefore make personal
live-stock unusable for the exact audience it is for. See `[D5]`/`[OD4]`. This also
looks like a pre-existing gap in the shipped player commands; it is out of scope to
fix here but is filed as Follow-Up.

Precedent for adding a low-tier read capability: `ATLAS_READ` (`policy.js:10`–`:13`,
in the `public` and `observer` sets at `:108`–`:112`). `admin`/`owner` are computed
as all non-self-scoped capabilities (`:146`–`:147`), so a new capability is
automatically granted to them; `moderator` is an explicit set and must be edited.
`minTierForCapability` is cross-checked by a test over every capability
(`test/discordPolicy.test.js:311`–`:338`), which a new capability must satisfy.

### F5. What storage a query can cover

- Containers a player *owns*: rank-1 placeables with an inventory row
  (`playerOwnedStorageQuery`, `duneDb.js:17053`–`:17077`); this includes
  fabricator/refinery inventories (the file's own comments treat Fabricator as a
  container, `:17040`+ header comment; building groups in `duneDb.js:12515`–`:12559`
  show refinery/fabricator inventories are separate `inventory_type` values, e.g.
  12 = refining/crafting, 3 = fuel-and-module).
- Player-carried: backpack `inventory_type = 0` on the **pawn** actor
  (`duneDb.js:2751`, `:2788`), worn gear 1, held gear 15, schematics 30 (`:2693`–`:2710`).
- Not covered by any existing query: vehicles' cargo (separate `dune.vehicle*`
  inventories, `duneDb.js:8816`), Exchange listings, mail, other maps' player
  containers not tied to a placeable. Not verified (U3).
- Base ownership can be moved off the player without removing access: "Transfer
  ownership to a reserved Server or GM identity while preserving access"
  (`docs/console/base-permissions.md:34`). Such a base drops out of `rank = 1`.

### F6. Cost and safety of the query

- Query shape cost is driven by `dune.items` (game-owned table; row count unknown
  here, Unverified U4) joined via `inventory_id` to a small set of the player's
  inventories. Whether `dune.items(inventory_id)` is indexed is **not knowable from
  this repo** — no `CREATE INDEX` on `dune.items` exists in `origin/main`
  (`git grep` found only a trigger in a test, `test/baseContainerItemDelete.integration.test.js:236`);
  the schema is created by the game server/orchestration, not this repo (U4).
- `dune.items` has no unique constraint on `(inventory_id, position_index)`
  (`docs/console/base-inventory.md:364`); do not depend on row uniqueness for
  anything other than `i.id`.
- `sum(int)` returns `bigint`, which `node-postgres` delivers as a **string**;
  the provider must convert explicitly (implementation caution, tested).

## Design Decisions

### Proposed Core change (additive; Requirement 0)

**Repo/branch:** `Project-Arrakis/dune-awakening-selfhost-docker`, branch
`feat/live-stock-self-read` cut from the fork's `origin/main`, issue filed first
(Requirement 21, `ops-monitor` issues checked first, Requirement 28). Because Core's
local working tree is on someone else's branch, implementation happens in a
dedicated `git worktree`, and per Requirement 18 the mentat-focused session files
the Core issue rather than editing Core concurrently.

**Exact delta list (Core):**

| # | File | Change |
|---|---|---|
| C1 | `console/api/src/duneDb.js` | New exported `playerStockTotals(db, { playerControllerId, playerPawnId, itemIds })` — one read-only query (below). |
| C2 | `console/api/src/integrations/discord/inventoryProvider.js` | New `playerStockProvider(db, { playerControllerId, playerPawnId, itemIds })`: validate + dedupe ids, cap, call C1, zero-fill, convert bigint→number, return `{ ok, stock: { <id>: { total, inBackpack, inBases } }, requested, truncated: false }`. **No** `enrichWithDisplayName` (mentat owns names). |
| C3 | `.../adapter.js` | `PLAYERS_STOCK: "/api/integrations/discord/players/stock"` in `DISCORD_ADAPTER_ROUTES` and `DISCORD_LIVE_ADAPTER_ROUTES`. (Name is proposed here; it does not exist today.) |
| C4 | `.../policy.js` | New capability `STOCK_SELF_READ: "stock:self-read"` added to the `observer` set and the explicit `moderator` set `[D5]`. |
| C5 | `.../routes.js` | Handler modelled on `routes.js:604`–`:619`, plus `audit()`, plus bounded statement timeout via the `runOpsProvider`/`set_config('statement_timeout')` pattern (`:131`–`:142`). |
| C6 | `.../commandCatalog.js` | `COMMAND_METADATA` entry (`params: []`, internal-aggregate comment, precedent `:566`–`:577`), required or `buildCommandCatalog` throws. |
| C7 | tests | See Testing Strategy. |
| C8 | `docs/console/API-REFERENCE.md`, `CHANGELOG.md` | Document the route; note the existing table at `API-REFERENCE.md:1018`–`:1022` lists these Discord routes as `GET` while `routes.js` serves them as `POST` (pre-existing doc drift, Requirement 14 — fix in the same PR or file it). |

**No migration, no schema change, no new dependency, no behaviour change for any
existing route.** A Core that has this change but is never called by a new mentat
behaves identically to today. An operator who pulls the fork gets one new
POST route that nothing calls until mentat is updated `[D6]`.

**`[D3]` Query semantics.** Illustrative shape only (not final SQL; the reviewer
should audit intent, and the implementer must re-derive against a real dune-dev
`\d`):

```sql
-- bases: distinct inventories of non-hologram placeables the player owns (rank = 1)
with owned_inv as (
  select distinct inv.id
  from dune.placeables p
  join dune.inventories inv on inv.actor_id = p.id
  join dune.actor_fgl_entities afe on afe.entity_id = p.owner_entity_id
  join dune.permission_actor_rank par on par.permission_actor_id = afe.actor_id
  where par.player_id = $1 and par.rank = 1
    and p.is_hologram = false and p.owner_entity_id is not null and p.owner_entity_id != 0
), backpack as (
  select id from dune.inventories where actor_id = $2 and inventory_type = 0
)
select i.template_id,
       sum(i.stack_size) filter (where i.inventory_id in (select id from owned_inv))::bigint as in_bases,
       sum(i.stack_size) filter (where i.inventory_id in (select id from backpack))::bigint as in_backpack
from dune.items i
where i.template_id = any($3::text[])
  and (i.inventory_id in (select id from owned_inv) or i.inventory_id in (select id from backpack))
group by i.template_id
```

Properties that must hold, whatever the final SQL is:
- **Exact match** (`= any($3::text[])`), never `ilike`; **no row cap**, because the
  result is aggregated to at most N rows.
- **Inventories are de-duplicated before summing** (`select distinct` / semi-join),
  because the existing search joins can fan out per permission row and a sum,
  unlike a per-stack listing, would silently double-count. (Unverified U2 whether the
  fan-out actually occurs on real data; the design does not depend on it not
  occurring.)
- `stack_size` summed as integers; `null` treated as 0.
- `$1` = `linked.player_controller_id`, `$2` = `linked.player_pawn_id` from
  `requireLinkedPlayer` only.

**`[D4]` Batch route, bounded input.** Body `{ actor, itemIds: string[] }`.
`itemIds`: must be an array, 1..16 entries after de-duplication (goals need at
most 6: root + up to 5 ingredients, `src/commands.js:1383`–`:1389`; 16 leaves
headroom without inviting scans), each `^[A-Za-z0-9_-]{1,64}$` (catalog max 60,
one id contains `-`, F2). Anything else → 400 `invalid_item_ids` (the same
`policyError` style as `routes.js:596`). Ids are **not** checked against the catalog
(catalog drift must not turn into hard errors); an unknown id simply returns 0.

**`[D5]` Capability and privacy model.** New `STOCK_SELF_READ`, granted from
`observer` (Player) upward, checked with `requireDiscordCapability` (not the
self-scoped mechanism, which is reserved for write-like identity actions:
`policy.js:37`–`:56`, `:98`–`:101`). The privacy invariant is structural, not
role-based: the route accepts **no** target field; the only player whose stock is
read is `getLinkedPlayer(actor.userId)`. Every extra body field (`playerControllerId`,
`actorId`, `discordUserId`, `characterName`, ...) is ignored, and a test asserts it.
A `public`-tier caller (no configured Player role) is rejected by the capability
check. Moderators and admins get **no wider visibility** from this route — it has
no "other player" mode; a staff need to see another player's stock remains the
existing moderator routes.

**`[D7]` Response is counts only:** no character name, container names, container
ids, coordinates, or item stack ids. This is deliberately less than `PLAYERS_FIND`
returns, so the new route discloses strictly less than a route the same audience
(at moderator tier) can already call.

**`[D8]` Audit.** `audit(config, req, "discord.player.stock_read", { actorId, requestedCount, ok })`
— counts only, no item ids and no totals in the log.

**`[D9]` Timeout/abuse bounds.** Reuse the transaction + `statement_timeout` pattern
(`routes.js:136`–`:141`, `boundedEnvInt` at `:131`) with the OPS default (5 s),
because the route runs one indexed-or-not aggregate over a large table. Result size
is bounded by N=16. There is no per-actor rate limiter on inventory reads today
(F3); mentat adds a per-user cooldown (below) and Core relies on the timeout and
the bounded input. A reviewer may wish to require a Core-side limiter `[OD10]`.

**`[D10]` Actor signature required.** Handler calls
`readJsonWithActorSignature(req, { requireActorSignature: true })` (as the link routes
do). Rationale: the actor's `userId` is the *only* authorization input to a
per-player data read; with an unsigned body, anyone holding the shared bot bearer
token could name any linked user. The cost: on a deployment with no
`DUNE_DISCORD_ACTOR_SECRET`, the route rejects, and mentat degrades to the manual
path with a clear message. The route is new, so this cannot regress any current
operator `[OD5]`.

### Definition of "on-hand" `[D11]` — recommended, flagged for the operator

A player's "my on-hand" of an item is, recommended:

1. **Backpack** (`inventory_type = 0` on the linked character's pawn), **plus**
2. **Every container in every base the linked character *owns*** (`rank = 1`,
   non-hologram, with an inventory row), on all maps, **including refinery and
   fabricator inventories** (same population `/dune player storage` and
   `/dune player find` show today).

Excluded: worn/held gear and schematics (types 1, 15, 30) and emote containers;
vehicle cargo; bases where the character is only Co-Owner/Associate (rank 2/3);
bases transferred to a system custodian; guild-shared anything; Exchange/mail; other
characters on the same Discord account (only the default linked character is read,
F3).

Why this line: (a) it is what a player means by "what I've farmed and stashed" for a
*resource* goal; (b) the base part is exactly the population `/dune player find`
already shows, so the two can be reconciled by eye and by test; (c) rank 1 keeps two
co-owners from each counting the same crate toward their own goals (a shared base
counts for exactly one person); (d) returning `inBackpack` and `inBases` separately
lets mentat show the split, so a disputed number is explainable and Open Decisions
1–3 can change later without a Core change. Items already inside a crafting queue or
consumed by an in-progress refine are *not* separately detectable from `dune.items`
alone (Unverified U5); refinery input slots are counted, which can overstate
"available" by the amount already committed.

### Proposed mentat change

Files and touchpoints (all in `/root/projects/repos-worktrees/phase2-design`'s repo):

| # | File | Change |
|---|---|---|
| M1 | `src/config.js` | `DEFAULT_PATHS["players-stock"]` = `/api/integrations/discord/players/stock`, `DEFAULT_METHODS["players-stock"]` = `POST`, env overrides following the `players-find` pattern (`config.js:35`, `:114`, `:287`, `:354`). |
| M2 | `src/adapterClient.js` | `playerStock(actor, itemIds, guildId)` → `this.request("players-stock", actor, { itemIds }, guildId)`. Add `"players-stock"` to `UNMERGED_ROUTES` (live on the Project-Arrakis fork, not in Red-Blink) — same precedent as `guild-faction-summary` (`adapterClient.js`, UNMERGED_ROUTES comment). **Route classification tracks real upstream, not the fork**; it is informational only (`request()` never consults `routeStatus`; usages are only the exported helpers), so misclassification cannot break a call, but `test/adapterClient.test.js:277`/`:301` and `test/adapterContract.test.js:112` must be updated so the classification tests stay honest. |
| M3 | `src/commands.js` | New subcommand `/dune goal sync id:<int, autocomplete> [apply:<bool>]` and an **async** handler (the current goal handlers are synchronous, dispatched at `commands.js:567`–`:575`). Must also be added to `getCommandRegistry()` and `helpPayload()` `[H9 of Phase 3]`. |
| M4 | `src/commands.js` | Extract a small `goalValidNodes(goal)` helper from the inline logic in `executeGoalOnHand` (`commands.js:1416`–`:1436`) so `sync` and `on-hand` cannot disagree on which nodes are valid. Refactor only; covered by existing tests. |
| M5 | `src/embedFormat.js` | `formatGoalSyncEmbed(payload)` (preview and applied variants), using `duneEmbed` named colors (see the pitfall documented at `embedFormat.js:1822`). |
| M6 | `src/database.js` | **No change.** |
| M7 | `docs/` | `docs/architecture.md` Read Capabilities list; `docs/crafting-resource-planning-overview.md` Phase 2 section status; this spec. |

**`[D1]` Personal goals only.** `sync` resolves the goal with
`getGoalScoped(db, { id, ownerType: "player", ownerId: interaction.user.id })`
(`database.js:1319`) and **never probes the guild scope**. A guild goal id (or
someone else's id) reads as "not found". Test: a guild goal id is rejected and no
adapter call is made.

**`[D12]` UX: `/dune goal sync` — preview by default, apply on request.** Options
considered:
- (a) *Automatic live read on every `progress`/`list`* — rejected: makes progress
  depend on adapter availability, latency, and on a definition of "on-hand" the
  player never opted into; changes the trust model of every existing command.
- (b) *A `live` flag on `progress`* — read-only overlay works, but persisted
  numbers (which `list` percentages and completion detection use) would still
  diverge, and it spends Discord option budget on an existing command.
- (c) **Chosen: one new subcommand.** `apply:false` (default) shows, per goal node,
  `saved` vs `live` (with `backpack / bases` split) and the delta, and writes
  nothing. `apply:true` writes the live numbers and shows the previous values. Two
  explicit steps, one command-budget entry. A "confirm" button flow is Follow-Up.

**`[D13]` Precedence rule (the trust model).**
1. **Nothing is ever written except by an explicit player command.** `progress` and
   `list` read saved entries only, exactly as today.
2. Saved numbers have no source flag; **the most recent explicit write wins**,
   whether typed (`on-hand`) or synced (`sync apply:true`).
3. A sync **never adds a node silently**: a node whose live total is 0 and which has
   no saved entry is skipped (no zero-row created; keeps the 6-entry cap free,
   `GOAL_ON_HAND_CRAFTABLE_CAP`, `commands.js:1389`).
4. `apply:true` **always** prints, per changed node, the previous value and how to
   restore it (`/dune goal on-hand id node quantity:<old>`) — the same
   previous/who/when transparency the manual command already gives
   (`embedFormat.js:1831`–`:1832`). A **decrease** is flagged in the output
   because the most likely cause is stock the query cannot see (vehicle cargo,
   a co-owned base) rather than a real loss `[OD7]`.
5. Live values above the goal schema bound (`quantity BETWEEN 0 AND 100000`,
   `database.js:177`–`:184`) are clamped to 100,000 and the clamp is stated in the output.
6. Completion: after an applied sync, run the same completion check `on-hand`
   runs and the same audit-log entries (`action: "on_hand_update"`, reusing the
   existing CHECK-constrained action so no schema change is needed). A completed
   goal stays completed (matches the "top-off past target" rule already in
   `executeGoalOnHand`).

**`[D14]` Graceful degradation (manual path always works).**

| Condition | Behaviour |
|---|---|
| No multi-tenant DB (`db` null) | Existing guard message, unchanged (`commands.js:557`–`:566`). |
| Invoked in a DM (no `guildId`) | Refuse with "run this in a server; the game server to read is per Discord server". |
| Feature flag off | "Live sync isn't enabled on this bot instance"; manual command hint. |
| Player not linked (Core `403 not_linked`, `linkProvider.js:323`) | "Link your character first: `/dune player link`", plus manual `on-hand` hint. |
| Adapter unreachable / timeout | Existing timeout error path (`adapterClient.js:485`–`:491`), reworded to "couldn't reach the game server; nothing was changed". |
| `403 not_authorized` (Core older than this feature, or no Player role) / `404` (route absent on old Core) / signature rejection | "Your server's Core doesn't support live stock yet (or Player role isn't mapped)". No change is written. |
| Any non-2xx or non-`ok` body | Nothing written; user told nothing changed. |

**`[D15]` Cooldown.** Apply mentat's existing per-user cooldown mechanism
(`src/cooldown.js`) to `goal sync` (recommended 30 s) so a client cannot hammer the
adapter; Core has no equivalent limiter (`[D9]`).

**`[D16]` One Core per invocation.** The adapter used is the one for the guild where
the command was run (`_resolveConfig(guildId)`, `adapterClient.js:277`), but personal
goals are **global across Discord servers** (Phase 3 spec, "Personal goals are
global"). The embed must name the game server/Discord server it read from
`[R5]`/`[OD8]`.

### Data model impact `[D2]`

**None.** `goals` and `goal_on_hand_entries` (`database.js:157`–`:184`) already store
per-node integer quantities keyed by real game item id, with `updated_by`/`updated_at`.
A sync writes through the existing `setGoalOnHandEntry` (`database.js:1336`) and
`appendGoalAuditLog`. Consequence, stated honestly: **provenance (typed vs synced)
is not persisted.** `updated_by` cannot carry a marker, because the manual embed
renders it as a Discord mention `<@${previousUpdatedBy}>` (`embedFormat.js:1832`);
`goal_audit_log.action` has a CHECK list that would need a table rebuild in SQLite
to extend (`database.js:192`). Provenance is shown in the sync response itself and
is a candidate for a later additive column `[OD12]`.

### RBAC and privacy summary

| Question | Answer |
|---|---|
| Who can call the Core route? | `observer` (Player) tier and up with a **signed** actor and a linked character; `public` cannot (`[D5]`, `[D10]`). |
| Whose stock is returned? | Only `getLinkedPlayer(actor.userId)`; no target parameter exists (`[D5]`). |
| Can a guild member query another player's inventory via this? | No. There is no way to name another player; extra body fields are ignored (tested). Staff-level lookups are unchanged and separate. |
| Who can sync a goal in mentat? | The goal's owner only (`owner_type='player' AND owner_id = interaction.user.id`); guild goals refused (`[D1]`). |
| Does guild/admin authority matter? | No — this design adds no admin path; an admin gets no extra read of members' stock. |
| Data at rest | mentat stores only the on-hand integers the player chose to apply — same class as manual entries (Phase 3 `[H11]`); no new PII class, no change to the privacy policy expected (to be confirmed at Layer 1). Core stores nothing new; the audit line has counts only. |

### Redaction and logging

- Core response and audit line contain counts only (`[D7]`, `[D8]`); no character
  name, container names, or item ids in logs.
- mentat passes the payload through the existing output redaction (`src/format.js`
  `redactSecrets`) and never echoes a raw adapter error body beyond the existing
  1,200-character redacted excerpt (`format.js:34`).
- Reply visibility follows the existing `config.discord.defaultEphemeral`
  behavior (`commands.js:504`). Because this reply shows the player's own stock,
  `goal sync` should force ephemeral regardless of that default `[D17]` (confirm
  the mechanism at implementation; the `forcedPublic` branch on the same line shows a
  per-command visibility override already exists for write actions).
- Item ids in mentat logs: none beyond the route key already logged by
  `recordLatency`.

## Failure Modes

| # | Failure | Detected by | Effect | Mitigation |
|---|---|---|---|---|
| FM1 | Core older than this change | 404/403 from adapter | Sync refused | `[D14]` message; manual path intact |
| FM2 | Player not linked | Core 403 `not_linked` | Sync refused | Point to `/dune player link` |
| FM3 | Adapter down/slow | `AbortError` / timeout | Sync refused, nothing written | `[D14]`; timeout already bounded |
| FM4 | DB slow (no index on `dune.items(inventory_id)`) | Route statement timeout `[D9]` | 5xx, nothing written | UAT `EXPLAIN` gate; index only via Requirement 26 |
| FM5 | Id present in catalog but absent/differently spelled in `dune.items` | Returns 0 | Understated on-hand; on `apply` a saved value could be overwritten with 0 | Preview default; UAT id sweep (U1); decrease flagging `[D13]`.4 |
| FM6 | Stock is in a place the query does not see (vehicle, co-owned base) | Player notices | Understated on-hand | `[D11]` documented; split shown; manual override |
| FM7 | DB lags real in-game state | Player notices | Stale number | Message says "as of last game save" (U6) |
| FM8 | Double counting from join fan-out | Reconciliation test vs raw SQL | Overstated | `[D3]` de-dup; explicit test |
| FM9 | bigint returned as string | Unit test | Wrong type/NaN | Explicit conversion + test |
| FM10 | User syncs same goal from two Discord servers backed by different Cores | Embed names the source | Confusing overwrite | `[D16]`, `[R5]` |
| FM11 | Concurrent `sync apply` and `on-hand` by same user | Last write wins | Benign | Same as two `on-hand` calls today |
| FM12 | Discord interaction 3 s ack deadline vs adapter latency | `deferReply` already runs before command dispatch (`commands.js:504`) | None expected | Adapter timeout bounds the follow-up edit |

## Testing Strategy

**Core (`console/api/test/`, real suite per Requirement 8; DB-touching tests follow
the repo's existing integration pattern, e.g. `baseContainerItemDelete.integration.test.js`):**
1. Route: capability matrix (public 403; observer/moderator/admin/owner allowed)
   alongside `test/discordPolicy.test.js` including the `minTierForCapability`
   cross-check loop (`:311`–`:338`).
2. Signature required: unsigned request → rejected when secret configured and when not
   `[D10]`.
3. **Privacy:** body containing another user's `playerControllerId`/`actorId`/
   `discordUserId` returns the *caller's* totals only; unlinked user → 403 `not_linked`.
4. Input validation: 0 ids, 17 ids, non-array, non-string, id with `%`/space/quote/`;`,
   65-char id, duplicates (de-duped), hyphenated real id accepted.
5. Provider: bigint→number, zero-fill, `truncated` never true, no `enrichWithDisplayName`.
6. Query: against the integration fixtures — owned rank 1 counted, rank 2/3 not, hologram
   not, two owned bases summed, backpack summed, gear inventory (type 1/15) not,
   same item in backpack + base splits correctly, fan-out fixture (two `permission_actor_rank`
   rows) does **not** double count, exact match (`Silicone` does not match `SiliconeX`),
   case exactness.
7. Catalog: `buildCommandCatalog()` still succeeds with the new entry (route+metadata
   coverage assertion).
8. Audit line emitted with counts only; no id/total in it.
9. No regression: existing `PLAYERS_FIND`/`inventory` tests untouched and green.

**mentat (`node --test`, mocked adapter — `test/mockAdapter.test.js`/
`test/adapterContract.test.js` fixture style):**
1. `adapterClient.playerStock` request shape and signature over the right path.
2. `config.js` path/method/env override.
3. `goal sync`: preview writes nothing; apply writes only valid nodes; skip-zero-no-entry;
   clamp at 100,000; decrease flagged; previous value printed; audit rows appended;
   completion triggers once.
4. Guild goal id and other-user id → "not found", **zero** adapter calls.
5. Not linked / 403 / 404 / timeout / malformed body → nothing written, manual hint shown.
6. DM invocation refused; feature flag off; cooldown enforced.
7. `goalValidNodes` refactor: existing `on-hand` behavior byte-identical (existing
   Phase 3 tests unchanged and green).
8. Command-budget regression (`test/commands.test.js`, per Phase 3 `[Architect-6]`)
   and `getCommandRegistry()`/`helpPayload()` include `goal sync`.
9. No item-id or count in logs; output passes `redactSecrets`.
10. For every recipe in `CRAFTING_RECIPES`, `goalValidNodes(...).size <= 6`
    (protects the entry cap assumption).

**Live UAT on `dune-dev` only (`dune-dev` is for live experiments; `dune-prod` is
off-limits without explicit Requirement 7 approval).** Prerequisite: the Core branch
deployed to dune-dev by the operator; verify what dune-dev currently runs first
(a memory note on this is marked stale). Steps:
1. **Id sweep (U1):** read-only SQL on dune-dev — every id in `RECIPE_KEY_TO_GAME_ITEM_ID`
   checked against `select template_id, count(*) ... where template_id = any(...)`;
   and `select distinct template_id from dune.items` minus the catalog (size of the
   uncatalogued set; expected small).
2. **Ground truth:** for the operator's test character, compute the expected totals
   with an independent, deliberately un-clever SQL (separate per-base sums) and
   compare to the route for ≥3 ids, including one split across backpack and two bases.
3. **Reconciliation with the existing UI:** sum of `/dune player find query:<id>`
   stack rows (bases) equals `inBases` (mod the hologram filter).
4. **Live movement / lag (U6):** move a known stack in-game between backpack and base
   storage; record how long until the route reflects it.
5. **`EXPLAIN (ANALYZE, BUFFERS)`** of the final query; record plan, timing, whether
   `dune.items(inventory_id)` is used, and the `dune.items` row count (U4). Gate: p95
   well under the 5 s timeout with a realistic player.
6. **Negative paths:** unlinked Discord test user, `public`-tier user, moderator,
   17 ids, malformed id, foreign id in body, unsigned request on a signed deployment,
   adapter stopped/unreachable (point mentat at a dead port, do not stop dune-dev's
   services).
7. **End to end in Discord:** create personal goal → `sync` preview → `sync apply:true`
   → `progress` → verify saved numbers, audit rows, ephemeral reply.
8. Record results in the tracking issue comment (Requirement 20).

## Rollout and Rollback

**Rollout order:** (1) file Core issue + mentat issue, board entries (Requirement 15);
(2) Core branch, tests, Layer 2 audit; (3) merge to fork `main`, **no squash on the
branch that will later go upstream**; (4) operator deploys to dune-dev, UAT above;
(5) mentat branch `feat/goal-live-sync` (mentat's own lifecycle, PR to `main`),
Layer 2/3 audits, merge; (6) mentat feature flag `MENTAT_LIVE_STOCK_ENABLED`
(default off) turned on for dune-dev first `[OD11]`; (7) dune-prod only after explicit
operator approval and after the Core side is deployed there by the operator. mentat
deploys via `git push deploy deploy` with the guardrail test hook (Live Systems);
never deploy mentat before the Core side exists for the target game server, or the
feature will simply report "not supported" (harmless, FM1).

**Rollback:** mentat — flip the flag off, or revert the merge; no data to migrate
(no schema change); already-applied on-hand numbers are ordinary saved entries the
player can edit. Core — revert the route; no schema, no data, no index, nothing to
undo; nothing else calls it. If an index is ever added it is a separate Requirement 26
migration with its own `DROP INDEX` rollback (see `[OD9]`).

## Cross-Repo Sequencing and Upstream Gates

Under the fork lifecycle (Requirement 21): the Core branch is the internal PR and
also the future upstream PR source, so it **stays alive after the internal merge**
until Red-Blink merges or declines; no squash. The upstream draft PR to
`Red-Blink/dune-awakening-selfhost-docker` is out of scope for this document. It must
not be opened until all of these hold: full Core test suite green on the exact SHA
(19a); at least one full live server session on dune-dev (19b); operator-facing
behavior documented in PR body + changelog — here, one new route and one new
capability, nothing else (19c); Eight-Hats Layers 1, 2, 3 completed with findings
filed, CRITICAL/HIGH resolved, STRIDE table, findings posted as tracking-issue
comments, Layer 3 via `/code-review high` per the 2026-09-29 correction (19d, 20);
changed-file list hand-reviewed for fork-internal artifacts (19f); PR body follows
the fixed structure (19g); upstream test-drift check clean (22); branch freshness
re-verified against current `upstream/main` before opening and before marking ready
(29). Open as **draft**. Whether this route goes upstream at all is `[OD13]`.

## Open Decisions for the Operator

| # | Decision | Recommendation |
|---|---|---|
| OD1 | Does "on-hand" include the **backpack**? | Yes; return `inBackpack`/`inBases` separately so it can change without a Core change. |
| OD2 | Count items in **refinery/fabricator** inventories (may include already-committed inputs)? | Yes for v1 (matches `/dune player find` population); revisit with a storage-type allowlist if players report overstatement. |
| OD3 | Count **co-owned/associate** (rank 2/3) bases? | No; rank 1 only (a shared base counts for one person; matches existing `owned`). |
| OD4 | Capability: new `STOCK_SELF_READ` at Player tier, or reuse `INVENTORY_READ` (moderator+)? Also: is `/dune player find` really unusable by Players today (F4)? | New capability at Player tier. Please confirm how your Player role is mapped in Core; the answer affects whether existing player commands are silently broken. |
| OD5 | Require a signed actor on the new route (unsigned deployments get no live sync)? | Require it. |
| OD6 | UX shape: preview-by-default `sync` command vs option on `progress` vs automatic? | `/dune goal sync` with `apply` (D12); Discord confirm buttons later. |
| OD7 | On a live **decrease** during `apply`, just flag it, or require an extra flag? | Flag it; the previous value and restore command are always printed. |
| OD8 | Personal goals are global but live stock is per Core: allow sync from any Discord server, or pin a goal to the server it was first synced from? | Allow, label the source server in every sync embed; pinning is more state than v1 warrants. |
| OD9 | Index on `dune.items(inventory_id)`? | None. Decide only from the dune-dev `EXPLAIN`; if needed it is an opt-in operator step under Requirement 26, never an automatic Core migration on a game-owned table. |
| OD10 | Add a Core-side per-actor rate limiter for this route, given none exists on sibling reads? | Not in v1; rely on N<=16, the 5 s timeout, and the mentat cooldown; revisit at Layer 1. |
| OD11 | mentat kill switch default? | `MENTAT_LIVE_STOCK_ENABLED`, default **off**, enable on dune-dev first. |
| OD12 | Persist provenance (typed vs synced) with an additive nullable column later? | Defer; add only if UAT shows players confusing the two. |
| OD13 | Fork-only first, or plan an upstream Red-Blink PR? | Fork-only first (like `guild-faction-summary`); upstream after the full gate list above. |
| OD14 | Batch cap N | 16. |

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Tier mismatch (F4) makes the feature unusable for Players, or, if "fixed" carelessly by reusing a moderator capability, over-exposes data | High | `[D5]` dedicated capability; `[OD4]` operator confirmation; tests for tier matrix |
| R2 | Cross-player disclosure through a target parameter or signature bypass | High | No target parameter; ignore extra fields (tested); signed actor required `[D10]`; audit |
| R3 | Sum double counts or misses stock, so a player trusts a wrong number | Medium | De-dup inventories; ground-truth and reconciliation UAT; preview default; split shown |
| R4 | Item-id mismatch for some bridge ids (`Oil`, `T5RadiatedCoreComponent`) | Medium | UAT id sweep (U1) before enabling; zero results shown as 0 in preview, not silently applied |
| R5 | Global personal goals + per-server Core: confusing overwrite between two servers | Medium | Name source server; previous value always printed; `[OD8]` |
| R6 | Unindexed scan on a large `dune.items` degrades the DB the game shares | Medium | Bounded statement timeout, N<=16, mentat cooldown, `EXPLAIN` gate; no index without Requirement 26 |
| R7 | Live decrease overwrites a deliberate manual number | Medium | Preview default, decrease flagged, restore command printed, audit rows |
| R8 | Provenance not persisted; later, a saved number's origin is unknowable | Low | Documented; `[OD12]` |
| R9 | Behaviour drift: route classification in mentat tracks Red-Blink, not the fork | Low | `UNMERGED_ROUTES` entry + updated tests; classification is informational |
| R10 | Pre-existing doc drift in Core `API-REFERENCE.md` (GET vs POST) misleads implementers | Low | Fix in the same Core PR (C8) |

## Unverified (could not be established from `origin/main` git objects)

- **U1** Every bridge id spelled identically in live `dune.items.template_id` (esp. `Oil`,
  `T5RadiatedCoreComponent`). Evidence is strong for the catalog namespace, not per-id.
- **U2** Whether the existing owned-search join fans out on real data (multiple
  `actor_fgl_entities`/`permission_actor_rank` rows per placeable). Design de-dups
  regardless.
- **U3** Whether other player-held storage exists in the DB that neither the backpack nor
  rank-1 placeables cover (vehicle cargo is a separate table family; mail; Exchange).
- **U4** Existence of an index on `dune.items(inventory_id)`, and the size of `dune.items`
  on a real server. The game schema is not defined in this repo.
- **U5** Whether items committed to a running craft/refine can be told apart from free stock.
- **U6** How quickly the game persists inventory changes to Postgres (lag between in-game
  action and DB visibility).
- **U7** Whether the async handler is compatible with every existing goal-specific
  wrapper (autocomplete, error formatting); `deferReply` itself is confirmed to run
  first (`commands.js:504`), and the existing goal handlers are synchronous with no I/O.
- **U8** Whether any operator maps the Player role into Core's moderator role list (F4);
  Core reads that from `DISCORD_*_ROLE_IDS` env (`adapter.js:207`–`:210`).
- **U9** Whether dune-dev currently runs the fork's `origin/main` (a note on this is marked stale).
- **U10** Whether a global request limiter sits in front of the adapter in `server.js`
  (only login/mutation limiters were seen, `server.js:9`, `:291`, `:309`–`:310`).

## Follow-Up Work

- **Pre-existing gap to verify separately (F4):** `/dune player find|inventory|storage`
  appear to require moderator tier on Core while mentat presents them as Player commands.
  File as its own issue against Core/mentat; not fixed by this feature.
- Owned `searchItemsInContainers` lacks the `is_hologram` filter the storage listing has
  (`duneDb.js:17069` vs `:17146`); candidate small fix, separate PR.
- Core `docs/console/API-REFERENCE.md:1018`–`:1022` GET-vs-POST drift.
- Discord "Apply" button (ephemeral, owner-only, expiring) replacing the `apply:true` flag.
- Additive `source` column / provenance display (`[OD12]`).
- Multiple characters per Discord account: choose which character to read (today the default).
- Guild scope (Option 2: real guild-base designation in Core) — remains deferred, own
  design, own Requirement 26 migration.
- Catalog drift-check CI (Phase 3 Gap 1) becomes more valuable now that the catalog id
  is also a query key: a drifted id yields 0, not an error.
- Optional storage-type allowlist to exclude refinery inputs (`[OD2]`).
