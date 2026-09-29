# Goal & Order Tracking — Design (Phase 3)

**Status:** design, not yet implemented. Depends on nothing else (Phase 3 no
longer depends on Phase 2 — see `docs/crafting-resource-planning-overview.md`).

**Spec context:** this is Phase 3 of the three-phase crafting/resource-planning
effort described in `docs/crafting-resource-planning-overview.md`. Phase 1
(`/dune data calculator`) shipped as PR #417 and is the sole source of
crafting-math reuse this design depends on (`src/craftingCalculator.js`,
`src/craftingData.js`, `src/embedFormat.js`'s rendering conventions).

## Goal

Let a player or a guild leader/officer set a persistent farming target for
*any* item in the game (not just the 15 items the calculator knows recipes
for), then track progress against it over time via self-reported on-hand
updates — without re-entering the full request from scratch every time, and
without needing live game-data integration (Phase 2, deferred).

**One goal model, not two.** A guild "order" (e.g. "need 10,000 Plastanium by
next week's Deep Desert base") is the same object as an open-ended goal,
distinguished only by an optional `due_at` — `null` for a standing goal, set
for a time-boxed order. Same table, same commands, same progress logic.

## Decisions Locked In This Session

- **On-hand data source: Option 1 (manual entry), not Option 2 (base
  querying).** A leader/officer (guild) or the owning player (personal)
  types the current on-hand number(s); nothing is queried from Core. See
  `docs/crafting-resource-planning-overview.md`'s Phase 3 section for the
  full investigation (Core has no first-class "guild base" concept) that
  led to this choice.
- **Guild goal RBAC: map onto existing tiers, no new "officer" concept.**
  mentat's RBAC (`src/rbac.js`) only has `observer < moderator < admin <
  owner`, with `owner` = live Discord server ownership — there is no
  "guild leader/officer" concept anywhere in the codebase. Guild goal
  create/on-hand-update/delete requires `admin` tier or Discord-owner
  (reusing `isAdminActor()`); read (`list`/`progress`) is open to any
  member. **Known limitation, not fixed here:** if a server hasn't
  configured `admin`-tier role mappings, only the literal Discord account
  that owns the server can manage guild goals — flagged in the user guide,
  not solved by new RBAC work (that would be its own, separate design).
- **Concurrent limit: 5 active personal / 10 active guild goals.** Fixed,
  enforced at creation. Completed/archived goals don't count toward it.
- **Goal targets: any of the 2,558 items in Core's `admin-items.json`
  catalog, not just the 15 calculator items.** See "Item Catalog" below.
- **Personal goals are global** (keyed by `discord_user_id` only, no
  `guild_id`) — a deliberate deviation from this repo's usual per-Discord-
  server-scoped table convention (`guild_settings`, `live_messages`),
  because a farming goal belongs to the player, not to whichever Discord
  server they happened to invoke the command from.

## Item Catalog & Identity

Core ships a real, comprehensive, static item catalog:
`runtime/data/admin-items.json` in `dune-awakening-selfhost-docker` — 2,558
rows, each `{id, name, category, group, source, stackSize, volume}`, human-
curated (10 commits total in its history), already used by Core's own admin
tooling (`GET /api/admin/items/catalog`). **It has zero ingredient/recipe
data** — confirmed by reading its full schema — so it can identify and name
any item in the game, but it cannot tell you what it costs to craft one.
mentat's own 15-item `CRAFTING_RECIPES` table remains the only source of
crafting math anywhere in this ecosystem.

**Design: vendor a copy into mentat, unfiltered.**
- New file `src/gameItemCatalog.js` (or a bundled JSON asset + a thin loader,
  matching `craftingData.js`'s existing "frozen, versioned data" pattern) —
  the full 2,558-item list, used as the autocomplete/validation source for
  `/dune goal create`'s `item` option. Zero new Core code required — the
  file is static, so this is a one-time copy, not a live dependency.
- Unfiltered by category: Discord autocomplete only surfaces the top 25
  matches for whatever the user has typed, so a large catalog isn't a UX
  problem the way it would be in a full dropdown.
- **Identity bridge to the calculator:** add a `gameItemId` field to every
  `CRAFTING_RECIPES` and `LEAF_RESOURCES` entry in `craftingData.js` (e.g.
  `duraluminum_ingot` → `gameItemId: "DuraluminumRod"`), additive only, no
  renaming of existing snake_case keys (Phase 1's code/tests are untouched).
  Build a reverse lookup (`gameItemId → recipe key`) once at module load.
  A goal's stored `item_id` is always the catalog's real game ID; if it
  resolves via the reverse lookup to a known recipe, the goal gets the full
  calculator treatment (see "Progress Calculation" below); otherwise it's a
  "simple" goal.
- **Gap, explicitly accepted, not solved by this design:** Core's file can
  drift from mentat's vendored copy over time. Remediation (see "Follow-up
  Work" below): a scheduled CI check, not a blocking gate on this feature.

## Data Model

Two new SQLite tables in `src/database.js`, following this repo's existing
conventions exactly (snake_case, `CREATE TABLE IF NOT EXISTS` — additive, no
`SCHEMA_VERSION` bump needed per the existing migration convention since no
column ALTERs are involved; CHECK-constrained enums; `created_at`/
`updated_at` via `datetime('now')`; `ON DELETE CASCADE` for the child table):

```sql
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('player', 'guild')),
  owner_id TEXT NOT NULL,        -- discord_user_id (player) or Discord guild_id (guild)
  item_id TEXT NOT NULL,         -- canonical game item id (gameItemCatalog / gameItemId)
  item_kind TEXT NOT NULL CHECK (item_kind IN ('craftable', 'simple')),
  target_quantity INTEGER NOT NULL CHECK (target_quantity BETWEEN 1 AND 1000000),
  station_tier TEXT,             -- only meaningful when item_kind = 'craftable'
  crafting_contract INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,                   -- nullable: null = standing goal, set = time-boxed order
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_by TEXT NOT NULL,      -- discord_user_id who created it (audit only, not ownership for guild goals)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_goals_owner ON goals(owner_type, owner_id, status);

CREATE TABLE IF NOT EXISTS goal_on_hand_entries (
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  node TEXT NOT NULL,            -- ingredient item_id for craftable goals; = goals.item_id for simple goals
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 0 AND 100000),
  updated_by TEXT NOT NULL,      -- discord_user_id of whoever last set this entry
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (goal_id, node)
);
```

A craftable goal can carry up to 6 on-hand entries (matching Phase 1's
`on-hand-1..6` option cap) — tracking progress on intermediate ingredients as
they're gathered, not just "how much of the finished item do I already
have." A simple goal (anything outside `CRAFTING_RECIPES`) only ever has one
row: `node = goals.item_id`.

## Command Surface

All under a new `/dune goal` group in `src/commands.js`, following the
existing `SlashCommandBuilder` option/autocomplete/embed conventions Phase 1
already established:

- **`/dune goal create scope:<personal|guild> item:<autocomplete> quantity:<1-1,000,000> [due-at] [station-tier] [crafting-contract]`**
  Creates. `item` autocompletes against the full vendored catalog. `scope:guild`
  requires `admin` tier or Discord-owner; enforces the 5/10 active-goal cap
  before insert, listing existing goals in the rejection message if hit.
  `due-at` is a plain ISO date string (`YYYY-MM-DD`), validated and rejected
  with a clear error if malformed or already in the past — omitted means a
  standing goal (`due_at = null`). `station-tier`/`crafting-contract` are
  only valid when the resolved `item_kind` is `craftable`; supplying either
  for a `simple`-kind item is rejected outright ("this item has no known
  crafting recipe — station-tier/crafting-contract don't apply"), not
  silently ignored. When `item_kind` is `craftable` and `station-tier` is
  omitted, it defaults to Large — identical to Phase 1's own default
  behavior, including the same known rough edge (9 of 15 items have no
  Large variant and will error asking for an explicit tier).
- **`/dune goal on-hand id:<autocomplete> node:<autocomplete> quantity:<0-100,000>`**
  Sets (replaces, does not increment) one ingredient's on-hand quantity.
  `id` autocompletes to the caller's own personal goals, or their guild's
  goals if the target goal is guild-scoped (RBAC-gated the same as create).
  `node` autocompletes via `recipeTreeNodes(goal.item_id)` (reusing Phase
  1's existing function verbatim) for craftable goals, or is fixed to the
  goal's own item for simple goals. The confirmation embed shows the
  previous value, who set it, and when — the visible remediation for
  last-write-wins concurrency (see Gaps below), not a lock.
  If the update makes progress meet or exceed the target, auto-marks the
  goal `completed` and appends a short success note to the same response —
  no new notification infrastructure.
- **`/dune goal list scope:<personal|guild> [include-completed]`**
  One-line-per-goal summary (item, target, % progress, overdue flag if
  `due_at` has passed on an active goal).
- **`/dune goal progress id:<autocomplete>`**
  Full detail view. For craftable goals, calls `calculateCraftingPlan()` →
  `applyOnHandCredit()` → `estimateDuration()` with the goal's stored
  `target_quantity`/`station_tier`/`crafting_contract` and its
  `goal_on_hand_entries` rows mapped straight into the `onHandEntries`
  array shape `[{node, quantity}]` — the exact same functions and shapes
  Phase 1 already uses, zero new calculation code. Rendered via a thin
  wrapper around `formatCalculatorEmbed()`. For simple goals: a small
  embed showing `remaining = max(0, target_quantity - on_hand)`, no
  station/duration fields (there's no "craft time" for a raw resource).
- **`/dune goal delete id:<autocomplete>`**
  Deletes (hard delete, cascades to `goal_on_hand_entries`). Same RBAC as
  create/on-hand for guild goals; personal goals require `created_by` match.

## RBAC Summary

| Action | Personal goal | Guild goal |
|---|---|---|
| create | any linked-or-not Discord user (identity-only) | `admin` tier or Discord-owner |
| on-hand update | `created_by` match only | `admin` tier or Discord-owner |
| delete | `created_by` match only | `admin` tier or Discord-owner |
| list / progress (read) | `created_by` match only | any guild member (`observer`+) |

No new RBAC concept introduced — this table is entirely existing-tier
lookups (`isAdminActor()`, `isGuildOwner()`) plus a plain identity comparison
for personal goals. No linked-player requirement (Core's
`console.discord_account_links` is never consulted) — goals are keyed
directly to the Discord user/guild ID, consistent with Phase 1 never
requiring a linked player either.

## Gaps — Explicit, With Remediation or Explicit Non-Remediation

1. **Catalog staleness** (mentat's vendored `admin-items.json` copy vs.
   Core's real file). *Remediated via follow-up work, not blocking this
   design*: a scheduled GitHub Actions workflow in mentat (cron-triggered,
   same convention as the existing `semgrep.yml`) fetches Core's file via
   GitHub's raw-content API and diffs it against the vendored copy, filing
   a GitHub issue on drift. Not built as part of this spec's initial
   implementation plan — tracked as an explicit follow-up task.
2. **RBAC ceiling** (only the Discord server owner can manage guild goals
   until `admin`-tier role mappings exist). *Remediated via UX, not code*:
   a clear, specific error message on a permission denial, plus a
   user-guide callout referencing `/dune config`'s existing role-mapping
   command.
3. **Zero verification of self-reported numbers.** *Not remediated here,
   by design* — this is Phase 2's entire purpose, already deliberately
   deferred (see `docs/crafting-resource-planning-overview.md`). Stated
   explicitly so it reads as an accepted boundary, not an oversight.
4. **Concurrent guild on-hand updates: last-write-wins per ingredient
   node.** *Remediated via transparency, not locking*: the update
   confirmation shows the previous value, who set it, and when.
5. **No historical trend/rate tracking** (the origin spreadsheet's
   throughput calculators — "how many Deathstills to hit this rate"). *Not
   remediated — genuinely separate, future feature*, out of this design's
   scope entirely, not a completeness gap in it.
6. **`docs/architecture.md`'s persisted-table list is already stale**
   (lists tables dropped in schema v7). *Pre-existing, unrelated to this
   design* — fixed as its own tiny, separate PR, not bundled into this
   feature's diff.

## Testing Notes (for the eventual implementation plan)

- Reuse Phase 1's exact worked examples where a craftable goal's target/
  on-hand matches one of `calculator-design.md`'s scenarios — progress
  output must match byte-for-byte (same functions, same inputs).
- New coverage needed: cap enforcement (5th/6th personal, 10th/11th guild
  goal rejected with a listing), RBAC denial paths (non-admin guild-goal
  mutation attempts), auto-completion on a crossing update, simple-goal
  math (no recipe, no station/duration fields), the `gameItemId` reverse
  lookup (every `CRAFTING_RECIPES`/`LEAF_RESOURCES` entry resolves
  correctly, and a non-recipe catalog item correctly resolves to `simple`).

## Follow-Up Work (not part of this feature's own implementation plan)

- Catalog drift-check CI workflow (Gap 1).
- `docs/architecture.md` stale table list fix (Gap 6) — small, separate PR.
- Phase 2 (live stock integration) — remains fully independent, optional,
  not started.
