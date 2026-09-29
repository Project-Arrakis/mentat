# Goal & Order Tracking — Design (Phase 3)

**Status:** design, not yet implemented. Depends on nothing else (Phase 3 no
longer depends on Phase 2 — see `docs/crafting-resource-planning-overview.md`,
whose own fix for this landed in PR #418, merged 2026-09-29).

**Spec context:** this is Phase 3 of the three-phase crafting/resource-planning
effort described in `docs/crafting-resource-planning-overview.md`. Phase 1
(`/dune data calculator`) shipped as PR #417 and is the sole source of
crafting-math reuse this design depends on (`src/craftingCalculator.js`,
`src/craftingData.js`, `src/embedFormat.js`'s rendering conventions).

**Audit status:** this design went through a full Eight-Hats Layer 1 audit
(tracking issue [`mentat`#420](https://github.com/Project-Arrakis/mentat/issues/420)).
3 Critical and 12 High findings were found and are resolved in this revision
— see each section below for what changed and why. The findings that drove
each change are cited inline as `[C1]`/`[H3]`/`[SEC-6]` etc. so a future
reader can trace a design decision back to its audit finding.

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
  that owns the server can manage guild goals. `[C3]` The remediation for
  this is a **web** flow, not a Discord command — see Gap 2 below for the
  corrected text (an earlier draft of this design cited a nonexistent
  `/dune config` command).
- **Concurrent limit: 5 active personal / 10 active guild goals.** Fixed,
  enforced at creation. Completed/archived goals don't count toward it.
  `[SEC-5]` Total lifetime goals per owner (including completed/archived)
  are also capped — see Data Model below — closing an unbounded-growth path
  where a create-then-immediately-complete loop would otherwise bypass the
  active-only cap indefinitely.
- **Goal targets: any of the 2,558 items in Core's `admin-items.json`
  catalog, not just the 15 calculator items.** See "Item Catalog" below.
- **Personal goals are global** (keyed by `discord_user_id` only, no
  `guild_id`) — a deliberate deviation from this repo's usual per-Discord-
  server-scoped table convention (`guild_settings`, `live_messages`),
  because a farming goal belongs to the player, not to whichever Discord
  server they happened to invoke the command from. The Architect hat
  reviewed this specifically given the deviation and confirmed it's safe:
  every personal-goal check is gated on Discord's own signed
  `interaction.user.id`, which can't be spoofed across guilds, so this
  doesn't create a cross-tenant leak the way the guild-goal binding gap did
  (`[H1]`, fixed below).
- **`[H11]` Data classification: no PII, low sensitivity, consistent with
  existing tables.** This is the first feature in the crafting/resource-
  planning effort to persist real, indefinite, Discord-identity-linked
  data, and unlike Phase 1 (stateless) it needed an explicit classification
  pass rather than inheriting Phase 1's "no PII" conclusion by assumption.
  Conclusion: `discord_user_id`/guild_id plus a farming target/quantity is
  the same class of data this repo already persists indefinitely with no
  stated TTL (`guild_member_activity`, `stats_snapshot`, `bot_stats`) — no
  new sensitivity tier, no change to the live Privacy Policy
  (`docs/privacy-policy.md`) needed. This conclusion, not just its absence,
  is the deliverable — a future reviewer should be able to see this was
  checked, not assumed.

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
- **`[GRC-4]` Provenance comment required**, matching `craftingData.js`'s
  own established attribution precedent (per `calculator-grc.md`): a header
  comment naming the source repo/path (`dune-awakening-selfhost-docker`'s
  `runtime/data/admin-items.json`) and the commit SHA/date it was copied
  from, so a future reviewer has a traceable paper trail, the same reason
  Phase 1's recipe data carries one.
- **`[QA-catalog]` Duplicate IDs exist in the real source file — must be
  deduplicated at vendor time, not discovered later.** The Security hat's
  own independent check of the real 2,558-row file found 7 duplicate `id`
  values (e.g. `UniqueThumper_02` maps to both "Clapper Mk2" and "Wormsong
  Echo"), plus some placeholder names (`EMPTY_TEXT`, `PH_*`). The vendoring
  step must dedupe by `id` (first occurrence wins, or an explicit manual
  resolution list) before the catalog is bundled — an ambiguous `id` would
  make `item_id` resolution genuinely undefined behavior. A unit test must
  assert the bundled catalog has zero duplicate `id`s after dedup.
- Unfiltered by category: Discord autocomplete only surfaces the top 25
  matches for whatever the user has typed, so a large catalog isn't a UX
  problem the way it would be in a full dropdown.
- **`[H2]` Identity bridge to the calculator — corrected design.** An
  earlier draft of this design proposed adding a `gameItemId` field
  directly onto `CRAFTING_RECIPES`/`LEAF_RESOURCES` entries. The Architect
  hat found this doesn't work as stated: `LEAF_RESOURCES` values are plain
  strings (`Object.freeze({water: "Water", ...})`), not objects — you
  cannot "add a field" to a string without a breaking shape change that
  touches three real call sites (`craftingCalculator.js`'s
  `recipeTreeNodes()`, `embedFormat.js`'s display-name resolution, and
  reshapes what `test/craftingData.test.js` reads), directly contradicting
  this design's own goal of leaving Phase 1 untouched.
  **Corrected design:** a standalone bridge module,
  `src/gameItemIdBridge.js`, holding two frozen `Map`s built once at module
  load — `RECIPE_KEY_TO_GAME_ITEM_ID` (hand-authored, one entry per
  `CRAFTING_RECIPES`/`LEAF_RESOURCES` key) and its reverse,
  `GAME_ITEM_ID_TO_RECIPE_KEY`. **`[SEC-3]` Both are real `Map`s, never
  plain objects** — this repo already has one real prototype-pollution
  finding from Phase 1 (FINDING-CALC-3/S-2: a bare-object lookup let
  `"__proto__"`/`"constructor"`/`"toString"` resolve as truthy instead of
  throwing) and this bridge repeats the exact same shape of lookup, now
  with *persisted* data instead of Phase 1's stateless one, making a repeat
  of that bug strictly worse. `CRAFTING_RECIPES`/`LEAF_RESOURCES`
  themselves are not touched at all — genuinely additive, not a rename.
  A goal's stored `item_id` is always the catalog's real game ID
  (`gameItemCatalog.js`'s `id` field); resolving it through
  `GAME_ITEM_ID_TO_RECIPE_KEY.get(item_id)` at creation time determines
  `item_kind`: a hit means `craftable`, a miss means `simple`.
- **Gap, explicitly accepted, not solved by this design:** Core's file can
  drift from mentat's vendored copy over time. Remediation (see "Follow-up
  Work" below): a scheduled CI check, not a blocking gate on this feature.

## Data Model

Three SQLite tables in `src/database.js` (two feature tables plus an audit
log — see `[H12]` below), following this repo's existing conventions
exactly (snake_case, `CREATE TABLE IF NOT EXISTS` — additive, no
`SCHEMA_VERSION` bump needed, verified directly against `createDatabase()`:
`db.exec(SCHEMA)` (database.js:201) runs the *entire* SCHEMA string
unconditionally on every startup, so a new `CREATE TABLE IF NOT EXISTS`
appears automatically for existing installs with zero migration code,
exactly matching the `live_messages`/`key_versions` precedent; CHECK-
constrained enums; `created_at`/`updated_at` via `datetime('now')`;
`ON DELETE CASCADE` for the child table, which the DBA hat confirmed works
at runtime since `db.pragma("foreign_keys = ON")` is already set
unconditionally in `createDatabase()`):

```sql
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('player', 'guild')),
  owner_id TEXT NOT NULL,        -- discord_user_id (player) or Discord guild_id (guild)
  item_id TEXT NOT NULL,         -- canonical game item id (gameItemCatalog's real id)
  item_kind TEXT NOT NULL CHECK (item_kind IN ('craftable', 'simple')),
  -- [C2] Capped at 100,000, not 1,000,000: calculateCraftingPlan()/
  -- applyOnHandCredit() both hard-cap at MAX_QUANTITY=100000 and throw
  -- above it. A target above that is schema-legal but permanently breaks
  -- /dune goal progress for that goal -- the Architect and Security hats
  -- independently found this as a Critical/Medium finding respectively.
  -- The bound here MUST match craftingCalculator.js's real MAX_QUANTITY.
  target_quantity INTEGER NOT NULL CHECK (target_quantity BETWEEN 1 AND 100000),
  station_tier TEXT,             -- only meaningful when item_kind = 'craftable'
  crafting_contract INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,                   -- nullable: null = standing goal, set = time-boxed order
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  created_by TEXT NOT NULL,      -- audit only -- see [SEC-2] below, NEVER used for authorization
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

-- [H12][SEC-8] Append-only audit log, closing the "fully ephemeral audit
-- trail" GRC/Security finding. goal_id is deliberately NOT a foreign key:
-- this table must survive a goal's hard-delete so a dispute about a
-- deleted goal still has something to check. Written alongside every
-- create/on-hand-update/delete/auto-complete, in the same transaction as
-- the mutation it records.
CREATE TABLE IF NOT EXISTS goal_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'on_hand_update', 'complete', 'delete')),
  actor_id TEXT NOT NULL,        -- discord_user_id who performed the action
  node TEXT,                     -- set only for 'on_hand_update'
  previous_quantity INTEGER,     -- set only for 'on_hand_update'
  new_quantity INTEGER,          -- set only for 'on_hand_update'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goal_audit_log_goal ON goal_audit_log(goal_id);
```

**`[H8]` Cap enforcement, corrected to be actionable, not just a count.**
Creation checks two counts before insert: active goals for the 5/10 cap,
and total lifetime goals (active + completed + archived) against a higher
ceiling (`[SEC-5]`, e.g. 50) to close the create-then-complete unbounded-
growth path. On rejection, the response lists each existing goal **with its
numeric `id`**, so the user can immediately `/dune goal delete id:<>` one
without a separate `/dune goal list` round-trip.

**`[DBA-F3]` `item_kind`/`station_tier`/`crafting_contract` cross-field
consistency is enforced only in application code, not a DB-level CHECK** —
consistent with existing precedent elsewhere in this schema (e.g.
`guild_settings`'s `schedule_type`/`schedule_channel` aren't cross-validated
at the DB layer either). Stated explicitly rather than left implicit.

**`[Architect-4]` Accepted gap: no cleanup path for a guild's goals if the
guild disconnects.** Every other guild-scoped table (`guild_roles`,
`guild_settings`, `live_messages`) cascades via a real `guild_id → guilds`
foreign key; `goals.owner_id` is polymorphic (a Discord guild_id OR a
Discord user_id depending on `owner_type`), which SQLite has no conditional
FK support for. If a guild is removed, its `goals`/`goal_on_hand_entries`/
`goal_audit_log` rows become orphaned with no automated cleanup. Given the
low blast radius (stale rows in a local SQLite file, already covered by
`[H11]`'s data-classification conclusion — no new sensitivity), this is
accepted as a documented limitation rather than built now; a future
cleanup hook (triggered wherever a guild's own row transitions out of
`active`) is a candidate follow-up, not a blocker.

**`[GRC-6]` Rollback path (Requirement 26):** all three tables are purely
additive (`CREATE TABLE IF NOT EXISTS`, no `ALTER TABLE`) and mutually
isolated from every other table in the schema (only the one internal
`goal_on_hand_entries → goals` FK). Rollback, if ever needed, is
`DROP TABLE IF EXISTS goal_audit_log; DROP TABLE IF EXISTS
goal_on_hand_entries; DROP TABLE IF EXISTS goals;` (child-then-parent
order) — zero blast radius on any other feature, matching the same
precedent `live_messages`'s own rollback comment already documents in
`database.js`.

## Command Surface

All under a new `/dune goal` group in `src/commands.js`, following the
existing `SlashCommandBuilder` option/autocomplete/embed conventions Phase 1
already established. **`[H9]` The new group must be added to both
`getCommandRegistry()` and `helpPayload()`** — Phase 1's own final review
caught exactly this class of bug once already (a shipped command silently
missing from `/dune core help` and the public `GET /api/commands` landing-
page accordion); this is a named requirement here so it isn't rediscovered
the same way a second time.

**`[H1][SEC-1] Binding rule — applies to every command below that takes an
`id`.** An earlier draft of this design gated guild-goal mutations on
"`admin` tier or Discord-owner" without ever checking that the *target
goal* belongs to the *current* guild. Since anyone can own a Discord server
(`isGuildOwner()` is just `actorId === guild.ownerId`), a literal
implementation would let anyone stand up their own server, pass the
admin/owner check there, and then free-type another guild's numeric `id` to
tamper with or read it. **Every `id`-scoped operation (`on-hand`, `delete`,
`progress`) must load the row scoped by ownership in the same query, not
filter after the fact** — `WHERE id = ? AND owner_type = ? AND owner_id = ?`
— so a mismatched `id` reads as "not found," never leaking whether it
exists under a different owner. For guild goals, `owner_id` must equal
`interaction.guildId`; for personal goals, `owner_id` must equal
`interaction.user.id` (**`[SEC-2][Architect-5]` never `created_by`** — see
the RBAC Summary below for why that distinction matters).

**`[SEC-7]` Guild-context requirement.** `scope:guild` and every guild-goal
mutation require `interaction.inGuild()` to be true, with `interaction.guildId`
non-null. In a DM, `isAdminActor()` falls through to an env-var admin
allowlist unrelated to any real guild — a command run there must be
rejected outright with a clear "guild goals require running this in a
server" message, never silently coerced into a shared or null-keyed bucket.

- **`/dune goal create scope:<personal|guild> item:<autocomplete> quantity:<1-100,000> [due-at] [station-tier] [crafting-contract]`**
  Creates. `[C2]` `quantity` is capped at 100,000, matching
  `craftingCalculator.js`'s real `MAX_QUANTITY` (corrected from an earlier
  draft's 1,000,000, which was schema-legal but would permanently crash
  `/dune goal progress` for any craftable goal above 100,000 — a realistic
  target given this design's own "10,000 Plastanium" example). `item`
  autocompletes against the full vendored catalog. `scope:guild` requires
  `admin` tier or Discord-owner AND `interaction.inGuild()` (`[SEC-7]`);
  enforces both cap checks before insert (see Data Model's cap-enforcement
  note, `[H8]`). `due-at` is a plain ISO date string (`YYYY-MM-DD`),
  validated and rejected with a clear error if malformed or already in the
  past — omitted means a standing goal (`due_at = null`). `station-tier`/
  `crafting-contract` are only valid when the resolved `item_kind` is
  `craftable`; supplying either for a `simple`-kind item is rejected
  outright ("this item has no known crafting recipe — station-tier/
  crafting-contract don't apply"), not silently ignored — `[H7]` this
  rejection path needs its own test, not just the read-side rendering
  difference. When `item_kind` is `craftable` and `station-tier` is
  omitted, it defaults to Large — identical to Phase 1's own default
  behavior, including the same known rough edge (9 of 15 items have no
  Large variant and will error asking for an explicit tier). **`[UI/UX]`
  The creation confirmation must state which kind was resolved**
  ("Tracking with full crafting math" vs. "Tracking as a simple count — no
  known crafting recipe for this item") — otherwise the distinction is
  invisible until the user later runs `/dune goal progress`, a real
  first-use surprise given ~2,543 of the 2,558 catalog items resolve to
  `simple`. Writes a `goal_audit_log` row (`action='create'`).
- **`/dune goal on-hand id:<autocomplete> node:<autocomplete> quantity:<0-100,000>`**
  Sets (replaces, does not increment) one ingredient's on-hand quantity.
  `id` autocompletes to the caller's own personal goals, or their guild's
  goals if `scope:guild` and RBAC-gated the same as create — `[SEC-6]`
  **this autocomplete must apply the same ownership/tier scoping as the
  real command itself**, not just the UI suggestion list, since Discord
  autocomplete interactions bypass this bot's normal `isCommandAllowed`/
  cooldown pipeline entirely (`src/index.js`'s autocomplete branch routes
  straight to the handler — confirmed by reading it directly) and a
  DB-backed autocomplete with no inline scoping would leak other owners'
  goal labels on every keystroke. `node` autocompletes via
  `recipeTreeNodes(goal.item_id)` for craftable goals, or is fixed to the
  goal's own item for simple goals — but **`[SEC-3]` autocomplete is a
  suggestion, not enforcement**: the command handler itself must
  server-side validate `node` against `new Set(recipeTreeNodes(...).map(n
  => n.key))` (craftable) or `node === goal.item_id` (simple) before
  writing, and must enforce the "at most 6 entries per craftable goal, 1
  for simple" cap inside the same DB transaction as the insert — a
  free-typed `node` value bypassing the autocomplete's suggestions would
  otherwise insert an unbounded number of rows per goal with no
  server-side gate. The confirmation embed shows the previous value, who
  set it, and when — the visible remediation for last-write-wins
  concurrency (Gap 4 below), not a lock. Writes a `goal_audit_log` row
  (`action='on_hand_update'`, with `node`/`previous_quantity`/
  `new_quantity`). If the update makes progress meet or exceed the target,
  auto-marks the goal `completed`, sets `completed_at`, writes a second
  `goal_audit_log` row (`action='complete'`), and appends a short success
  note to the same response — no new notification infrastructure.
  **`[C1]` Progress calculation, corrected — see the `/dune goal progress`
  entry below; this command's on-hand write path is unaffected by that
  fix, only the read/render path is.**
- **`/dune goal list scope:<personal|guild> [include-completed]`**
  One-line-per-goal summary (item, target, % progress, overdue flag).
  `[H6]` The overdue flag requires BOTH `due_at` has passed AND
  `status = 'active'` — an order that completed before its deadline must
  never show as overdue just because `due_at` is now in the past, and a
  standing goal (`due_at IS NULL`) never shows the flag at all.
- **`/dune goal progress id:<autocomplete>`**
  Full detail view. `[C1]` **Corrected design — an earlier draft claimed
  "zero new calculation code," which the Architect hat found false.**
  Phase 1's `executeCalculator()` doesn't hand `onHandEntries` straight to
  `applyOnHandCredit()` — it first runs a mandatory "Step A": extracts any
  on-hand entry matching the target item *itself* (which this design's own
  `node` autocomplete legitimately offers, since `recipeTreeNodes()`
  includes the root item), computes `effectiveQuantity = quantity -
  targetItemOnHand`, calls `calculateCraftingPlan()` at `effectiveQuantity`
  (never the raw target), and hand-builds a zero-credit result when
  `effectiveQuantity === 0` because `calculateCraftingPlan()` can't accept
  `0`. Skipping Step A — which the original draft did — makes `/dune goal
  progress` throw the moment a player credits their own finished-item
  stock, the feature's primary expected use case, not an edge case.
  **Fix: factor Step A out of `executeCalculator()` into a small, shared,
  exported function** (e.g. `resolveEffectiveOnHandCredit(itemKey,
  quantity, onHandEntries)` in `craftingCalculator.js`) that both
  `executeCalculator()` and this new goal-progress path call. This is a
  minimal, additive refactor of Phase 1 — extracting existing, already-
  tested logic into a shared function, not writing new calculation logic —
  and the claim should read "reuses Phase 1's full on-hand-credit pipeline
  via a small shared-function extraction," not "zero new code." For
  craftable goals: `resolveEffectiveOnHandCredit()` → `calculateCraftingPlan()`
  → `applyOnHandCredit()` → `estimateDuration()`, using the goal's stored
  `target_quantity`/`station_tier`/`crafting_contract` and its
  `goal_on_hand_entries` rows mapped into the `onHandEntries` array shape.
  Rendered via a thin wrapper around `formatCalculatorEmbed()` — `[QA-F8]`
  note this wrapper is itself new code (a goal-specific title, a due-date/
  overdue line) and needs its own dedicated test coverage; reusing Phase
  1's fixtures proves the *reused core sections* are unbroken but cannot
  prove the wrapper's own new chrome is correct. For simple goals: a small
  embed showing `remaining = max(0, target_quantity - on_hand)`, no
  station/duration fields (there's no "craft time" for a raw resource).
  **`[SEC-4]` Per-row error isolation in `list`:** because stored data
  (`item_kind`, `station_tier`) can go stale across mentat releases (a
  recipe removed, a tier no longer offered), `/dune goal list`'s inline
  progress computation for each row must be individually try/caught — one
  poisoned row must show "unavailable" for that line, not take down the
  whole list for every guild member.
- **`/dune goal delete id:<autocomplete>`**
  Deletes (hard delete, cascades to `goal_on_hand_entries` via the FK; the
  `goal_audit_log` row for `action='delete'` is written first, in the same
  transaction, and is *not* cascaded — it deliberately survives the goal's
  deletion). Same RBAC and binding rule as on-hand/progress above.

**`[SEC-9]` Redaction safety.** Every command response passes through
`redactSecrets()` (`src/format.js`) before rendering. Its existing
label/pattern matching will false-positive on real item names containing
"Token"/"Secret" (Core's real catalog has several — e.g. "Raider Token",
"Ixian Secret") if a goal payload is built as an item-keyed object (`{[item_id]:
quantity}`) or a `"Name: quantity"` label string, both of which trip
`redactSecrets()`'s existing patterns. **All goal-related payloads must use
fixed field names** (`{itemId, itemName, onHand, target}`), never a
caller-supplied key or a labeled string — this also naturally satisfies
`[SEC-3]`'s Map/object-shape guidance. A test creating a goal for an item
whose name contains "Token" must confirm the real name renders, not
`[REDACTED]`.

**`[Architect-6]` Discord command-budget check required before
implementation is considered complete.** `test/commands.test.js` already
carries a regression test enforcing `/dune`'s combined name/description/
choice budget stays under Discord's 8,000-character limit — added because
Phase 1's calculator subcommand alone (17 options) nearly exhausted it. The
new `/dune goal` group adds roughly 13 more options across 5 subcommands.
The implementation plan must re-run/extend that same regression test after
drafting real option descriptions, not assume there's headroom.

**`[UI/UX]` Accepted limitation: guild on-hand updates are necessarily
admin/owner-only.** Mapping RBAC onto existing tiers (this design's own
locked-in decision) means rank-and-file guild members contributing toward a
shared goal cannot self-report their own progress — every update routes
through an admin or the owner. This is a real operational bottleneck for
the feature's core "track progress as a group" value proposition, not just
an RBAC-consistency detail; stated explicitly here rather than left as a
side effect of the RBAC table, and flagged as a candidate follow-up
(a lighter-weight "contribute" permission) if it proves to be real friction
in practice.

## RBAC Summary

| Action | Personal goal | Guild goal |
|---|---|---|
| create | any Discord user (identity-only) | `admin` tier or Discord-owner, and `interaction.inGuild()` |
| on-hand update | `goal.owner_id === interaction.user.id` | `admin` tier or Discord-owner, `goal.owner_id === interaction.guildId` |
| delete | `goal.owner_id === interaction.user.id` | `admin` tier or Discord-owner, `goal.owner_id === interaction.guildId` |
| list / progress (read) | `goal.owner_id === interaction.user.id` | any guild member (`observer`+), `goal.owner_id === interaction.guildId` |

**`[SEC-2][Architect-5]` `created_by` is audit-only and must never be used
for authorization — corrected from an earlier draft that keyed personal-
goal permission checks off it.** The distinction matters concretely: an
admin who creates a guild goal and is later de-roled must lose control over
it immediately, which only holds if authorization is re-derived from
`isAdminActor()` at call time against the stored `owner_id`, never from
"did this actor create it." For personal goals, the invariant is: `owner_id`
and `created_by` are always identical at creation time, but permission
checks compare against `owner_id`, never `created_by` — stated explicitly
so an implementer can't reasonably write one generic
`actor === created_by` check and accidentally cover both cases incorrectly.

No new RBAC concept introduced — this table is entirely existing-tier
lookups (`isAdminActor()`, `isGuildOwner()`) plus a plain identity
comparison for personal goals, both now explicitly bound to the stored
row's `owner_id` per `[H1]`/`[SEC-1]` above. No linked-player requirement
(Core's `console.discord_account_links` is never consulted) — goals are
keyed directly to the Discord user/guild ID, consistent with Phase 1 never
requiring a linked player either.

## Gaps — Explicit, With Remediation or Explicit Non-Remediation

1. **Catalog staleness** (mentat's vendored `admin-items.json` copy vs.
   Core's real file). *Remediated via follow-up work, not blocking this
   design*: a scheduled GitHub Actions workflow in mentat (cron-triggered,
   same convention as the existing `semgrep.yml`) fetches Core's file via
   GitHub's raw-content API and diffs it against the vendored copy, filing
   a GitHub issue on drift. **`[Cloud Security]` When that workflow is
   built, its `permissions:` block must be `{contents: read, issues:
   write}` explicitly** — matching this repo's own existing
   `issue-bridge-maintenance.yml` precedent — never a broader default or
   an omitted block relying on the org/repo's default `GITHUB_TOKEN`
   setting (the exact `secrets: inherit`-shaped mistake this org's own
   2026-08-21 CI/Security Tooling Audit already found and fixed once). The
   drift issue is filed on **mentat's own tracker** (same-repo, needs no
   credential beyond the native `GITHUB_TOKEN`) — filing on Core would need
   a materially heavier cross-repo App-token credential for no added
   benefit. The read side (fetching a public repo's raw file) needs no
   credential at all. `[Network]` The source URL must stay a hardcoded
   literal (owner/repo/branch/path baked into the workflow YAML, never
   templated from an env var or PR-influenced input) and target `main`,
   not a PR-controlled ref. Not built as part of this spec's initial
   implementation plan — tracked as an explicit follow-up task, with the
   above constraints binding whenever it is.
2. **RBAC ceiling** (only the Discord server owner can manage guild goals
   until `admin`-tier role mappings exist). **`[C3]` Corrected**: the
   original draft's stated remediation ("ask an admin to run `/dune
   config`'s existing role-mapping command") cited a command that does not
   exist — `/dune config` appears only in `docs/additional-features-
   roadmap.md` as an *unbuilt future* read-only server-settings viewer,
   unrelated to role mapping even once built. The real, current mechanism
   is `docs/setup-portal-guide.md`'s Step 6 ("Configure Roles") — a
   one-time, OAuth-gated **web** flow typically run once by whoever
   originally added the bot (commonly, but not necessarily, the server
   owner). The permission-denial error message must say exactly this
   ("ask your server owner to open the bot's setup portal — the link sent
   when the bot was added — and fill in the Admin Role field"), not
   reference a Discord command at all, and the user-guide callout must
   link the real setup-portal guide.
3. **Zero verification of self-reported numbers.** *Not remediated here,
   by design* — this is Phase 2's entire purpose, already deliberately
   deferred (see `docs/crafting-resource-planning-overview.md`). Stated
   explicitly so it reads as an accepted boundary, not an oversight.
4. **Concurrent guild on-hand updates: last-write-wins per ingredient
   node.** *Remediated via transparency, not locking*: the update
   confirmation shows the previous value, who set it, and when — and,
   per `[H12]` above, this is now also durably logged in `goal_audit_log`,
   not just shown once in an ephemeral Discord response.
5. **No historical trend/rate tracking** (the origin spreadsheet's
   throughput calculators — "how many Deathstills to hit this rate"). *Not
   remediated — genuinely separate, future feature*, out of this design's
   scope entirely, not a completeness gap in it.
6. **`docs/architecture.md`'s persisted-table list is already stale**
   (lists tables dropped in schema v7) — confirmed the mechanical drift
   checker (`scripts/check-architecture-doc-drift.js`) does **not** cover
   this table list at all (verified by reading it directly), so nothing
   will catch this feature's own two new tables missing from that same
   list either. *Pre-existing part (the v7 staleness) fixed as its own
   tiny, separate PR, not bundled into this feature's diff* — but adding
   `goals`/`goal_on_hand_entries`/`goal_audit_log` to that list **is**
   this feature's own responsibility, tracked as an explicit implementation-
   plan checklist item (see Follow-Up Work).

## Testing Notes (for the eventual implementation plan)

The QA hat found the original Testing Notes section named the feature's
reused-calculation core but was silent on nearly every genuinely new
behavior this design introduces. Rewritten to name each explicitly:

- **Reused core (byte-for-byte where inputs match Phase 1):** where a
  craftable goal's target/on-hand matches one of `calculator-design.md`'s
  worked examples, the reused calculation and embed body sections
  (Shortfall/Nested Craft/Duration) must match Phase 1 byte-for-byte. `[QA-F8]`
  This claim covers the *reused core content only* — the progress-view
  wrapper's own new elements (goal title, due-date/overdue line, footer)
  need their own dedicated assertions, not satisfied by reusing Phase 1's
  fixtures.
- **`[H3]` Personal-goal identity-mismatch:** user B cannot on-hand-update,
  delete, or view user A's personal goal via `id` — a distinct code path
  (identity comparison) from the guild-tier check, needing its own test.
- **`[H1][SEC-1]` Cross-tenant binding:** a guild-A admin targeting a
  guild-B goal's `id` is rejected as "not found," not granted access; same
  for a player targeting another player's personal goal id.
- **`[H4]` Transparency-line assertion:** the on-hand confirmation embed's
  "previous value / who / when" content is actually present and correct
  after a second update overwrites a first — this is the design's *sole*
  stated mitigation for concurrent-update races (Gap 4), and an unasserted
  mitigation is indistinguishable from one never built. Also assert the
  corresponding `goal_audit_log` row is written.
- **`[H5]` Auto-completion exact-boundary triad**, not one vague "crossing"
  test — matching this repo's own established 3-test pattern for threshold
  conditions (`estimateDuration`'s partially-credited/exact-boundary/
  more-than-sufficient tests): (a) on-hand one unit under target → stays
  `active`; (b) on-hand exactly at target → flips to `completed`,
  `completed_at` set; (c) on-hand over target → also flips to `completed`.
  Also test: does a later downward correction un-complete a goal, or is
  completion sticky? (The design leaves this open — pick one behavior and
  test it, rather than leaving it undefined at implementation time.)
- **`[H6]` Overdue-flag matrix**, all four combinations: `due_at` past +
  `active` (flagged); `due_at` past + `completed` (NOT flagged); `due_at`
  future + `active` (not flagged); `due_at` null (never flagged, no crash
  on the comparison).
- **`[H7]` `item_kind` rejection-not-ignore:** creating with `station-tier`/
  `crafting-contract` set against a `simple`-kind item must be REJECTED,
  not silently dropped — a distinct assertion from the read-side
  simple-vs-craftable rendering test.
- **Cap enforcement**, both caps: 5th/6th personal, 10th/11th guild active
  goal rejected with an actionable, ID-bearing listing (`[H8]`); separately,
  the total-lifetime cap (`[SEC-5]`) via a create-then-complete loop.
- **RBAC denial paths**: non-admin guild-goal mutation attempts, AND
  (per `[H3]`) the personal-goal identity mismatch above.
- **`[SEC-3]` Server-side `node` validation and entry-cap enforcement**:
  a free-typed `node` not matching `recipeTreeNodes()`'s real keys (or not
  equal to the goal's own item for a simple goal) is rejected even though
  autocomplete would never have suggested it; a 7th on-hand entry on a
  craftable goal is rejected. Also test `__proto__`/`constructor`/
  `toString` as both `item` and `node` values resolve safely (via the
  `Map`-based bridge/lookups), not as truthy prototype hits.
- **`[SEC-4]` Per-row error isolation**: one poisoned/stale goal row in
  `/dune goal list` shows "unavailable" for that line without breaking the
  rest of the list.
- **`[SEC-6]` Autocomplete RBAC-scoping**: a non-admin's `id`/`node`
  autocomplete for a guild goal never surfaces other guilds' goal labels; a
  player's autocomplete never surfaces another player's personal goals;
  re-verify the existing 25-choice cap against the much larger (2,558-item)
  catalog, matching `test/calculatorAutocomplete.test.js`'s existing
  precedent.
- **`[SEC-7]` DM/no-guild rejection**: `scope:guild` and every guild-goal
  mutation attempted outside a real guild context is rejected cleanly, not
  coerced into a null/`"null"`-keyed bucket.
- **`[SEC-9]` Redaction safety**: a goal targeting an item whose real name
  contains "Token"/"Secret" (e.g. a real catalog entry like "Raider Token")
  renders its real name, not `[REDACTED]`.
- **Cascade-delete**: deleting a goal removes its `goal_on_hand_entries`
  rows (FK cascade) but its `goal_audit_log` rows survive (deliberately not
  cascaded — see Data Model).
- **`[QA-catalog]` Vendored catalog sanity**: the bundled catalog file
  parses, has the expected nonzero entry count, and has zero duplicate
  `id`s after the vendoring step's dedup (`[GRC-4]`/`[QA-catalog]` above).
- **`gameItemId` bridge**: every `CRAFTING_RECIPES`/`LEAF_RESOURCES` key
  resolves to a real catalog `id` via `RECIPE_KEY_TO_GAME_ITEM_ID`, the
  reverse lookup correctly round-trips, and a non-recipe catalog item
  correctly resolves to `simple`.
- **`[Architect-6]` Command-budget regression**: re-run/extend
  `test/commands.test.js`'s existing Discord-budget test against the built
  `/dune` command including the new `goal` group.

## Follow-Up Work (not part of this feature's own implementation plan)

- Catalog drift-check CI workflow (Gap 1), with the `permissions:` block
  and same-repo issue-filing constraints specified above.
- `docs/architecture.md` stale v7-table-list fix — small, separate PR,
  independent of this feature (Gap 6).
- **Add this feature's own new tables (`goals`, `goal_on_hand_entries`,
  `goal_audit_log`) to `docs/architecture.md`'s persisted-table list in the
  same PR that creates them** — not automatic, since the mechanical drift
  checker doesn't cover this list (confirmed by reading it directly).
- A lighter-weight "contribute" permission for guild on-hand updates, if
  the admin-only bottleneck (see Command Surface) proves to be real
  friction once this ships.
- A cleanup hook for orphaned guild goals on guild disconnect
  (`[Architect-4]`), if it proves to matter in practice.
- Phase 2 (live stock integration) — remains fully independent, optional,
  not started.
