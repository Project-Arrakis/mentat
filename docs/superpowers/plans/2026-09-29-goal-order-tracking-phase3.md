# Goal & Order Tracking (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/dune goal create|on-hand|list|progress|delete` in the `mentat` repository — persistent player and guild farming goals/orders, targetable against any of the 2,558 items in Core's game catalog, with full crafting-math progress tracking reused from Phase 1 for the 15 items that have a known recipe.

**Architecture:** Two new pure-data modules (`src/gameItemCatalog.js` — the vendored item catalog; `src/gameItemIdBridge.js` — the Map-based bridge from mentat's own recipe keys to the catalog's real game-item IDs) feed a new `/dune goal` command group in `commands.js`, backed by three new SQLite tables in `database.js`. Progress calculation for craftable goals reuses Phase 1's exact calculation pipeline via a newly-extracted shared function (`resolveEffectiveOnHandCredit()`), not new math. A new autocomplete handler (`handleGoalAutocomplete()`) independently re-applies RBAC scoping, since Discord's autocomplete interaction path bypasses this bot's normal permission/cooldown pipeline entirely.

**Tech Stack:** Plain JavaScript (ESM), `better-sqlite3`, discord.js `SlashCommandBuilder`/`AutocompleteInteraction`, `node --test`, no new npm dependency.

**Spec:** `docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md` — read this in full before starting. It has already been through a complete Eight-Hats Layer 1 audit (3 Critical + 12 High findings, all resolved directly in its text — see its own inline `[C1]`/`[H3]`/`[SEC-6]`-style citations). Where this plan and the spec ever seem to disagree, the spec wins — stop and flag it rather than silently picking one. Also read `docs/crafting-resource-planning-overview.md` for the three-phase context this fits into, and `docs/calculator-design.md`/`docs/calculator-architecture.md` for Phase 1's own worked examples (Task 8 reuses these).

## Global Constraints

- Every new SQLite lookup keyed by a caller-supplied string (`item_id`, `node`, the `gameItemIdBridge` Maps) **must use a real `Map`/`Set`, never a plain object literal or bracket-indexed object** — this repo has a confirmed, twice-found prototype-pollution class (Phase 1's FINDING-CALC-3/S-2, and a repeat found by `/code-review high` on PR #417 at 3 more call sites) where `"__proto__"`/`"constructor"`/`"toString"` resolve as truthy against a plain object. Use `Object.hasOwn()` for any plain-object existence check you cannot avoid.
- Every `id`-scoped database operation (`on-hand`, `delete`, `progress`, and their autocompletes) **must scope the lookup query itself** by `owner_type`/`owner_id` (`WHERE id = ? AND owner_type = ? AND owner_id = ?`) — never load by `id` alone and check ownership after the fact. A mismatched `id` must read as "not found," never leak that it exists under a different owner. `created_by` is audit-only and must **never** be compared for authorization — only `owner_id`.
- `target_quantity` and every `goal_on_hand_entries.quantity` are capped at **100,000**, matching `craftingCalculator.js`'s real `MAX_QUANTITY` — not 1,000,000. A higher cap is schema-legal but permanently breaks `/dune goal progress` for that goal (this was a Critical finding against an earlier draft of the design).
- `scope:guild` and every guild-goal mutation require `interaction.inGuild()` to be true. In a DM, `isAdminActor()` falls through to an env-var admin allowlist unrelated to any real guild — reject outright with a clear message, never silently coerce into a null/shared bucket.
- A craftable goal carries at most 6 `goal_on_hand_entries` rows; a simple goal carries exactly 1 (`node = goals.item_id`). Enforce this server-side, inside the same transaction as the insert — never trust that autocomplete alone prevented a free-typed 7th entry.
- All Discord-facing payload objects for this feature use **fixed field names** (e.g. `{itemId, itemName, onHand, target}`), never a caller-supplied string as an object key and never a `"Name: quantity"` label string — `redactSecrets()` (`src/format.js`) will false-positive `[REDACTED]` on real item names containing "Token"/"Secret" (Core's real catalog has several) if either pattern is used.
- Zero adapter calls, zero new npm dependency. `resolveEffectiveOnHandCredit()`, `calculateCraftingPlan()`, `applyOnHandCredit()`, `estimateDuration()` return structured objects only — all Discord formatting lives in `embedFormat.js`.
- The new `/dune goal` group must be added to **both** `getCommandRegistry()` and `helpPayload()` in `commands.js` — Phase 1's own final review caught a real command silently missing from `/dune core help` once already; do not repeat it.

## Review Focus

- **A guild-A admin free-typing a guild-B goal's numeric `id`** into `/dune goal on-hand`/`delete`/`progress` (autocomplete only ever suggests, never enforces) — a reasonable person expects this rejected as "goal not found," never granted access to another guild's data. Covered in Tasks 5-9's binding-rule tests.
- **Crediting a craftable goal's own finished item via `on-hand`** (a legitimate, UI-suggested action — `recipeTreeNodes()` includes the root item) — a reasonable person expects `/dune goal progress` to correctly show reduced remaining work, never crash. This is exactly the bug an earlier draft of this design had (`[C1]` in the spec). Covered in Task 3 (the extraction) and Task 8 (the progress command's own test using this exact scenario).
- **A goal's `due_at` passing while its `status` is already `completed`** — a reasonable person expects the order to show as done, never as overdue just because a date comparison alone would say so. Covered in Task 7.
- **A free-typed `on-hand` `node` value that isn't in the goal's own recipe tree (or isn't the goal's own item, for a simple goal)** bypassing autocomplete — a reasonable person expects a clear rejection, never a silently-accepted phantom ingredient with no bearing on the real recipe. Covered in Task 6.
- **A player who has never interacted with a guild's Discord roles running `/dune goal create scope:guild`** — a reasonable person expects a clear, actionable denial naming what's missing (admin tier or ownership), never a confusing generic RBAC error that doesn't distinguish "wrong scope" from "no access at all." Covered in Task 5.

---

## Task 1: Vendored Item Catalog

**Files:**
- Create: `src/gameItemCatalog.data.json`
- Create: `src/gameItemCatalog.js`
- Test: `test/gameItemCatalog.test.js`

**Interfaces:**
- Produces: `GAME_ITEM_CATALOG` (a frozen array of `{ id, name, category, group, source, stackSize, volume }`, deduplicated by `id`), `GAME_ITEM_CATALOG_BY_ID` (a real `Map<id, entry>`, built once at module load).

- [ ] **Step 1: Generate the deduplicated catalog JSON file**

Run this from the mentat repo root (adjust the source path if `dune-awakening-selfhost-docker` is cloned elsewhere on your machine):

```bash
python3 -c "
import json
with open('/root/projects/repos/dune-awakening-selfhost-docker/runtime/data/admin-items.json') as f:
    data = json.load(f)
seen = {}
for row in data:
    if row['id'] not in seen:
        seen[row['id']] = row
deduped = list(seen.values())
print(f'{len(data)} source rows -> {len(deduped)} deduplicated (first-occurrence-wins)')
with open('src/gameItemCatalog.data.json', 'w') as f:
    json.dump(deduped, f, indent=2)
"
```

Expected output: `2558 source rows -> 2551 deduplicated (first-occurrence-wins)` — confirmed 7 real duplicate `id`s exist in the source file as of the commit cited below (`RespawnBeacon`, `Stilltent`, `Thumper`, `UniqueThumper`, `UniqueThumper_02`, `UniqueThumper_03`, `Stilltent_Unique_01` — each maps to two different `name`/`category` pairs; first-occurrence-wins is the correct, deliberate resolution per the design spec).

- [ ] **Step 2: Write the loader module with its provenance comment**

```js
// src/gameItemCatalog.js
//
// Vendored, deduplicated copy of dune-awakening-selfhost-docker's own
// runtime/data/admin-items.json -- a static, human-curated catalog of every
// item in the game (2,551 unique ids after dedup; 2,558 in the source file,
// which had 7 real duplicate ids -- see gameItemCatalog.data.json's own
// generation command in this plan's Task 1 for the exact dedup method).
//
// Source: dune-awakening-selfhost-docker@db5d7f4073994de6ba16111c59b807b7056393c4
// (2026-09-18), runtime/data/admin-items.json. It has ZERO ingredient/recipe
// data -- it can only identify and name an item, never tell you what it
// costs to craft. src/craftingData.js's CRAFTING_RECIPES remains the only
// source of crafting math anywhere in this ecosystem; see
// src/gameItemIdBridge.js for how the two are connected.
//
// This is a one-time static copy, not a live dependency on Core -- see
// docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md's Gap 1
// for the accepted staleness risk and its deferred remediation (a scheduled
// drift-check CI workflow, not built as part of this feature).

import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("./gameItemCatalog.data.json", import.meta.url), "utf8"));

export const GAME_ITEM_CATALOG = Object.freeze(raw.map((entry) => Object.freeze({ ...entry })));

export const GAME_ITEM_CATALOG_BY_ID = new Map(GAME_ITEM_CATALOG.map((entry) => [entry.id, entry]));
```

- [ ] **Step 3: Write the failing tests**

```js
// test/gameItemCatalog.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { GAME_ITEM_CATALOG, GAME_ITEM_CATALOG_BY_ID } from "../src/gameItemCatalog.js";

test("GAME_ITEM_CATALOG parses and has a sane nonzero entry count", () => {
  assert.ok(Array.isArray(GAME_ITEM_CATALOG));
  assert.ok(GAME_ITEM_CATALOG.length > 2000, `expected >2000 entries, got ${GAME_ITEM_CATALOG.length}`);
});

test("GAME_ITEM_CATALOG has zero duplicate ids after dedup", () => {
  const ids = GAME_ITEM_CATALOG.map((e) => e.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, `${ids.length - uniqueIds.size} duplicate id(s) found -- Task 1's dedup step must have been skipped or done wrong`);
});

test("every entry has the required fields", () => {
  for (const entry of GAME_ITEM_CATALOG) {
    assert.equal(typeof entry.id, "string", `entry missing string id: ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.name, "string", `entry ${entry.id} missing string name`);
    assert.equal(typeof entry.category, "string", `entry ${entry.id} missing string category`);
  }
});

test("GAME_ITEM_CATALOG_BY_ID is a real Map, not a plain object, and round-trips every entry", () => {
  assert.ok(GAME_ITEM_CATALOG_BY_ID instanceof Map);
  assert.equal(GAME_ITEM_CATALOG_BY_ID.size, GAME_ITEM_CATALOG.length);
  for (const entry of GAME_ITEM_CATALOG) {
    assert.equal(GAME_ITEM_CATALOG_BY_ID.get(entry.id), entry);
  }
});

// The exact prototype-pollution class already found twice in this codebase
// (FINDING-CALC-3/S-2, and its repeat on PR #417) -- confirm a Map-based
// lookup correctly returns undefined for these instead of an inherited
// Object.prototype member.
for (const poisonedKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  test(`GAME_ITEM_CATALOG_BY_ID.get("${poisonedKey}") returns undefined, not an inherited prototype member`, () => {
    assert.equal(GAME_ITEM_CATALOG_BY_ID.get(poisonedKey), undefined);
  });
}

test("a known real item (Silicone Block's game id) resolves correctly", () => {
  const entry = GAME_ITEM_CATALOG_BY_ID.get("Silicone");
  assert.ok(entry, "expected 'silicone' (Silicone Block's real game id) to be in the catalog");
  assert.equal(entry.name, "Silicone Block");
});
```

- [ ] **Step 4: Run the tests to verify they fail, then pass**

Run: `node --test test/gameItemCatalog.test.js`
Expected before Step 1/2: `Cannot find module '../src/gameItemCatalog.js'`
Expected after: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/gameItemCatalog.data.json src/gameItemCatalog.js test/gameItemCatalog.test.js
git commit -m "feat(goals): vendor Core's deduplicated item catalog"
```

---

## Task 2: Game Item ID Bridge

**Files:**
- Create: `src/gameItemIdBridge.js`
- Test: `test/gameItemIdBridge.test.js`

**Interfaces:**
- Consumes: `CRAFTING_RECIPES`, `LEAF_RESOURCES` (`src/craftingData.js`, unchanged — this task does not modify that file at all).
- Produces: `RECIPE_KEY_TO_GAME_ITEM_ID` (a real `Map<recipeOrLeafKey, gameItemId>`), `GAME_ITEM_ID_TO_RECIPE_KEY` (its reverse, a real `Map<gameItemId, recipeOrLeafKey>`, built once at module load from the forward Map — never hand-duplicated).

This is a standalone bridge module — **`CRAFTING_RECIPES`/`LEAF_RESOURCES` are never modified**. An earlier draft of the design proposed adding a `gameItemId` field directly onto those structures; the Architect hat found this doesn't work (`LEAF_RESOURCES` values are plain strings, not objects) and would have been a breaking, non-additive change. This corrected design avoids that entirely.

- [ ] **Step 1: Write the failing tests first**

```js
// test/gameItemIdBridge.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { CRAFTING_RECIPES, LEAF_RESOURCES } from "../src/craftingData.js";
import { RECIPE_KEY_TO_GAME_ITEM_ID, GAME_ITEM_ID_TO_RECIPE_KEY } from "../src/gameItemIdBridge.js";
import { GAME_ITEM_CATALOG_BY_ID } from "../src/gameItemCatalog.js";

const ALL_RECIPE_AND_LEAF_KEYS = [...Object.keys(CRAFTING_RECIPES), ...Object.keys(LEAF_RESOURCES)];

// "water" has NO real, discrete inventory-item entry anywhere in the vendored
// catalog -- verified directly against the full 2,558-row source (not just
// the deduplicated copy): no id or name containing "water", nor any
// reasonable synonym (canteen, h2o, hydrate, filtered/purified/desalinated
// water, etc.), resolves to a plain raw "Water" item. The catalog only has
// water-adjacent INFRASTRUCTURE (Water Cistern, Water Shipper) and unrelated
// items with "water" in the name -- consistent with water being drawn from
// cisterns in the real game, not carried as a discrete inventory stack. This
// is a genuine, confirmed gap in what the game itself itemizes, not a
// vendoring mistake -- `water` is deliberately EXCLUDED from both bridge
// Maps, and every consumer of this bridge (Tasks 6, 8, 10) must treat a
// `.get(recipeKey)` miss for a real `LEAF_RESOURCES` key as this expected,
// documented exception, never a bug to silently paper over.
const UNMAPPABLE_LEAF_KEYS = new Set(["water"]);
const MAPPABLE_RECIPE_AND_LEAF_KEYS = ALL_RECIPE_AND_LEAF_KEYS.filter((key) => !UNMAPPABLE_LEAF_KEYS.has(key));

test("RECIPE_KEY_TO_GAME_ITEM_ID and GAME_ITEM_ID_TO_RECIPE_KEY are real Maps", () => {
  assert.ok(RECIPE_KEY_TO_GAME_ITEM_ID instanceof Map);
  assert.ok(GAME_ITEM_ID_TO_RECIPE_KEY instanceof Map);
});

test("every mappable CRAFTING_RECIPES/LEAF_RESOURCES key has a real, catalog-verified game item id", () => {
  for (const key of MAPPABLE_RECIPE_AND_LEAF_KEYS) {
    const gameItemId = RECIPE_KEY_TO_GAME_ITEM_ID.get(key);
    assert.ok(gameItemId, `${key} is missing from RECIPE_KEY_TO_GAME_ITEM_ID`);
    assert.ok(GAME_ITEM_CATALOG_BY_ID.has(gameItemId), `${key} -> "${gameItemId}" is not a real id in GAME_ITEM_CATALOG_BY_ID`);
  }
});

test("water is a documented exception, not silently missing", () => {
  assert.equal(RECIPE_KEY_TO_GAME_ITEM_ID.has("water"), false, "water must not have an invented/guessed id -- it has none in the real catalog");
});

test("RECIPE_KEY_TO_GAME_ITEM_ID has no extra entries beyond the mappable keys (all of CRAFTING_RECIPES + LEAF_RESOURCES except the documented water exception)", () => {
  assert.equal(RECIPE_KEY_TO_GAME_ITEM_ID.size, MAPPABLE_RECIPE_AND_LEAF_KEYS.length);
});

test("GAME_ITEM_ID_TO_RECIPE_KEY correctly round-trips every forward entry", () => {
  for (const [recipeKey, gameItemId] of RECIPE_KEY_TO_GAME_ITEM_ID) {
    assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.get(gameItemId), recipeKey);
  }
  assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.size, RECIPE_KEY_TO_GAME_ITEM_ID.size);
});

test("a non-recipe catalog item (e.g. a weapon) has no entry in the reverse map", () => {
  // "Silicone" IS a recipe item (Silicone Block) -- pick something that
  // definitely isn't: any real catalog id not in RECIPE_KEY_TO_GAME_ITEM_ID's values.
  const recipeGameItemIds = new Set(RECIPE_KEY_TO_GAME_ITEM_ID.values());
  const nonRecipeEntry = [...GAME_ITEM_CATALOG_BY_ID.keys()].find((id) => !recipeGameItemIds.has(id));
  assert.ok(nonRecipeEntry, "test setup problem: could not find any non-recipe catalog item");
  assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.get(nonRecipeEntry), undefined);
});

for (const poisonedKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  test(`GAME_ITEM_ID_TO_RECIPE_KEY.get("${poisonedKey}") returns undefined, not an inherited prototype member`, () => {
    assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.get(poisonedKey), undefined);
  });
  test(`RECIPE_KEY_TO_GAME_ITEM_ID.get("${poisonedKey}") returns undefined, not an inherited prototype member`, () => {
    assert.equal(RECIPE_KEY_TO_GAME_ITEM_ID.get(poisonedKey), undefined);
  });
}
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/gameItemIdBridge.test.js`
Expected: `Cannot find module '../src/gameItemIdBridge.js'`

- [ ] **Step 3: Write the bridge module**

Every one of the 15 `CRAFTING_RECIPES` keys and 13 `LEAF_RESOURCES` keys needs its real game-item id looked up in `src/gameItemCatalog.data.json` by matching display name (case-insensitive) — do this once, by hand, verifying each against the catalog file, then hardcode the verified mapping (do not do a live name-matching lookup at runtime; a display name can collide, e.g. this catalog has 7 known duplicate-id-different-name pairs, so runtime fuzzy matching is not safe). Look up each of these 28 keys' real ids in `src/gameItemCatalog.data.json` (search by the `name` field) before writing this file — the table below gives you the recipe-side keys and their exact display names to search for; you must independently confirm the real `id` for each against the generated JSON file, not guess:

```
CRAFTING_RECIPES keys -> displayName to search for in gameItemCatalog.data.json:
  copper_ingot -> "Copper Ingot"
  iron_ingot -> "Iron Ingot"
  steel_ingot -> "Steel Ingot"
  aluminum_ingot -> "Aluminum Ingot"
  duraluminum_ingot -> "Duraluminum Ingot"
  plastanium_ingot -> "Plastanium Ingot"
  stravidium_fiber -> "Stravidium Fiber"
  cobalt_paste -> "Cobalt Paste"
  silicone_block -> "Silicone Block"
  small_fuel_cell -> "Small Vehicle Fuel Cell"
  medium_fuel_cell -> "Medium Sized Vehicle Fuel Cell"
  large_fuel_cell -> "Large Vehicle Fuel Cell"
  spice_fuel_cell -> "Spice-infused Fuel Cell"
  low_grade_lubricant -> "Low-grade Lubricant"
  industrial_lubricant -> "Industrial-grade Lubricant"

LEAF_RESOURCES keys -> displayName to search for:
  water -> "Water"
  copper_ore -> "Copper Ore"
  iron_ore -> "Iron Ore"
  carbon_ore -> "Carbon Ore"
  aluminum_ore -> "Aluminum Ore"
  titanium_ore -> "Titanium Ore"
  jasmium_crystal -> "Jasmium Crystal"
  stravidium_mass -> "Stravidium Mass"
  erythrite_crystal -> "Erythrite Crystal"
  flour_sand -> "Flour Sand"
  spice_residue -> "Spice Residue"
  irradiated_slag -> "Irradiated Slag"
  fuel_cell -> "Fuel Cell"
```

Find each real `id` with e.g. `grep -i '"name": "Copper Ingot"' -B2 src/gameItemCatalog.data.json` (repeat per name), then write:

```js
// src/gameItemIdBridge.js
//
// Bridges mentat's own snake_case recipe/leaf keys (src/craftingData.js) to
// Core's real game item ids (src/gameItemCatalog.js) -- a standalone module,
// deliberately NOT a field added to CRAFTING_RECIPES/LEAF_RESOURCES (those
// stay completely untouched; LEAF_RESOURCES values are plain strings, not
// objects, so "adding a field" to them isn't possible without a breaking
// shape change -- see docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md's
// [H2] finding for the full story).
//
// Both Maps are real ES Maps, never plain objects -- see FINDING-CALC-3/S-2
// and its repeat (found by /code-review high on PR #417) for why a bare
// object lookup here would be a real, repeated prototype-pollution class in
// this codebase, now with PERSISTED data instead of Phase 1's stateless one.
//
// Every id below was verified by hand against
// dune-awakening-selfhost-docker@db5d7f4073994de6ba16111c59b807b7056393c4's
// runtime/data/admin-items.json (see src/gameItemCatalog.js's own
// provenance comment) -- do not guess a new entry here without the same
// verification.

export const RECIPE_KEY_TO_GAME_ITEM_ID = new Map([
  // CRAFTING_RECIPES
  ["copper_ingot", "REPLACE_WITH_VERIFIED_ID"],
  ["iron_ingot", "REPLACE_WITH_VERIFIED_ID"],
  ["steel_ingot", "REPLACE_WITH_VERIFIED_ID"],
  ["aluminum_ingot", "REPLACE_WITH_VERIFIED_ID"],
  ["duraluminum_ingot", "REPLACE_WITH_VERIFIED_ID"],
  ["plastanium_ingot", "REPLACE_WITH_VERIFIED_ID"],
  ["stravidium_fiber", "REPLACE_WITH_VERIFIED_ID"],
  ["cobalt_paste", "REPLACE_WITH_VERIFIED_ID"],
  ["silicone_block", "Silicone"],
  ["small_fuel_cell", "REPLACE_WITH_VERIFIED_ID"],
  ["medium_fuel_cell", "REPLACE_WITH_VERIFIED_ID"],
  ["large_fuel_cell", "REPLACE_WITH_VERIFIED_ID"],
  ["spice_fuel_cell", "REPLACE_WITH_VERIFIED_ID"],
  ["low_grade_lubricant", "REPLACE_WITH_VERIFIED_ID"],
  ["industrial_lubricant", "REPLACE_WITH_VERIFIED_ID"],
  // LEAF_RESOURCES
  // "water" is deliberately OMITTED here -- see this file's own
  // UNMAPPABLE_LEAF_KEYS comment in the test file: no real "Water" item
  // exists anywhere in the vendored catalog (water is drawn from cisterns
  // in the real game, not carried as a discrete inventory stack). Do not
  // add a guessed entry for it.
  ["copper_ore", "REPLACE_WITH_VERIFIED_ID"],
  ["iron_ore", "REPLACE_WITH_VERIFIED_ID"],
  ["carbon_ore", "REPLACE_WITH_VERIFIED_ID"],
  ["aluminum_ore", "REPLACE_WITH_VERIFIED_ID"],
  ["titanium_ore", "REPLACE_WITH_VERIFIED_ID"],
  ["jasmium_crystal", "REPLACE_WITH_VERIFIED_ID"],
  ["stravidium_mass", "REPLACE_WITH_VERIFIED_ID"],
  ["erythrite_crystal", "REPLACE_WITH_VERIFIED_ID"],
  ["flour_sand", "REPLACE_WITH_VERIFIED_ID"],
  ["spice_residue", "REPLACE_WITH_VERIFIED_ID"],
  ["irradiated_slag", "REPLACE_WITH_VERIFIED_ID"],
  ["fuel_cell", "REPLACE_WITH_VERIFIED_ID"]
]);

export const GAME_ITEM_ID_TO_RECIPE_KEY = new Map(
  [...RECIPE_KEY_TO_GAME_ITEM_ID].map(([recipeKey, gameItemId]) => [gameItemId, recipeKey])
);
```

**You must replace every `"REPLACE_WITH_VERIFIED_ID"` with the real id you looked up** (the `silicone_block` row is already filled in correctly, as a worked example — `"Silicone"` is Silicone Block's confirmed real id, verified directly against Task 1's own generated `src/gameItemCatalog.data.json`, not guessed — note it is capitalized with no `_block` suffix, unlike mentat's own `silicone_block` recipe key on the left). Do not leave any placeholder in the committed file — the Step 4 test below will fail loudly (`GAME_ITEM_CATALOG_BY_ID.has(gameItemId)` returns false for a literal placeholder string) if you miss one, which is the point: it's a real verification gate, not busywork. **This also means every other `REPLACE_WITH_VERIFIED_ID` in this Map must be looked up the same way — against the real generated data file, never assumed from a display name's likely casing** (the Silicone Block mistake in an earlier draft of this plan was exactly that: assumed lowercase from the item's own recipe-key naming convention, when the real catalog entry is capitalized).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/gameItemIdBridge.test.js`
Expected: all pass. If any `REPLACE_WITH_VERIFIED_ID` placeholder was missed, the "every ... key has a real, catalog-verified game item id" test fails with a clear message naming which key.

- [ ] **Step 5: Commit**

```bash
git add src/gameItemIdBridge.js test/gameItemIdBridge.test.js
git commit -m "feat(goals): bridge recipe keys to real game item ids (standalone, additive)"
```

---

## Task 3: Extract `resolveEffectiveOnHandCredit()` From `executeCalculator()`

**Files:**
- Modify: `src/craftingCalculator.js`
- Modify: `src/commands.js:1187-1261` (`executeCalculator()`)
- Test: `test/craftingCalculator.test.js`

**Interfaces:**
- Produces: `resolveEffectiveOnHandCredit(itemKey, quantity, onHandEntries, { stationTier, craftingContract })` in `craftingCalculator.js` — returns the same `credited` plan-object shape `applyOnHandCredit()`/`calculateCraftingPlan()` already produce (with `effectiveQuantity` always present), given an item key, the goal/request's target quantity, a plain array of `{ node, quantity }` on-hand entries (the target item's own key is a valid `node` value, exactly like Phase 1), and the item's station tier / crafting-contract flag. Does **not** call `estimateDuration()` — callers do that separately, since `stationCount` is a per-invocation display choice, not part of a plan.

This is a **pure refactor** — the exact logic already in `executeCalculator()` moves into this new function, with zero behavior change for Phase 1's own calculator command. This closes a real, Architect-hat-found Critical finding: an earlier draft of the goal-tracking design claimed "zero new calculation code" for goal progress, but skipped this exact logic (called "Step A" in the design), which would make `/dune goal progress` crash the moment a player credits a goal's own finished-item stock — the feature's primary expected use case.

- [ ] **Step 1: Write the failing tests for the new function**

Add to `test/craftingCalculator.test.js` (append near the other `applyOnHandCredit`/`estimateDuration` tests — check the file's existing import line and add `resolveEffectiveOnHandCredit` to it):

```js
// resolveEffectiveOnHandCredit() -- Task 3 extraction of executeCalculator()'s
// own "Step A" logic (commands.js), so goal progress can reuse it without
// duplicating or (as an earlier design draft did) skipping it.
test("resolveEffectiveOnHandCredit: crediting the target item itself reduces effectiveQuantity, never calls calculateCraftingPlan with the raw target", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [{ node: "copper_ingot", quantity: 10 }], { stationTier: "large", craftingContract: false });
  assert.equal(credited.effectiveQuantity, 15);
  assert.equal(credited.quantity, 25);
});

test("resolveEffectiveOnHandCredit: target-item credit covering the whole goal returns a genuinely empty plan, not a phantom 1-unit plan", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [{ node: "copper_ingot", quantity: 25 }], { stationTier: "large", craftingContract: false });
  assert.equal(credited.effectiveQuantity, 0);
  assert.equal(credited.crafts, 0);
  assert.deepEqual(credited.directInputs, []);
  assert.deepEqual(credited.totalRawMaterials, []);
  assert.equal(credited.totalTimeSeconds, 0);
  assert.equal(credited.shortfall.size, 0);
  assert.equal(credited.maxCompletable.units, 25);
});

test("resolveEffectiveOnHandCredit: no on-hand entries at all returns the plain uncredited plan", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [], { stationTier: "large", craftingContract: false });
  assert.equal(credited.effectiveQuantity, 25);
  assert.equal(credited.crafts, 25);
});

test("resolveEffectiveOnHandCredit: ingredient credit (not the target item) applies applyOnHandCredit as before", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [{ node: "copper_ore", quantity: 40 }], { stationTier: "large", craftingContract: false });
  assert.ok(credited.shortfall.has("copper_ore"));
  assert.equal(credited.effectiveQuantity, 25);
});

test("resolveEffectiveOnHandCredit: an invalid station tier still throws the real 'no recipe variant' error even at effectiveQuantity 0", () => {
  assert.throws(
    () => resolveEffectiveOnHandCredit("stravidium_fiber", 5, [{ node: "stravidium_fiber", quantity: 5 }], { stationTier: "large", craftingContract: false }),
    /no recipe variant at this tier/i
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/craftingCalculator.test.js`
Expected: `resolveEffectiveOnHandCredit is not a function` (or `is not defined`, once you've added it to the test file's import line).

- [ ] **Step 3: Extract the function in `craftingCalculator.js`**

Add this new exported function (place it after `applyOnHandCredit()` and before `estimateDuration()`, matching the order the plan/spec discusses them):

```js
// Extracted from commands.js's executeCalculator() (Task 3, Phase 3 plan) --
// "Step A" per docs/calculator-architecture.md's Shortfall Traversal Design.
// Resolves any on-hand credit toward the target item ITSELF (a legitimate
// input recipeTreeNodes() explicitly offers, since it includes the root
// item) before ever calling calculateCraftingPlan(), which cannot accept a
// literal 0 quantity. This is a pure extraction -- zero behavior change for
// Phase 1's own /dune data calculator, which now calls this function
// instead of inlining the same logic. Shared so goal progress (Phase 3)
// gets this exact, already-tested handling for free, instead of an earlier
// design draft's mistake of skipping it entirely.
export function resolveEffectiveOnHandCredit(itemKey, quantity, onHandEntries, { stationTier = "large", craftingContract = false } = {}) {
  const targetEntry = onHandEntries.find((e) => e.node === itemKey);
  const targetItemOnHand = targetEntry?.quantity ?? 0;
  const effectiveQuantity = Math.max(0, quantity - targetItemOnHand);
  const ingredientOnHandEntries = onHandEntries.filter((e) => e.node !== itemKey);

  if (effectiveQuantity === 0) {
    // The target-item-itself on-hand credit alone already covers the whole
    // goal -- nothing left to craft. calculateCraftingPlan() can't accept a
    // literal 0 (MIN_QUANTITY's own bound), so it's still called once at
    // MIN_QUANTITY -- but ONLY to (a) surface a real "no recipe variant at
    // this tier" error if the requested tier doesn't exist for this item,
    // and (b) read the real station/craftTimeSeconds display strings. Every
    // list-shaped field it returns describes a genuine 1-unit plan and must
    // NOT be reused here -- construct the zero-credit result directly.
    const probePlan = calculateCraftingPlan(itemKey, MIN_QUANTITY, { stationTier, craftingContract });
    return {
      ...probePlan,
      quantity,
      effectiveQuantity: 0,
      crafts: 0,
      leftover: 0,
      directInputs: [],
      nestedCrafts: {},
      totalRawMaterials: [],
      totalTimeSeconds: 0,
      shortfall: new Map(),
      maxCompletable: { units: Math.min(quantity, targetItemOnHand), limitingNode: undefined }
    };
  }

  const plan = calculateCraftingPlan(itemKey, effectiveQuantity, { stationTier, craftingContract });
  const hasIngredientCredit = ingredientOnHandEntries.length > 0;
  const credited = hasIngredientCredit || targetItemOnHand > 0
    ? applyOnHandCredit(plan, ingredientOnHandEntries, { quantity, targetItemOnHand })
    : plan;
  return { ...credited, effectiveQuantity };
}
```

Note the last line: when neither ingredient credit nor target-item credit applies, `plan` itself is returned (matching the old inline code's `credited = ... : plan` branch) — but `plan` alone has no `effectiveQuantity` field, so it's spread with `effectiveQuantity` added explicitly. This is a **new, small, correct addition** the old inline code didn't need (because `commands.js` computed `effectiveQuantity` itself locally) — callers of this shared function now always get `effectiveQuantity` on every returned shape, which Task 8's goal-progress wrapper embed will rely on.

- [ ] **Step 4: Update `executeCalculator()` to call the extracted function**

In `src/commands.js`, replace the whole inlined block (everything from `// Step A: resolve target-item-itself credit...` through the `let credited; let durations; if (effectiveQuantity === 0) { ... } else { ... }` block) with:

```js
  const credited = resolveEffectiveOnHandCredit(itemKey, quantity, rawOnHandEntries, { stationTier, craftingContract });
  const durations = credited.effectiveQuantity === 0 ? [] : estimateDuration(credited, { stationCount });

  return { plan: credited, durations, onHandEntries: rawOnHandEntries };
```

Add `resolveEffectiveOnHandCredit` to `commands.js`'s existing import from `./craftingCalculator.js` (the line currently reading `import { calculateCraftingPlan, applyOnHandCredit, estimateDuration, recipeTreeNodes, bestAvailableTier, MIN_QUANTITY, MAX_QUANTITY } from "./craftingCalculator.js";`).

- [ ] **Step 5: Run the full existing calculator test suite to confirm zero behavior change**

Run: `node --test test/craftingCalculator.test.js test/commands.test.js test/embedFormat.calculator.test.js test/calculatorAutocomplete.test.js`
Expected: every pre-existing test still passes, unchanged — this step proves the extraction didn't alter Phase 1's real behavior. If anything fails, the extraction has a bug; do not proceed until this is 100% green.

- [ ] **Step 6: Run the new Task 3 tests**

Run: `node --test test/craftingCalculator.test.js`
Expected: all pass, including the 5 new `resolveEffectiveOnHandCredit` tests from Step 1.

- [ ] **Step 7: Commit**

```bash
git add src/craftingCalculator.js src/commands.js test/craftingCalculator.test.js
git commit -m "refactor(calculator): extract resolveEffectiveOnHandCredit() for reuse by goal progress"
```

---

## Task 4: Database Schema — `goals`, `goal_on_hand_entries`, `goal_audit_log`

**Files:**
- Modify: `src/database.js`
- Test: `test/database.test.js`

**Interfaces:**
- Produces (all exported from `src/database.js`):
  - `createGoal(db, { ownerType, ownerId, itemId, itemKind, targetQuantity, stationTier, craftingContract, dueAt, createdBy }) -> id` (the new row's integer id)
  - `getGoalScoped(db, { id, ownerType, ownerId }) -> goal row | undefined`
  - `listGoalsByOwner(db, { ownerType, ownerId, includeCompleted = false }) -> goal row[]` (ordered by `created_at`)
  - `countGoalsByOwner(db, { ownerType, ownerId, statuses }) -> number` (`statuses` is an array, e.g. `["active"]` or `["active", "completed", "archived"]`)
  - `setGoalOnHandEntry(db, { goalId, node, quantity, updatedBy }) -> { previousQuantity, previousUpdatedBy, previousUpdatedAt } | null` (`null` if this is the entry's first-ever write)
  - `getGoalOnHandEntries(db, goalId) -> entry row[]`
  - `countGoalOnHandEntries(db, goalId) -> number`
  - `completeGoal(db, { id }) -> void` (sets `status='completed'`, `completed_at=datetime('now')`)
  - `deleteGoalScoped(db, { id, ownerType, ownerId }) -> boolean` (`true` if a row was actually deleted)
  - `appendGoalAuditLog(db, { goalId, action, actorId, node = null, previousQuantity = null, newQuantity = null }) -> void`
  - `getGoalAuditLog(db, goalId) -> log row[]` (ordered by `created_at`, for tests/future use — no command surfaces this yet)

- [ ] **Step 1: Write the failing schema/accessor tests**

Add a new `describe`-free block of tests to `test/database.test.js` (matching that file's existing flat `test(...)` style, using `createDatabase(":memory:")` per its own established convention):

```js
// ── goals / goal_on_hand_entries / goal_audit_log (Phase 3) ──
import {
  createGoal, getGoalScoped, listGoalsByOwner, countGoalsByOwner,
  setGoalOnHandEntry, getGoalOnHandEntries, countGoalOnHandEntries,
  completeGoal, deleteGoalScoped, appendGoalAuditLog, getGoalAuditLog
} from "../src/database.js"; // add to the file's existing import line instead of a new import statement

test("createGoal + getGoalScoped: a created goal is readable by its real owner", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "player-1", itemId: "duraluminumrod", itemKind: "craftable", targetQuantity: 10000, stationTier: "large", craftingContract: false, dueAt: null, createdBy: "player-1" });
  assert.ok(Number.isInteger(id));
  const goal = getGoalScoped(db, { id, ownerType: "player", ownerId: "player-1" });
  assert.equal(goal.item_id, "duraluminumrod");
  assert.equal(goal.target_quantity, 10000);
  assert.equal(goal.status, "active");
});

test("getGoalScoped: a mismatched owner (wrong owner_id) returns undefined, not the row", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "player-1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 100, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "player-1" });
  assert.equal(getGoalScoped(db, { id, ownerType: "player", ownerId: "player-2" }), undefined);
  assert.equal(getGoalScoped(db, { id, ownerType: "guild", ownerId: "player-1" }), undefined, "owner_type must also be checked, not just owner_id");
});

test("getGoalScoped: a nonexistent id returns undefined", () => {
  const db = createDatabase(":memory:");
  assert.equal(getGoalScoped(db, { id: 999999, ownerType: "player", ownerId: "player-1" }), undefined);
});

test("listGoalsByOwner: excludes completed/archived by default, includes them with includeCompleted", () => {
  const db = createDatabase(":memory:");
  const activeId = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 100, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "p1" });
  const doneId = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 50, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "p1" });
  completeGoal(db, { id: doneId });
  const activeOnly = listGoalsByOwner(db, { ownerType: "player", ownerId: "p1" });
  assert.deepEqual(activeOnly.map((g) => g.id), [activeId]);
  const all = listGoalsByOwner(db, { ownerType: "player", ownerId: "p1", includeCompleted: true });
  assert.equal(all.length, 2);
});

test("countGoalsByOwner: counts only the requested statuses", () => {
  const db = createDatabase(":memory:");
  const id1 = createGoal(db, { ownerType: "guild", ownerId: "g1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 10, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "u1" });
  createGoal(db, { ownerType: "guild", ownerId: "g1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 10, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "u1" });
  completeGoal(db, { id: id1 });
  assert.equal(countGoalsByOwner(db, { ownerType: "guild", ownerId: "g1", statuses: ["active"] }), 1);
  assert.equal(countGoalsByOwner(db, { ownerType: "guild", ownerId: "g1", statuses: ["active", "completed"] }), 2);
});

test("target_quantity CHECK rejects above 100000", () => {
  const db = createDatabase(":memory:");
  assert.throws(() => createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 100001, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "p1" }));
});

test("owner_type CHECK rejects an invalid value", () => {
  const db = createDatabase(":memory:");
  assert.throws(() => createGoal(db, { ownerType: "not-a-real-type", ownerId: "p1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 10, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "p1" }));
});

test("setGoalOnHandEntry: first write returns null for 'previous', second write returns the real previous value", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "duraluminumrod", itemKind: "craftable", targetQuantity: 10000, stationTier: "large", craftingContract: false, dueAt: null, createdBy: "p1" });
  const first = setGoalOnHandEntry(db, { goalId: id, node: "titanium_ore", quantity: 100, updatedBy: "p1" });
  assert.equal(first, null);
  const second = setGoalOnHandEntry(db, { goalId: id, node: "titanium_ore", quantity: 250, updatedBy: "p2" });
  assert.equal(second.previousQuantity, 100);
  assert.equal(second.previousUpdatedBy, "p1");
  assert.ok(second.previousUpdatedAt);
  const entries = getGoalOnHandEntries(db, id);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].quantity, 250);
  assert.equal(entries[0].updated_by, "p2");
});

test("goal_on_hand_entries quantity CHECK rejects above 100000", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 10, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "p1" });
  assert.throws(() => setGoalOnHandEntry(db, { goalId: id, node: "flour_sand", quantity: 100001, updatedBy: "p1" }));
});

test("countGoalOnHandEntries reflects real row count", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "duraluminumrod", itemKind: "craftable", targetQuantity: 10000, stationTier: "large", craftingContract: false, dueAt: null, createdBy: "p1" });
  assert.equal(countGoalOnHandEntries(db, id), 0);
  setGoalOnHandEntry(db, { goalId: id, node: "titanium_ore", quantity: 100, updatedBy: "p1" });
  setGoalOnHandEntry(db, { goalId: id, node: "jasmium_crystal", quantity: 50, updatedBy: "p1" });
  assert.equal(countGoalOnHandEntries(db, id), 2);
});

test("deleteGoalScoped: cascades to goal_on_hand_entries, refuses a mismatched owner, returns whether a row was deleted", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "duraluminumrod", itemKind: "craftable", targetQuantity: 10000, stationTier: "large", craftingContract: false, dueAt: null, createdBy: "p1" });
  setGoalOnHandEntry(db, { goalId: id, node: "titanium_ore", quantity: 100, updatedBy: "p1" });
  assert.equal(deleteGoalScoped(db, { id, ownerType: "player", ownerId: "p2" }), false, "wrong owner must not delete");
  assert.equal(deleteGoalScoped(db, { id, ownerType: "player", ownerId: "p1" }), true);
  assert.equal(getGoalScoped(db, { id, ownerType: "player", ownerId: "p1" }), undefined);
  assert.equal(getGoalOnHandEntries(db, id).length, 0, "on-hand entries must cascade-delete with the goal");
});

test("appendGoalAuditLog + getGoalAuditLog: a deleted goal's audit rows survive the delete (not cascaded)", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "duraluminumrod", itemKind: "craftable", targetQuantity: 10000, stationTier: "large", craftingContract: false, dueAt: null, createdBy: "p1" });
  appendGoalAuditLog(db, { goalId: id, action: "create", actorId: "p1" });
  appendGoalAuditLog(db, { goalId: id, action: "on_hand_update", actorId: "p1", node: "titanium_ore", previousQuantity: 0, newQuantity: 100 });
  deleteGoalScoped(db, { id, ownerType: "player", ownerId: "p1" });
  appendGoalAuditLog(db, { goalId: id, action: "delete", actorId: "p1" });
  const log = getGoalAuditLog(db, id);
  assert.equal(log.length, 3, "audit log must survive the goal's own deletion");
  assert.equal(log[0].action, "create");
  assert.equal(log[1].node, "titanium_ore");
  assert.equal(log[2].action, "delete");
});

test("appendGoalAuditLog action CHECK rejects an invalid action name", () => {
  const db = createDatabase(":memory:");
  const id = createGoal(db, { ownerType: "player", ownerId: "p1", itemId: "Silicone", itemKind: "craftable", targetQuantity: 10, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: "p1" });
  assert.throws(() => appendGoalAuditLog(db, { goalId: id, action: "not-a-real-action", actorId: "p1" }));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/database.test.js`
Expected: `createGoal is not a function` (or similar, once added to the import line).

- [ ] **Step 3: Add the schema**

In `src/database.js`, add these three `CREATE TABLE` blocks to the end of the `SCHEMA` template string, immediately before the closing backtick (after `live_messages`'s definition):

```sql
-- goals / goal_on_hand_entries / goal_audit_log (Phase 3, mentat goal/order
-- tracking -- see docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md).
-- Purely additive (CREATE TABLE IF NOT EXISTS); no SCHEMA_VERSION bump
-- needed, matching the live_messages/key_versions precedent -- db.exec(SCHEMA)
-- runs unconditionally on every startup, so these appear automatically for
-- existing installs. Rollback, if ever needed: DROP TABLE IF EXISTS
-- goal_audit_log; DROP TABLE IF EXISTS goal_on_hand_entries; DROP TABLE IF
-- EXISTS goals; (child-then-parent order) -- zero blast radius on any other
-- feature, all three tables are mutually isolated from the rest of this schema.
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('player', 'guild')),
  owner_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_kind TEXT NOT NULL CHECK (item_kind IN ('craftable', 'simple')),
  -- Capped at 100,000, matching craftingCalculator.js's real MAX_QUANTITY --
  -- a higher cap here is schema-legal but permanently breaks
  -- resolveEffectiveOnHandCredit()/calculateCraftingPlan() for that goal.
  target_quantity INTEGER NOT NULL CHECK (target_quantity BETWEEN 1 AND 100000),
  station_tier TEXT,
  crafting_contract INTEGER NOT NULL DEFAULT 0,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  -- created_by is audit-only -- NEVER used for authorization. Permission
  -- checks always compare against owner_id. See this table's own accessor
  -- functions (getGoalScoped/deleteGoalScoped) for the enforced invariant.
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_goals_owner ON goals(owner_type, owner_id, status);

CREATE TABLE IF NOT EXISTS goal_on_hand_entries (
  goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  node TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 0 AND 100000),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (goal_id, node)
);

-- Append-only audit log. goal_id is deliberately NOT a foreign key -- this
-- table must survive a goal's hard-delete so a dispute about a deleted goal
-- still has something to check.
CREATE TABLE IF NOT EXISTS goal_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'on_hand_update', 'complete', 'delete')),
  actor_id TEXT NOT NULL,
  node TEXT,
  previous_quantity INTEGER,
  new_quantity INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_goal_audit_log_goal ON goal_audit_log(goal_id);
```

- [ ] **Step 4: Add the accessor functions**

Add these exported functions to `src/database.js`, placed after `getGuildFaction`/`setGuildFaction` near the end of the file (before `_resetEphemeralStateForTests`):

```js
// ── goals / goal_on_hand_entries / goal_audit_log (Phase 3) ──
export function createGoal(db, { ownerType, ownerId, itemId, itemKind, targetQuantity, stationTier, craftingContract, dueAt, createdBy }) {
  const result = db.prepare(`
    INSERT INTO goals (owner_type, owner_id, item_id, item_kind, target_quantity, station_tier, crafting_contract, due_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ownerType, ownerId, itemId, itemKind, targetQuantity, stationTier ?? null, craftingContract ? 1 : 0, dueAt ?? null, createdBy);
  return result.lastInsertRowid;
}

export function getGoalScoped(db, { id, ownerType, ownerId }) {
  return db.prepare("SELECT * FROM goals WHERE id = ? AND owner_type = ? AND owner_id = ?").get(id, ownerType, ownerId);
}

export function listGoalsByOwner(db, { ownerType, ownerId, includeCompleted = false }) {
  if (includeCompleted) {
    return db.prepare("SELECT * FROM goals WHERE owner_type = ? AND owner_id = ? ORDER BY created_at").all(ownerType, ownerId);
  }
  return db.prepare("SELECT * FROM goals WHERE owner_type = ? AND owner_id = ? AND status = 'active' ORDER BY created_at").all(ownerType, ownerId);
}

export function countGoalsByOwner(db, { ownerType, ownerId, statuses }) {
  const placeholders = statuses.map(() => "?").join(",");
  const row = db.prepare(`SELECT COUNT(*) AS n FROM goals WHERE owner_type = ? AND owner_id = ? AND status IN (${placeholders})`).get(ownerType, ownerId, ...statuses);
  return row.n;
}

export function setGoalOnHandEntry(db, { goalId, node, quantity, updatedBy }) {
  const previous = db.prepare("SELECT quantity, updated_by, updated_at FROM goal_on_hand_entries WHERE goal_id = ? AND node = ?").get(goalId, node);
  db.prepare(`
    INSERT INTO goal_on_hand_entries (goal_id, node, quantity, updated_by, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT (goal_id, node) DO UPDATE SET
      quantity = excluded.quantity,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(goalId, node, quantity, updatedBy);
  if (!previous) return null;
  return { previousQuantity: previous.quantity, previousUpdatedBy: previous.updated_by, previousUpdatedAt: previous.updated_at };
}

export function getGoalOnHandEntries(db, goalId) {
  return db.prepare("SELECT * FROM goal_on_hand_entries WHERE goal_id = ?").all(goalId);
}

export function countGoalOnHandEntries(db, goalId) {
  return db.prepare("SELECT COUNT(*) AS n FROM goal_on_hand_entries WHERE goal_id = ?").get(goalId).n;
}

export function completeGoal(db, { id }) {
  db.prepare("UPDATE goals SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteGoalScoped(db, { id, ownerType, ownerId }) {
  const result = db.prepare("DELETE FROM goals WHERE id = ? AND owner_type = ? AND owner_id = ?").run(id, ownerType, ownerId);
  return result.changes > 0;
}

export function appendGoalAuditLog(db, { goalId, action, actorId, node = null, previousQuantity = null, newQuantity = null }) {
  db.prepare(`
    INSERT INTO goal_audit_log (goal_id, action, actor_id, node, previous_quantity, new_quantity)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(goalId, action, actorId, node, previousQuantity, newQuantity);
}

export function getGoalAuditLog(db, goalId) {
  return db.prepare("SELECT * FROM goal_audit_log WHERE goal_id = ? ORDER BY created_at, id").all(goalId);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/database.test.js`
Expected: all pass, including every pre-existing test in that file (unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/database.js test/database.test.js
git commit -m "feat(goals): add goals/goal_on_hand_entries/goal_audit_log schema and accessors"
```

---

## Task 5: `/dune goal create`

**Files:**
- Modify: `src/commands.js`
- Test: `test/commands.test.js`

**Interfaces:**
- Consumes: `GAME_ITEM_CATALOG_BY_ID` (Task 1), `GAME_ITEM_ID_TO_RECIPE_KEY` (Task 2), `bestAvailableTier`/`calculateCraftingPlan` (existing, `craftingCalculator.js`), `createGoal`/`countGoalsByOwner`/`listGoalsByOwner` (Task 4), `isAdminActor` (existing, `commands.js`).
- Produces: `executeGoalCreate({ interaction, db })` in `commands.js`; the `/dune goal` `SlashCommandBuilder` group's `create` subcommand registration in `buildDuneCommand()`.

- [ ] **Step 1: Register the command group and its `create` subcommand**

In `src/commands.js`'s `buildDuneCommand()`, add a new `.addSubcommandGroup(...)` call after the existing `data` group block (before `logs`):

```js
    // ── goal group (Phase 3) ──
    .addSubcommandGroup((g) => g.setName("goal").setDescription("Track a personal or guild farming goal against any game item.")
      .addSubcommand((c) => c.setName("create").setDescription("Create a new farming goal or order.")
        .addStringOption((o) => o.setName("scope").setDescription("Personal goal, or a shared guild goal.").setRequired(true).addChoices(
          { name: "Personal", value: "personal" }, { name: "Guild", value: "guild" }
        ))
        .addStringOption((o) => o.setName("item").setDescription("Item to track.").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("quantity").setDescription("Target quantity (your goal).").setRequired(true).setMinValue(MIN_QUANTITY).setMaxValue(MAX_QUANTITY))
        .addStringOption((o) => o.setName("due-at").setDescription("Optional deadline (YYYY-MM-DD) -- makes this a time-boxed order."))
        .addStringOption((o) => o.setName("station-tier").setDescription("Station size (only tiers this item has apply; craftable items only).").addChoices(
          { name: "Large", value: "large" }, { name: "Medium", value: "medium" }, { name: "Small", value: "small" }
        ))
        .addBooleanOption((o) => o.setName("crafting-contract").setDescription("Apply the -25% Crafting Contract reduction (craftable items only).")))
    )
```

- [ ] **Step 2: Write the failing tests**

Add to `test/commands.test.js`, near the calculator tests, following that file's existing `mockInteraction`/`multiTenantDb` conventions:

```js
// ── goal:create (Task 5) ──
import { GAME_ITEM_CATALOG_BY_ID } from "../src/gameItemCatalog.js"; // add to existing imports as needed
import { getGoalScoped, listGoalsByOwner } from "../src/database.js"; // add to existing import line

function goalCreateOptions(overrides = {}) {
  const values = {
    scope: "personal",
    item: "Silicone",
    quantity: 100,
    "due-at": null,
    "station-tier": null,
    "crafting-contract": null,
    ...overrides
  };
  return {
    getSubcommandGroup: () => "goal",
    getSubcommand: () => "create",
    getString: (name) => (typeof values[name] === "string" ? values[name] : null),
    getInteger: (name) => (typeof values[name] === "number" ? values[name] : null),
    getBoolean: (name) => (typeof values[name] === "boolean" ? values[name] : null)
  };
}

function goalCreateInteraction(overrides = {}, { userId = `goal-${Math.random()}`, guildId = "guild-1" } = {}) {
  return mockInteraction("goal", "create", { options: goalCreateOptions(overrides), user: { id: userId }, guildId, guild: { ownerId: "someone-else" }, member: { roles: [] } });
}

test("goal:create personal goal succeeds for any user, resolves item_kind='simple' for a non-recipe item", async () => {
  const interaction = goalCreateInteraction({ item: "Silicone", quantity: 500 });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  const handled = await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.equal(handled, true);
  const text = JSON.stringify(edited?.embeds?.[0]);
  assert.doesNotMatch(text, /error/i);
});

test("goal:create resolves item_kind='craftable' for a known recipe item, defaults station-tier to its best available tier", async () => {
  const interaction = goalCreateInteraction({ item: "REPLACE_WITH_VERIFIED_SILICONE_BLOCK_ID", quantity: 100 });
  // NOTE: replace "REPLACE_WITH_VERIFIED_SILICONE_BLOCK_ID" with the real
  // Task 2-verified game item id for silicone_block ("Silicone" per Task 2's
  // worked example) -- this placeholder exists only so you notice and fix
  // it; do not leave it in the committed test.
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  const text = JSON.stringify(edited?.embeds?.[0]);
  assert.match(text, /crafting math|craftable/i, "confirmation must state the resolved kind");
});

test("goal:create rejects an unknown item id", async () => {
  const interaction = goalCreateInteraction({ item: "not-a-real-item-id" });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.match(JSON.stringify(edited?.embeds?.[0]), /unknown item/i);
});

test("goal:create rejects station-tier/crafting-contract for a simple-kind item, not silently ignoring them", async () => {
  const interaction = goalCreateInteraction({ item: "Silicone", "station-tier": "large" });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.match(JSON.stringify(edited?.embeds?.[0]), /no known crafting recipe/i);
});

test("goal:create scope=guild requires admin tier or Discord ownership", async () => {
  const db = multiTenantDb({ observer: ["obs-role"] });
  const interaction = mockInteraction("goal", "create", {
    options: goalCreateOptions({ scope: "guild" }),
    user: { id: "regular-user" },
    guildId: "guild-1",
    guild: { ownerId: "the-real-owner" },
    member: { roles: ["obs-role"] }
  });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, MT_CONFIG, db);
  assert.match(JSON.stringify(edited?.embeds?.[0]), /admin|owner/i);
});

test("goal:create scope=guild succeeds for the real Discord guild owner even with zero configured roles", async () => {
  const db = multiTenantDb({});
  const interaction = mockInteraction("goal", "create", {
    options: goalCreateOptions({ scope: "guild" }),
    user: { id: "real-owner" },
    guildId: "guild-1",
    guild: { ownerId: "real-owner" },
    member: { roles: [] }
  });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  const handled = await executeDuneCommand(interaction, {}, MT_CONFIG, db);
  assert.equal(handled, true);
  assert.doesNotMatch(JSON.stringify(edited?.embeds?.[0]), /error|admin|owner required/i);
});

test("goal:create rejects scope=guild attempted outside a real guild (DM)", async () => {
  const interaction = mockInteraction("goal", "create", { options: goalCreateOptions({ scope: "guild" }), user: { id: "u1" }, guildId: null, guild: null, member: null });
  interaction.inGuild = () => false;
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.match(JSON.stringify(edited?.embeds?.[0]), /server|guild/i);
});

test("goal:create rejects a due-at date already in the past", async () => {
  const interaction = goalCreateInteraction({ "due-at": "2020-01-01" });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.match(JSON.stringify(edited?.embeds?.[0]), /past|due-at/i);
});

test("goal:create enforces the 5-active-personal-goal cap with an actionable, id-bearing rejection", async () => {
  const userId = `cap-test-${Math.random()}`;
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  let lastEdited;
  for (let i = 0; i < 5; i++) {
    const interaction = goalCreateInteraction({ item: "Silicone", quantity: 10 + i }, { userId });
    interaction.editReply = async (payload) => { lastEdited = payload; };
    const handled = await executeDuneCommand(interaction, {}, config);
    assert.equal(handled, true, `goal ${i + 1} of 5 should succeed`);
  }
  const sixth = goalCreateInteraction({ item: "Silicone", quantity: 999 }, { userId });
  sixth.editReply = async (payload) => { lastEdited = payload; };
  await executeDuneCommand(sixth, {}, config);
  const text = JSON.stringify(lastEdited?.embeds?.[0]);
  assert.match(text, /5|cap|limit/i);
  assert.match(text, /\bid\b|#\d/i, "rejection must list existing goals with actionable ids, not just a bare count");
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/commands.test.js`
Expected: fails — `executeGoalCreate is not defined` (once dispatch wiring references it) or the dispatch doesn't recognize `key === "goal:create"` yet.

- [ ] **Step 4: Implement `executeGoalCreate()`**

Add near `executeCalculator()` in `commands.js` (this function needs `db`, unlike the calculator — follow the existing `payload = someFn(interaction, config, db, guildId)` pattern already used by `helpPayload`/`rolesConfigPayload`):

```js
const GOAL_PERSONAL_ACTIVE_CAP = 5;
const GOAL_GUILD_ACTIVE_CAP = 10;
const GOAL_LIFETIME_CAP = 50;

function isValidDueAt(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const todayUtc = new Date(); todayUtc.setUTCHours(0, 0, 0, 0);
  return parsed.getTime() >= todayUtc.getTime();
}

function requireGuildGoalAccess(interaction, config, db) {
  if (!interaction.inGuild?.() || !interaction.guildId) {
    throw new Error("Guild goals require running this command in a server, not a DM.");
  }
  if (!isAdminActor(interaction, config, db, interaction.guildId)) {
    throw new Error("Managing a guild goal requires admin-tier access or server ownership. If you're the server owner but this still fails, ask whoever set up the bot to open the setup portal (the link sent when the bot was added) and configure an Admin Role.");
  }
}

function executeGoalCreate({ interaction, config, db }) {
  const scope = interaction.options.getString("scope");
  const itemId = interaction.options.getString("item");
  const quantity = interaction.options.getInteger("quantity");
  const dueAtRaw = interaction.options.getString("due-at");
  const stationTierOption = interaction.options.getString("station-tier");
  const craftingContractOption = interaction.options.getBoolean("crafting-contract");

  if (!GAME_ITEM_CATALOG_BY_ID.has(itemId)) {
    throw new Error(`Unknown item: '${itemId}'. Try /dune goal create and use the autocomplete suggestions.`);
  }
  const itemName = GAME_ITEM_CATALOG_BY_ID.get(itemId).name;

  let dueAt = null;
  if (dueAtRaw !== null) {
    if (!isValidDueAt(dueAtRaw)) {
      throw new Error(`'${dueAtRaw}' is not a valid, non-past due-at date. Use the format YYYY-MM-DD.`);
    }
    dueAt = dueAtRaw;
  }

  const recipeKey = GAME_ITEM_ID_TO_RECIPE_KEY.get(itemId);
  const itemKind = recipeKey ? "craftable" : "simple";

  if (itemKind === "simple" && (stationTierOption !== null || craftingContractOption !== null)) {
    throw new Error(`${itemName} has no known crafting recipe -- station-tier/crafting-contract don't apply.`);
  }

  let stationTier = null;
  let craftingContract = false;
  let kindConfirmationLine;
  if (itemKind === "craftable") {
    stationTier = stationTierOption ?? bestAvailableTier(recipeKey);
    craftingContract = craftingContractOption ?? false;
    // Validate the tier actually exists for this item (throws "no recipe
    // variant at this tier" otherwise), matching Phase 1's own validation.
    calculateCraftingPlan(recipeKey, MIN_QUANTITY, { stationTier, craftingContract });
    kindConfirmationLine = "Tracking with full crafting math.";
  } else {
    kindConfirmationLine = "Tracking as a simple count -- no known crafting recipe for this item.";
  }

  const ownerType = scope === "guild" ? "guild" : "player";
  const ownerId = scope === "guild" ? interaction.guildId : interaction.user.id;

  if (scope === "guild") {
    requireGuildGoalAccess(interaction, config, db);
  }

  const activeCap = scope === "guild" ? GOAL_GUILD_ACTIVE_CAP : GOAL_PERSONAL_ACTIVE_CAP;
  const activeCount = countGoalsByOwner(db, { ownerType, ownerId, statuses: ["active"] });
  const lifetimeCount = countGoalsByOwner(db, { ownerType, ownerId, statuses: ["active", "completed", "archived"] });
  if (activeCount >= activeCap || lifetimeCount >= GOAL_LIFETIME_CAP) {
    const existing = listGoalsByOwner(db, { ownerType, ownerId, includeCompleted: true });
    const listing = existing.map((g) => `#${g.id} ${GAME_ITEM_CATALOG_BY_ID.get(g.item_id)?.name ?? g.item_id} (${g.status})`).join(", ");
    const which = activeCount >= activeCap ? `the ${activeCap}-active-goal limit` : `the ${GOAL_LIFETIME_CAP}-goal lifetime limit`;
    throw new Error(`You've hit ${which}. Delete one first: ${listing}`);
  }

  const id = createGoal(db, { ownerType, ownerId, itemId, itemKind, targetQuantity: quantity, stationTier, craftingContract, dueAt, createdBy: interaction.user.id });
  appendGoalAuditLog(db, { goalId: id, action: "create", actorId: interaction.user.id });

  return { ok: true, id, itemName, quantity, itemKind, kindConfirmationLine, dueAt };
}
```

Add the module-level constant `GOAL_PERSONAL_ACTIVE_CAP`/`GOAL_GUILD_ACTIVE_CAP`/`GOAL_LIFETIME_CAP` and the two helper functions once — Tasks 6/9 reuse `requireGuildGoalAccess`.

Add these imports to `commands.js`'s top (adjust the existing `./database.js` import line if one exists, or add a new one):
```js
import { createGoal, getGoalScoped, listGoalsByOwner, countGoalsByOwner, setGoalOnHandEntry, getGoalOnHandEntries, countGoalOnHandEntries, completeGoal, deleteGoalScoped, appendGoalAuditLog } from "./database.js";
import { GAME_ITEM_CATALOG_BY_ID } from "./gameItemCatalog.js";
import { GAME_ITEM_ID_TO_RECIPE_KEY, RECIPE_KEY_TO_GAME_ITEM_ID } from "./gameItemIdBridge.js";
```

- [ ] **Step 5: Wire the dispatch**

In `executeDuneCommand()`'s big if-chain, add (near the `data:calculator` branch — a new `// ── goal group (Phase 3) ──` section works well placed right after it):

```js
    else if (key === "goal:create") {
      payload = executeGoalCreate({ interaction, config, db });
    }
```

- [ ] **Step 6: Write the confirmation embed builder**

Add to `src/embedFormat.js` (a small, new function — this is genuinely new UI code, not reused from Phase 1):

```js
export function formatGoalCreateEmbed(payload) {
  const lines = [
    `🎯 **Goal #${payload.id} created**`,
    `${payload.itemName} — target ${payload.quantity.toLocaleString()}`,
    payload.kindConfirmationLine
  ];
  if (payload.dueAt) lines.push(`Due: ${payload.dueAt} (this is an order, not a standing goal)`);
  return duneEmbed({ title: "Goal Created", color: 0x2ecc71, description: lines.join("\n") });
}
```

Wire it into `commands.js`'s embed-selection if-chain (the `subcommand === "..."` block, matching the `subcommand === "calculator"` pattern):

```js
    else if (subcommand === "create" && group === "goal") {
      embed = formatGoalCreateEmbed(payload);
    }
```

(Check the exact variable names your embed-selection if-chain uses for `group`/`subcommand` — match whatever Phase 1's own `subcommand === "calculator"` branch used for consistency.)

- [ ] **Step 7: Run the tests, fix the placeholder, verify green**

Replace `"REPLACE_WITH_VERIFIED_SILICONE_BLOCK_ID"` in the Step 2 test with Task 2's real verified id for `silicone_block` (`"Silicone"`, per Task 2's own worked example).

Run: `node --test test/commands.test.js`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/commands.js src/embedFormat.js test/commands.test.js
git commit -m "feat(goals): /dune goal create"
```

---

## Task 6: `/dune goal on-hand`

**Files:**
- Modify: `src/commands.js`
- Test: `test/commands.test.js`

**Interfaces:**
- Consumes: `getGoalScoped`/`setGoalOnHandEntry`/`countGoalOnHandEntries`/`completeGoal`/`appendGoalAuditLog` (Task 4), `recipeTreeNodes` (existing), `GAME_ITEM_ID_TO_RECIPE_KEY` (Task 2), `resolveEffectiveOnHandCredit` (Task 3, used only to check completion crossing — see Step 4), `requireGuildGoalAccess` (Task 5).
- Produces: `executeGoalOnHand({ interaction, config, db })`; the `on-hand` subcommand registration.

- [ ] **Step 1: Register the subcommand**

Task 5's registration ends with a standalone `)` on its own line, right after `create`'s own closing (`...crafting-contract reduction (craftable items only).")))`) — that standalone `)` is the outer `.addSubcommandGroup(...)` call's own closing paren, and it stays exactly where Task 5 left it through every later task; nothing later ever edits or moves it. Using Edit, insert this new block immediately after `create`'s closing and before that standalone `)`:

```js
      .addSubcommand((c) => c.setName("on-hand").setDescription("Update your current on-hand quantity of one ingredient for a goal.")
        .addIntegerOption((o) => o.setName("id").setDescription("Goal id.").setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName("node").setDescription("Which ingredient (or the goal's own item, for a simple goal).").setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName("quantity").setDescription("Your current total on hand.").setRequired(true).setMinValue(0).setMaxValue(MAX_QUANTITY)))
```

This block is self-contained: its own trailing 3 closing parens (after `MAX_QUANTITY`) close `setMaxValue`, `addIntegerOption`, and `addSubcommand` — not the group. Tasks 7, 8, and 9 each insert their own subcommand the same way, in the same spot (immediately before that same still-untouched standalone `)`), never touching each other's closing parens.

- [ ] **Step 2: Write the failing tests**

```js
// ── goal:on-hand (Task 6) ──
function goalOnHandOptions(overrides = {}) {
  const values = { id: null, node: null, quantity: 0, ...overrides };
  return {
    getSubcommandGroup: () => "goal",
    getSubcommand: () => "on-hand",
    getInteger: (name) => (typeof values[name] === "number" ? values[name] : null),
    getString: (name) => (typeof values[name] === "string" ? values[name] : null)
  };
}

function goalOnHandInteraction(overrides = {}, { userId = `onhand-${Math.random()}`, guildId = "guild-1" } = {}) {
  return mockInteraction("goal", "on-hand", { options: goalOnHandOptions(overrides), user: { id: userId }, guildId, guild: { ownerId: "someone-else" }, member: { roles: [] } });
}

async function createTestGoal({ config, itemId = "REPLACE_WITH_VERIFIED_DURALUMINUM_ROD_ID", quantity = 10000, userId }) {
  // NOTE: replace with Task 2's real verified game item id for
  // duraluminum_ingot before committing this test.
  const createInteraction = goalCreateInteraction({ item: itemId, quantity }, { userId });
  let edited;
  createInteraction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const match = JSON.stringify(edited).match(/Goal #(\d+)/);
  return Number(match[1]);
}

test("goal:on-hand crediting the goal's own item updates and returns a confirmation with no error", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `onhand-target-${Math.random()}`;
  const goalId = await createTestGoal({ config, userId });
  const interaction = goalOnHandInteraction({ id: goalId, node: "REPLACE_WITH_VERIFIED_DURALUMINUM_ROD_ID", quantity: 100 }, { userId });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  const handled = await executeDuneCommand(interaction, {}, config);
  assert.equal(handled, true);
  assert.doesNotMatch(JSON.stringify(edited?.embeds?.[0]), /error/i);
});

test("goal:on-hand shows the previous value, who set it, and when, on a second update", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `onhand-transparency-${Math.random()}`;
  const goalId = await createTestGoal({ config, userId });
  const first = goalOnHandInteraction({ id: goalId, node: "REPLACE_WITH_VERIFIED_DURALUMINUM_ROD_ID", quantity: 50 }, { userId });
  first.editReply = async () => {};
  await executeDuneCommand(first, {}, config);
  const second = goalOnHandInteraction({ id: goalId, node: "REPLACE_WITH_VERIFIED_DURALUMINUM_ROD_ID", quantity: 75 }, { userId });
  let edited;
  second.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(second, {}, config);
  const text = JSON.stringify(edited?.embeds?.[0]);
  assert.match(text, /50/, "must show the previous value");
  assert.match(text, new RegExp(userId), "must show who set the previous value");
});

test("goal:on-hand rejects a free-typed node not in the goal's own recipe tree, even though autocomplete would never suggest it", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `onhand-badnode-${Math.random()}`;
  const goalId = await createTestGoal({ config, userId });
  const interaction = goalOnHandInteraction({ id: goalId, node: "not-a-real-ingredient", quantity: 10 }, { userId });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, config);
  assert.match(JSON.stringify(edited?.embeds?.[0]), /not an ingredient|invalid/i);
});

test("goal:on-hand rejects a 7th on-hand entry on a craftable goal", async () => {
  // Add `createGoal, setGoalOnHandEntry` to this file's existing
  // `../src/database.js` import line (line 867) if not already present --
  // this test seeds directly through Task 4's own accessors.
  //
  // Real recipe data makes the natural version of this test (fill 6
  // legitimate on-hand positions from one item's own recipe tree, then
  // try a 7th) impossible to write today: `water` has no real game-item
  // id at all (gameItemIdBridge.js's documented exception) and is
  // therefore never a valid on-hand node, and once water is excluded, the
  // DEEPEST of the 15 current recipes (industrial_lubricant) has only 5
  // distinct non-water positions -- no current item can ever reach a 6th
  // legitimate node through executeGoalOnHand's own validNodes gate. That
  // doesn't mean the cap is untestable -- it means this test seeds 6 rows
  // directly via the DB accessor (bypassing the validNodes gate on
  // purpose, since that gate has its own dedicated test above) to isolate
  // and verify the cap-enforcement logic itself, in real database rows,
  // not a mock.
  const db = multiTenantDb({});
  const userId = `onhand-cap-${Math.random()}`;
  const goalId = createGoal(db, { ownerType: "player", ownerId: userId, itemId: "Silicone", itemKind: "craftable", targetQuantity: 100, stationTier: "medium", craftingContract: false, dueAt: null, createdBy: userId });
  for (let i = 0; i < 6; i++) {
    setGoalOnHandEntry(db, { goalId, node: `seed-node-${i}`, quantity: 1, updatedBy: userId });
  }
  // "Silicone" itself (the goal's own item_id) is a real, legitimately
  // valid node for this goal (it's the recipe tree's own root) but was
  // never one of the 6 seeded rows above -- so this exercises the CAP
  // rejection specifically, not the "not an ingredient" rejection a
  // genuinely-invalid node would hit instead.
  const seventh = goalOnHandInteraction({ id: goalId, node: "Silicone", quantity: 5 }, { userId });
  let lastEdited;
  seventh.editReply = async (payload) => { lastEdited = payload; };
  await executeDuneCommand(seventh, {}, MT_CONFIG, db);
  assert.match(JSON.stringify(lastEdited?.embeds?.[0]), /6|limit|at most/i);
});

test("goal:on-hand: a personal goal owned by someone else is rejected as not-found, not updated", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const ownerId = `owner-${Math.random()}`;
  const goalId = await createTestGoal({ config, userId: ownerId });
  const attacker = goalOnHandInteraction({ id: goalId, node: "REPLACE_WITH_VERIFIED_DURALUMINUM_ROD_ID", quantity: 99999 }, { userId: `attacker-${Math.random()}` });
  let edited;
  attacker.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(attacker, {}, config);
  assert.match(JSON.stringify(edited?.embeds?.[0]), /not found/i);
});

test("goal:on-hand: a guild-A admin cannot update guild-B's goal by free-typing its id", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  // Create a guild goal under guild-1 as its real owner.
  const guild1Owner = goalCreateInteraction({ scope: "guild", item: "Silicone", quantity: 100 }, { userId: "owner-1", guildId: "guild-1" });
  guild1Owner.guild = { ownerId: "owner-1" };
  guild1Owner.member = { roles: [] };
  let edited;
  guild1Owner.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(guild1Owner, {}, config);
  const goalId = Number(JSON.stringify(edited).match(/Goal #(\d+)/)[1]);

  // A different guild's admin tries to touch it.
  const attacker = goalOnHandInteraction({ id: goalId, node: "Silicone", quantity: 5 }, { userId: "admin-of-guild-2", guildId: "guild-2" });
  attacker.guild = { ownerId: "admin-of-guild-2" };
  attacker.member = { roles: [] };
  let attackerEdited;
  attacker.editReply = async (payload) => { attackerEdited = payload; };
  await executeDuneCommand(attacker, {}, config);
  assert.match(JSON.stringify(attackerEdited?.embeds?.[0]), /not found/i);
});

test("goal:on-hand crossing the target auto-completes the goal", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `crossing-${Math.random()}`;
  const createInteraction = goalCreateInteraction({ item: "Silicone", quantity: 100 }, { userId });
  let created;
  createInteraction.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);

  const underInteraction = goalOnHandInteraction({ id: goalId, node: "Silicone", quantity: 99 }, { userId });
  underInteraction.editReply = async () => {};
  await executeDuneCommand(underInteraction, {}, config);
  const goalAfterUnder = getGoalScoped(dbFromConfig(config), { id: goalId, ownerType: "player", ownerId: userId });
  // NOTE: replace dbFromConfig(config) with however this test file's own
  // convention makes the real `db` instance reachable for direct assertions
  // -- if the RBAC-mode "open" single-tenant path used above doesn't carry
  // a `db` at all, restructure this specific test to use multiTenantDb()
  // instead (matching the guild-goal tests above), since verifying the
  // exact-boundary completion transition needs to read the real row.

  const atInteraction = goalOnHandInteraction({ id: goalId, node: "Silicone", quantity: 100 }, { userId });
  let atEdited;
  atInteraction.editReply = async (payload) => { atEdited = payload; };
  await executeDuneCommand(atInteraction, {}, config);
  assert.match(JSON.stringify(atEdited?.embeds?.[0]), /complete/i);

  const overInteraction = goalOnHandInteraction({ id: goalId, node: "Silicone", quantity: 150 }, { userId });
  let overEdited;
  overInteraction.editReply = async (payload) => { overEdited = payload; };
  await executeDuneCommand(overInteraction, {}, config);
  assert.match(JSON.stringify(overEdited?.embeds?.[0]), /complete/i);
});
```

**Note on the placeholders in this task's tests** (`REPLACE_WITH_VERIFIED_DURALUMINUM_ROD_ID`, `REPLACE_WITH_6_REAL_INGREDIENT_KEYS_FROM_DURALUMINUM_TREE`): fill these in with Task 2's real, verified ids/keys before committing — do not leave them in the file. The 7-entries-cap test needs 6 *distinct* real node values from a craftable item's own `recipeTreeNodes()` output (the target item itself counts as one valid node, per Task 3/Task 8's own logic) — Duraluminum's tree includes itself, water, jasmium_crystal, aluminum_ingot (nested), and aluminum_ingot's own inputs (water, aluminum_ore) — check `recipeTreeNodes("duraluminum_ingot")`'s real output directly (`node --eval 'import("./src/craftingCalculator.js").then(m => console.log(m.recipeTreeNodes("duraluminum_ingot")))'`) to get exactly 6 real distinct keys, and a 7th real key that exists in the tree but wasn't yet used in the loop.

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/commands.test.js`
Expected: fails on `executeGoalOnHand is not defined`.

- [ ] **Step 4: Implement `executeGoalOnHand()`**

```js
function executeGoalOnHand({ interaction, config, db }) {
  const id = interaction.options.getInteger("id");
  const node = interaction.options.getString("node");
  const quantity = interaction.options.getInteger("quantity");

  // Binding rule: try personal first, then guild -- whichever scope the
  // goal is actually under determines the real authorization path. We
  // don't know the goal's scope until we find it, so probe both scoped
  // lookups; a real cross-tenant/cross-owner id will match neither.
  let goal = getGoalScoped(db, { id, ownerType: "player", ownerId: interaction.user.id });
  if (!goal && interaction.guildId) {
    const guildCandidate = getGoalScoped(db, { id, ownerType: "guild", ownerId: interaction.guildId });
    if (guildCandidate) {
      requireGuildGoalAccess(interaction, config, db);
      goal = guildCandidate;
    }
  }
  if (!goal) {
    throw new Error(`Goal #${id} not found.`);
  }

  let validNodes;
  if (goal.item_kind === "craftable") {
    const recipeKey = GAME_ITEM_ID_TO_RECIPE_KEY.get(goal.item_id);
    // recipeTreeNodes() returns mentat's own snake_case recipe/leaf keys,
    // but goal_on_hand_entries stores real game item ids -- every key must
    // be mapped through RECIPE_KEY_TO_GAME_ITEM_ID before comparing
    // against `node`. The root node maps to goal.item_id directly (it's
    // already the real id, that's how the goal itself was created); every
    // other node maps through the bridge -- EXCEPT `water`, which has no
    // real game-item id at all (gameItemIdBridge.js's documented
    // exception) and must be filtered out, not included as a literal
    // `undefined` entry in the Set (an `undefined` entry would make
    // `validNodes.has(undefined)` true, and while no real Discord option
    // value can ever BE `undefined`, leaving it in is still a real
    // correctness bug worth avoiding deliberately, not by accident).
    validNodes = new Set(
      recipeTreeNodes(recipeKey)
        .map((n) => (n.key === recipeKey ? goal.item_id : RECIPE_KEY_TO_GAME_ITEM_ID.get(n.key)))
        .filter((gameItemId) => gameItemId !== undefined)
    );
  } else {
    validNodes = new Set([goal.item_id]);
  }
  if (!validNodes.has(node)) {
    throw new Error(`'${node}' is not an ingredient of this goal. Try /dune goal on-hand and use the autocomplete suggestions.`);
  }

  const existingCount = countGoalOnHandEntries(db, id);
  const alreadyHasThisNode = getGoalOnHandEntries(db, id).some((e) => e.node === node);
  const cap = goal.item_kind === "craftable" ? 6 : 1;
  if (!alreadyHasThisNode && existingCount >= cap) {
    throw new Error(`This goal already has ${cap} on-hand ${cap === 1 ? "entry" : "entries"} -- that's the limit. Update an existing one instead of adding a new one.`);
  }

  const previous = setGoalOnHandEntry(db, { goalId: id, node, quantity, updatedBy: interaction.user.id });
  appendGoalAuditLog(db, { goalId: id, action: "on_hand_update", actorId: interaction.user.id, node, previousQuantity: previous?.previousQuantity ?? null, newQuantity: quantity });

  let completed = false;
  if (goal.status === "active") {
    const entries = getGoalOnHandEntries(db, id).map((e) => ({ node: e.node, quantity: e.quantity }));
    const recipeKey = goal.item_kind === "craftable" ? GAME_ITEM_ID_TO_RECIPE_KEY.get(goal.item_id) : null;
    const targetOnHand = entries.find((e) => e.node === goal.item_id)?.quantity ?? 0;
    const reachedTarget = goal.item_kind === "simple"
      ? targetOnHand >= goal.target_quantity
      : resolveEffectiveOnHandCredit(recipeKey, goal.target_quantity, entries.map((e) => ({ node: e.node === goal.item_id ? recipeKey : GAME_ITEM_ID_TO_RECIPE_KEY.get(e.node) ?? e.node, quantity: e.quantity })), { stationTier: goal.station_tier, craftingContract: !!goal.crafting_contract }).effectiveQuantity === 0;
    if (reachedTarget) {
      completeGoal(db, { id });
      appendGoalAuditLog(db, { goalId: id, action: "complete", actorId: interaction.user.id });
      completed = true;
    }
  }

  return { ok: true, goalId: id, node, quantity, previous, completed };
}
```

**Key-space mismatch, worth tracing through carefully**: `recipeTreeNodes(recipeKey)` returns **mentat's own snake_case keys** (e.g. `"aluminum_ore"`), but `goal_on_hand_entries.node` and the `node` option value are **real game item ids** (e.g. whatever Task 2 verified for `aluminum_ore`) — every key must be mapped through `RECIPE_KEY_TO_GAME_ITEM_ID` before comparing against `node`, with `water` filtered out (see the comment in the code above — it has no real id at all). The completion-check block a few lines below has to do the same mapping in **reverse** (game-item-id → recipe-key) to call `resolveEffectiveOnHandCredit()`, which expects recipe-key-shaped `node` values — since `water` can never be a stored on-hand entry (it was already excluded from `validNodes`, so `setGoalOnHandEntry` is never reached with it), the reverse mapping never has to handle it either; trace through both directions and confirm this with the tests below.

- [ ] **Step 5: Wire the dispatch and confirmation embed**

```js
    else if (key === "goal:on-hand") {
      payload = executeGoalOnHand({ interaction, config, db });
    }
```

```js
export function formatGoalOnHandEmbed(payload) {
  const lines = [`✅ Goal #${payload.goalId}: ${payload.node} set to ${payload.quantity.toLocaleString()}`];
  if (payload.previous) {
    lines.push(`Previous: ${payload.previous.previousQuantity.toLocaleString()} (set by <@${payload.previous.previousUpdatedBy}> at ${payload.previous.previousUpdatedAt})`);
  }
  if (payload.completed) lines.push("🎉 **Goal complete!**");
  return duneEmbed({ title: "On-Hand Updated", color: payload.completed ? 0xf1c40f : 0x3498db, description: lines.join("\n") });
}
```

```js
    else if (subcommand === "on-hand" && group === "goal") {
      embed = formatGoalOnHandEmbed(payload);
    }
```

- [ ] **Step 6: Run the tests, resolve every placeholder, verify green**

Run: `node --test test/commands.test.js`
Expected: all pass once every `REPLACE_WITH_*` placeholder from Step 2 is filled in with real, verified values and the `dbFromConfig`/db-reachability note in the crossing-completion test is resolved against this file's actual conventions.

- [ ] **Step 7: Commit**

```bash
git add src/commands.js src/embedFormat.js test/commands.test.js
git commit -m "feat(goals): /dune goal on-hand"
```

---

## Task 7: `/dune goal list`

**Files:**
- Modify: `src/commands.js`
- Test: `test/commands.test.js`

**Interfaces:**
- Consumes: `listGoalsByOwner` (Task 4), `resolveEffectiveOnHandCredit` (Task 3), `requireGuildGoalAccess`'s guild-context check only (list is readable by any member, not admin-gated — reuse just the `interaction.inGuild()` part, not the `isAdminActor` part).
- Produces: `executeGoalList({ interaction, config, db })`; the `list` subcommand.

- [ ] **Step 1: Register the subcommand**

```js
      .addSubcommand((c) => c.setName("list").setDescription("List your (or your guild's) active goals.")
        .addStringOption((o) => o.setName("scope").setDescription("Personal or guild goals.").setRequired(true).addChoices(
          { name: "Personal", value: "personal" }, { name: "Guild", value: "guild" }
        ))
        .addBooleanOption((o) => o.setName("include-completed").setDescription("Also show completed/archived goals.")))
```

- [ ] **Step 2: Write the failing tests**

```js
// ── goal:list (Task 7) ──
function goalListOptions(overrides = {}) {
  const values = { scope: "personal", "include-completed": null, ...overrides };
  return {
    getSubcommandGroup: () => "goal",
    getSubcommand: () => "list",
    getString: (name) => (typeof values[name] === "string" ? values[name] : null),
    getBoolean: (name) => (typeof values[name] === "boolean" ? values[name] : null)
  };
}

test("goal:list shows an overdue flag only for an active order past its due date, never a completed one", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `overdue-${Math.random()}`;
  const pastDue = goalCreateInteraction({ item: "Silicone", quantity: 10, "due-at": null }, { userId });
  // Create via the normal path, then hand-set an already-past due_at directly
  // through the database accessor (simulating time having passed) rather
  // than fighting isValidDueAt()'s own past-date rejection at creation time.
  let created;
  pastDue.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(pastDue, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);
  // Directly backdate due_at using whatever this test file's real db handle
  // is for the single-tenant "open" rbac path used elsewhere in this
  // section -- if that path genuinely has no reachable db, switch this
  // test's setup to multiTenantDb() so a real db instance is available to
  // mutate directly with db.prepare("UPDATE goals SET due_at = ? WHERE id = ?").run(...).

  const listInteraction = goalListInteraction({ scope: "personal" }, { userId });
  let listEdited;
  listInteraction.editReply = async (payload) => { listEdited = payload; };
  await executeDuneCommand(listInteraction, {}, config);
  assert.match(JSON.stringify(listEdited?.embeds?.[0]), /overdue/i);
});

test("goal:list never flags a standing goal (due_at null) as overdue", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `standing-${Math.random()}`;
  const createInteraction = goalCreateInteraction({ item: "Silicone", quantity: 10 }, { userId });
  createInteraction.editReply = async () => {};
  await executeDuneCommand(createInteraction, {}, config);
  const listInteraction = goalListInteraction({ scope: "personal" }, { userId });
  let listEdited;
  listInteraction.editReply = async (payload) => { listEdited = payload; };
  await executeDuneCommand(listInteraction, {}, config);
  assert.doesNotMatch(JSON.stringify(listEdited?.embeds?.[0]), /overdue/i);
});

test("goal:list one poisoned/unrenderable goal row shows 'unavailable' for that line without breaking the rest of the list", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `poisoned-${Math.random()}`;
  const goodInteraction = goalCreateInteraction({ item: "Silicone", quantity: 10 }, { userId });
  goodInteraction.editReply = async () => {};
  await executeDuneCommand(goodInteraction, {}, config);
  // Simulate a stale/poisoned row directly via the db accessor -- a
  // craftable goal whose station_tier no longer exists for its item, e.g.
  // by hand-inserting a row with an impossible station_tier through
  // createGoal(), then listing and confirming the OTHER (good) row still
  // renders correctly alongside an "unavailable" line for the bad one.
  const listInteraction = goalListInteraction({ scope: "personal" }, { userId });
  let listEdited;
  listInteraction.editReply = async (payload) => { listEdited = payload; };
  await executeDuneCommand(listInteraction, {}, config);
  const text = JSON.stringify(listEdited?.embeds?.[0]);
  assert.match(text, /silicone/i, "the good row must still render");
});

function goalListInteraction(overrides = {}, { userId = `list-${Math.random()}`, guildId = "guild-1" } = {}) {
  return mockInteraction("goal", "list", { options: goalListOptions(overrides), user: { id: userId }, guildId, guild: { ownerId: "someone-else" }, member: { roles: [] } });
}
```

**Note**: the "poisoned row" and "backdated due_at" tests above deliberately describe the scenario rather than give you a copy-pasteable direct-db-mutation snippet, since the exact mechanism depends on how this test file's `config`/`db` are wired for the single-tenant "open" RBAC path used throughout this plan's tests. Resolve this the same way as Task 6's `dbFromConfig` note: either find the real db handle already reachable in that path, or switch these two tests to use `multiTenantDb()` (which gives you a real, directly-mutable `db` instance) instead of the single-tenant "open" config path.

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/commands.test.js`
Expected: fails on `executeGoalList`/`goalListInteraction` not defined.

- [ ] **Step 4: Implement `executeGoalList()`**

```js
function executeGoalList({ interaction, config, db }) {
  const scope = interaction.options.getString("scope");
  const includeCompleted = interaction.options.getBoolean("include-completed") ?? false;
  const ownerType = scope === "guild" ? "guild" : "player";
  const ownerId = scope === "guild" ? interaction.guildId : interaction.user.id;

  if (scope === "guild" && (!interaction.inGuild?.() || !interaction.guildId)) {
    throw new Error("Guild goals require running this command in a server, not a DM.");
  }

  const goals = listGoalsByOwner(db, { ownerType, ownerId, includeCompleted });
  const rows = goals.map((goal) => {
    try {
      const itemName = GAME_ITEM_CATALOG_BY_ID.get(goal.item_id)?.name ?? goal.item_id;
      let progressText = "";
      if (goal.item_kind === "craftable" && goal.status === "active") {
        const recipeKey = GAME_ITEM_ID_TO_RECIPE_KEY.get(goal.item_id);
        const entries = getGoalOnHandEntries(db, goal.id).map((e) => ({ node: e.node === goal.item_id ? recipeKey : (GAME_ITEM_ID_TO_RECIPE_KEY.get(e.node) ?? e.node), quantity: e.quantity }));
        const credited = resolveEffectiveOnHandCredit(recipeKey, goal.target_quantity, entries, { stationTier: goal.station_tier, craftingContract: !!goal.crafting_contract });
        const pct = Math.round(((goal.target_quantity - credited.effectiveQuantity) / goal.target_quantity) * 100);
        progressText = ` — ${pct}%`;
      } else if (goal.item_kind === "simple" && goal.status === "active") {
        const onHand = getGoalOnHandEntries(db, goal.id).find((e) => e.node === goal.item_id)?.quantity ?? 0;
        const pct = Math.round((Math.min(onHand, goal.target_quantity) / goal.target_quantity) * 100);
        progressText = ` — ${pct}%`;
      }
      const overdue = goal.due_at !== null && goal.status === "active" && new Date(`${goal.due_at}T00:00:00Z`).getTime() < Date.now();
      return `#${goal.id} ${itemName} (target ${goal.target_quantity.toLocaleString()}, ${goal.status})${progressText}${overdue ? " ⚠️ OVERDUE" : ""}`;
    } catch {
      return `#${goal.id} — unavailable (this goal's data is stale, contact an admin)`;
    }
  });

  return { ok: true, scope, rows };
}
```

- [ ] **Step 5: Wire dispatch + embed**

```js
    else if (key === "goal:list") {
      payload = executeGoalList({ interaction, config, db });
    }
```

```js
export function formatGoalListEmbed(payload) {
  const description = payload.rows.length > 0 ? payload.rows.join("\n") : "No goals yet — create one with /dune goal create.";
  return duneEmbed({ title: `${payload.scope === "guild" ? "Guild" : "Your"} Goals`, color: 0x3498db, description });
}
```

```js
    else if (subcommand === "list" && group === "goal") {
      embed = formatGoalListEmbed(payload);
    }
```

- [ ] **Step 6: Run tests, resolve db-reachability notes, verify green**

Run: `node --test test/commands.test.js`

- [ ] **Step 7: Commit**

```bash
git add src/commands.js src/embedFormat.js test/commands.test.js
git commit -m "feat(goals): /dune goal list"
```

---

## Task 8: `/dune goal progress`

**Files:**
- Modify: `src/commands.js`
- Modify: `src/embedFormat.js`
- Test: `test/commands.test.js`, `test/embedFormat.calculator.test.js` (or a new `test/embedFormat.goal.test.js` — either is fine, match whichever is cleaner once you see the file sizes)

**Interfaces:**
- Consumes: `resolveEffectiveOnHandCredit`, `estimateDuration` (Task 3/existing), `formatCalculatorEmbed` (existing, reused for the craftable-goal body sections), `getGoalScoped`/`getGoalOnHandEntries` (Task 4).
- Produces: `executeGoalProgress({ interaction, db })`; `formatGoalProgressEmbed(...)` in `embedFormat.js`; the `progress` subcommand.

- [ ] **Step 1: Register the subcommand**

```js
      .addSubcommand((c) => c.setName("progress").setDescription("Full progress detail for one goal.")
        .addIntegerOption((o) => o.setName("id").setDescription("Goal id.").setRequired(true).setAutocomplete(true)))
```

- [ ] **Step 2: Write the failing tests**

```js
// ── goal:progress (Task 8) ──
function goalProgressOptions(overrides = {}) {
  const values = { id: null, ...overrides };
  return { getSubcommandGroup: () => "goal", getSubcommand: () => "progress", getInteger: (name) => (typeof values[name] === "number" ? values[name] : null) };
}
function goalProgressInteraction(overrides = {}, { userId = `progress-${Math.random()}`, guildId = "guild-1" } = {}) {
  return mockInteraction("goal", "progress", { options: goalProgressOptions(overrides), user: { id: userId }, guildId, guild: { ownerId: "someone-else" }, member: { roles: [] } });
}

test("goal:progress for a craftable goal, crediting the goal's own finished item, does not crash and shows reduced remaining work", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `progress-selfcredit-${Math.random()}`;
  const itemId = "REPLACE_WITH_VERIFIED_DURALUMINUM_ROD_ID";
  const createInteraction = goalCreateInteraction({ item: itemId, quantity: 100 }, { userId });
  let created;
  createInteraction.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);

  const onHandInteraction = goalOnHandInteraction({ id: goalId, node: itemId, quantity: 40 }, { userId });
  onHandInteraction.editReply = async () => {};
  await executeDuneCommand(onHandInteraction, {}, config);

  const progressInteraction = goalProgressInteraction({ id: goalId }, { userId });
  let progressEdited;
  progressInteraction.editReply = async (payload) => { progressEdited = payload; };
  const handled = await executeDuneCommand(progressInteraction, {}, config);
  assert.equal(handled, true);
  assert.doesNotMatch(JSON.stringify(progressEdited?.embeds?.[0]), /error|undefined|NaN/i);
});

test("goal:progress for a simple goal shows remaining = target - on-hand, no station/duration fields", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `progress-simple-${Math.random()}`;
  const createInteraction = goalCreateInteraction({ item: "Silicone", quantity: 1000 }, { userId });
  let created;
  createInteraction.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);
  const onHandInteraction = goalOnHandInteraction({ id: goalId, node: "Silicone", quantity: 300 }, { userId });
  onHandInteraction.editReply = async () => {};
  await executeDuneCommand(onHandInteraction, {}, config);
  const progressInteraction = goalProgressInteraction({ id: goalId }, { userId });
  let progressEdited;
  progressInteraction.editReply = async (payload) => { progressEdited = payload; };
  await executeDuneCommand(progressInteraction, {}, config);
  const text = JSON.stringify(progressEdited?.embeds?.[0]);
  assert.match(text, /700/, "remaining should be 1000-300=700");
  assert.doesNotMatch(text, /station|duration/i);
});

test("goal:progress: reused core matches Phase 1 byte-for-byte for the same inputs (Shortfall/Nested Craft/Duration sections)", async () => {
  // Reuse calculator-design.md's own worked example numbers where they line
  // up with a real goal -- compare formatCalculatorEmbed()'s direct output
  // for the same item/quantity/on-hand against formatGoalProgressEmbed()'s
  // body content for an equivalent goal, asserting the shared sections
  // (shortfall lines, nested craft section, duration line) render
  // identically. This test intentionally does NOT assert the whole embed
  // is identical -- the goal wrapper's own title/due-date/footer chrome is
  // new code with its own separate test below, not covered by this claim.
  const { calculateCraftingPlan, applyOnHandCredit, estimateDuration: est } = await import("../src/craftingCalculator.js");
  const { formatCalculatorEmbed } = await import("../src/embedFormat.js");
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 2000 }], { quantity: 25 });
  const phase1Embed = formatCalculatorEmbed(credited, est(credited, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }] });
  const phase1Text = JSON.stringify(phase1Embed.data ?? phase1Embed);

  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `progress-parity-${Math.random()}`;
  const plastaniumId = "REPLACE_WITH_VERIFIED_PLASTANIUM_INGOT_ID";
  const titaniumId = "REPLACE_WITH_VERIFIED_TITANIUM_ORE_ID";
  const createInteraction = goalCreateInteraction({ item: plastaniumId, quantity: 25, "station-tier": "large" }, { userId });
  let created;
  createInteraction.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);
  const onHandInteraction = goalOnHandInteraction({ id: goalId, node: titaniumId, quantity: 2000 }, { userId });
  onHandInteraction.editReply = async () => {};
  await executeDuneCommand(onHandInteraction, {}, config);
  const progressInteraction = goalProgressInteraction({ id: goalId }, { userId });
  let progressEdited;
  progressInteraction.editReply = async (payload) => { progressEdited = payload; };
  await executeDuneCommand(progressInteraction, {}, config);
  const goalText = JSON.stringify(progressEdited?.embeds?.[0]);

  // Both must agree on the real, shared numbers this scenario actually
  // produces -- verified directly by running calculateCraftingPlan/
  // applyOnHandCredit for these exact inputs (25x plastanium_ingot, large
  // tier, 2000 titanium_ore on hand) before this plan was finalized:
  // titanium_ore's shortfall is fully covered (0 remaining, "2,000 on hand
  // -- fully covered"), water's raw shortfall is 33,750 (comma-formatted,
  // via toLocaleString()), and nothing is bottlenecked (maxCompletable
  // covers the full 25). "33,750" is the strongest, least-generic signal
  // to assert on -- it can only appear if the same underlying calculation
  // ran with the same inputs.
  assert.match(goalText, /33,750/);
  assert.match(phase1Text, /33,750/);
  assert.match(goalText, /fully covered/i);
  assert.match(phase1Text, /fully covered/i);
});

test("goal:progress wrapper's own chrome (goal title, due-date line) is present and correct -- not covered by the byte-for-byte reuse claim above", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `progress-chrome-${Math.random()}`;
  const createInteraction = goalCreateInteraction({ item: "Silicone", quantity: 100, "due-at": "2099-01-01" }, { userId });
  let created;
  createInteraction.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);
  const progressInteraction = goalProgressInteraction({ id: goalId }, { userId });
  let progressEdited;
  progressInteraction.editReply = async (payload) => { progressEdited = payload; };
  await executeDuneCommand(progressInteraction, {}, config);
  const text = JSON.stringify(progressEdited?.embeds?.[0]);
  assert.match(text, new RegExp(`Goal #${goalId}`));
  assert.match(text, /2099-01-01/);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/commands.test.js`

- [ ] **Step 4: Implement `executeGoalProgress()`**

```js
function executeGoalProgress({ interaction, config, db }) {
  const id = interaction.options.getInteger("id");
  let goal = getGoalScoped(db, { id, ownerType: "player", ownerId: interaction.user.id });
  if (!goal && interaction.guildId) {
    goal = getGoalScoped(db, { id, ownerType: "guild", ownerId: interaction.guildId });
    // Read access is open to any guild member -- no isAdminActor gate here,
    // matching the spec's RBAC table (list/progress = any member).
  }
  if (!goal) {
    throw new Error(`Goal #${id} not found.`);
  }

  const entries = getGoalOnHandEntries(db, id);
  const itemName = GAME_ITEM_CATALOG_BY_ID.get(goal.item_id)?.name ?? goal.item_id;

  if (goal.item_kind === "simple") {
    const onHand = entries.find((e) => e.node === goal.item_id)?.quantity ?? 0;
    const remaining = Math.max(0, goal.target_quantity - onHand);
    return { kind: "simple", goal, itemName, onHand, remaining };
  }

  const recipeKey = GAME_ITEM_ID_TO_RECIPE_KEY.get(goal.item_id);
  const mappedEntries = entries.map((e) => ({ node: e.node === goal.item_id ? recipeKey : (GAME_ITEM_ID_TO_RECIPE_KEY.get(e.node) ?? e.node), quantity: e.quantity }));
  const credited = resolveEffectiveOnHandCredit(recipeKey, goal.target_quantity, mappedEntries, { stationTier: goal.station_tier, craftingContract: !!goal.crafting_contract });
  const durations = credited.effectiveQuantity === 0 ? [] : estimateDuration(credited, { stationCount: 1 });

  return { kind: "craftable", goal, itemName, plan: credited, durations, onHandEntries: mappedEntries };
}
```

- [ ] **Step 5: Wire dispatch + the wrapper embed**

```js
    else if (key === "goal:progress") {
      payload = executeGoalProgress({ interaction, db });
    }
```

```js
export function formatGoalProgressEmbed(payload) {
  const { goal, itemName } = payload;
  const overdue = goal.due_at !== null && goal.status === "active" && new Date(`${goal.due_at}T00:00:00Z`).getTime() < Date.now();
  const header = [`🎯 **Goal #${goal.id}: ${itemName}**`];
  if (goal.due_at) header.push(`Due: ${goal.due_at}${overdue ? " ⚠️ OVERDUE" : ""}`);

  if (payload.kind === "simple") {
    header.push(`On hand: ${payload.onHand.toLocaleString()} / ${goal.target_quantity.toLocaleString()}`);
    header.push(payload.remaining === 0 ? "✅ Target reached." : `Still need: ${payload.remaining.toLocaleString()}`);
    return duneEmbed({ title: "Goal Progress", color: payload.remaining === 0 ? 0x2ecc71 : 0x3498db, description: header.join("\n") });
  }

  // Craftable: reuse formatCalculatorEmbed()'s body content byte-for-byte
  // for the shared sections, then prepend this wrapper's own goal-specific
  // chrome -- see this task's byte-for-byte test for what "reused" means
  // precisely (the Shortfall/Nested Craft/Duration sections, not the whole
  // embed object).
  const inner = formatCalculatorEmbed(payload.plan, payload.durations, { onHandEntries: payload.onHandEntries });
  const innerDescription = inner.data?.description ?? inner.description ?? "";
  return duneEmbed({ title: `Goal Progress — #${goal.id}`, color: 0x3498db, description: [...header, "", innerDescription].join("\n") });
}
```

```js
    else if (subcommand === "progress" && group === "goal") {
      embed = formatGoalProgressEmbed(payload);
    }
```

Import `formatCalculatorEmbed` into wherever `formatGoalProgressEmbed` lives if it isn't already in scope there (both are in `embedFormat.js`, so no new import needed if defined in the same file).

- [ ] **Step 6: Run tests, resolve placeholders, verify green**

Run: `node --test test/commands.test.js`

- [ ] **Step 7: Commit**

```bash
git add src/commands.js src/embedFormat.js test/commands.test.js
git commit -m "feat(goals): /dune goal progress, reusing Phase 1's full calculation pipeline"
```

---

## Task 9: `/dune goal delete`

**Files:**
- Modify: `src/commands.js`
- Test: `test/commands.test.js`

**Interfaces:**
- Consumes: `deleteGoalScoped`, `getGoalScoped`, `appendGoalAuditLog` (Task 4), `requireGuildGoalAccess` (Task 5).
- Produces: `executeGoalDelete({ interaction, config, db })`; the `delete` subcommand.

- [ ] **Step 1: Register the subcommand**

```js
      .addSubcommand((c) => c.setName("delete").setDescription("Delete a goal.")
        .addIntegerOption((o) => o.setName("id").setDescription("Goal id.").setRequired(true).setAutocomplete(true)))
```

**Paren count matters here — get this exactly right.** This ends in exactly 3 closing parens after `true` (closing `setAutocomplete`, then `addIntegerOption`, then `addSubcommand`), the same self-contained pattern every other subcommand in this group uses (`create`, `on-hand`, `list`, `progress`). It does **not** close the outer `.addSubcommandGroup(...)` call — that was already closed by a standalone `)` on its own line at the very end of Task 5's original registration, which has never been touched or removed by Tasks 6-8 and must not be touched by this task either. Insert this `delete` block the same way Tasks 6-8 inserted theirs: immediately after `progress`'s own closing (`...setAutocomplete(true)))`, from Task 8) and **before** that still-untouched final `)` line. An earlier draft of this task incorrectly added a 4th closing paren here on the theory that the "last" subcommand needs to close the group itself — it doesn't; verify with `node --check src/commands.js` (or just run the test suite in Step 4) if in doubt, since an extra or missing paren here is a silent trap that only surfaces as a confusing syntax error location far from its actual cause.

- [ ] **Step 2: Write the failing tests**

```js
// ── goal:delete (Task 9) ──
function goalDeleteOptions(overrides = {}) {
  const values = { id: null, ...overrides };
  return { getSubcommandGroup: () => "goal", getSubcommand: () => "delete", getInteger: (name) => (typeof values[name] === "number" ? values[name] : null) };
}
function goalDeleteInteraction(overrides = {}, { userId = `delete-${Math.random()}`, guildId = "guild-1" } = {}) {
  return mockInteraction("goal", "delete", { options: goalDeleteOptions(overrides), user: { id: userId }, guildId, guild: { ownerId: "someone-else" }, member: { roles: [] } });
}

test("goal:delete removes the goal and cascades its on-hand entries; audit log survives", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const userId = `delete-owner-${Math.random()}`;
  const createInteraction = goalCreateInteraction({ item: "Silicone", quantity: 10 }, { userId });
  let created;
  createInteraction.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);
  const onHandInteraction = goalOnHandInteraction({ id: goalId, node: "Silicone", quantity: 5 }, { userId });
  onHandInteraction.editReply = async () => {};
  await executeDuneCommand(onHandInteraction, {}, config);

  const deleteInteraction = goalDeleteInteraction({ id: goalId }, { userId });
  let deleteEdited;
  deleteInteraction.editReply = async (payload) => { deleteEdited = payload; };
  const handled = await executeDuneCommand(deleteInteraction, {}, config);
  assert.equal(handled, true);
  assert.doesNotMatch(JSON.stringify(deleteEdited?.embeds?.[0]), /error|not found/i);
});

test("goal:delete rejects someone else's personal goal as not-found", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const ownerId = `real-owner-${Math.random()}`;
  const createInteraction = goalCreateInteraction({ item: "Silicone", quantity: 10 }, { userId: ownerId });
  let created;
  createInteraction.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(createInteraction, {}, config);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);
  const attacker = goalDeleteInteraction({ id: goalId }, { userId: `attacker-${Math.random()}` });
  let attackerEdited;
  attacker.editReply = async (payload) => { attackerEdited = payload; };
  await executeDuneCommand(attacker, {}, config);
  assert.match(JSON.stringify(attackerEdited?.embeds?.[0]), /not found/i);
});

test("goal:delete on a guild goal requires admin/owner, same as create", async () => {
  const db = multiTenantDb({ observer: ["obs-role"] });
  const create = mockInteraction("goal", "create", { options: goalCreateOptions({ scope: "guild" }), user: { id: "the-owner" }, guildId: "guild-1", guild: { ownerId: "the-owner" }, member: { roles: [] } });
  let created;
  create.editReply = async (payload) => { created = payload; };
  await executeDuneCommand(create, {}, MT_CONFIG, db);
  const goalId = Number(JSON.stringify(created).match(/Goal #(\d+)/)[1]);

  const nonAdmin = mockInteraction("goal", "delete", { options: goalDeleteOptions({ id: goalId }), user: { id: "regular-member" }, guildId: "guild-1", guild: { ownerId: "the-owner" }, member: { roles: ["obs-role"] } });
  let nonAdminEdited;
  nonAdmin.editReply = async (payload) => { nonAdminEdited = payload; };
  await executeDuneCommand(nonAdmin, {}, MT_CONFIG, db);
  assert.match(JSON.stringify(nonAdminEdited?.embeds?.[0]), /admin|owner/i);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `node --test test/commands.test.js`

- [ ] **Step 4: Implement `executeGoalDelete()`**

```js
function executeGoalDelete({ interaction, config, db }) {
  const id = interaction.options.getInteger("id");
  let goal = getGoalScoped(db, { id, ownerType: "player", ownerId: interaction.user.id });
  let ownerType = "player", ownerId = interaction.user.id;
  if (!goal && interaction.guildId) {
    const guildCandidate = getGoalScoped(db, { id, ownerType: "guild", ownerId: interaction.guildId });
    if (guildCandidate) {
      requireGuildGoalAccess(interaction, config, db);
      goal = guildCandidate;
      ownerType = "guild"; ownerId = interaction.guildId;
    }
  }
  if (!goal) {
    throw new Error(`Goal #${id} not found.`);
  }

  // Audit row written BEFORE the delete, in the spirit of "record before
  // acting on a destructive change" -- goal_id is not a foreign key on
  // goal_audit_log specifically so this row (and every earlier one for
  // this goal) survives the delete that follows.
  appendGoalAuditLog(db, { goalId: id, action: "delete", actorId: interaction.user.id });
  deleteGoalScoped(db, { id, ownerType, ownerId });

  return { ok: true, id };
}
```

- [ ] **Step 5: Wire dispatch + embed**

```js
    else if (key === "goal:delete") {
      payload = executeGoalDelete({ interaction, config, db });
    }
```

```js
export function formatGoalDeleteEmbed(payload) {
  return duneEmbed({ title: "Goal Deleted", color: 0xe74c3c, description: `Goal #${payload.id} deleted.` });
}
```

```js
    else if (subcommand === "delete" && group === "goal") {
      embed = formatGoalDeleteEmbed(payload);
    }
```

- [ ] **Step 6: Run tests, verify green**

Run: `node --test test/commands.test.js`

- [ ] **Step 7: Commit**

```bash
git add src/commands.js src/embedFormat.js test/commands.test.js
git commit -m "feat(goals): /dune goal delete"
```

---

## Task 10: Autocomplete — `item`, `id`, `node`

**Files:**
- Modify: `src/commands.js`
- Modify: `src/index.js`
- Test: `test/goalAutocomplete.test.js` (new file, matching `test/calculatorAutocomplete.test.js`'s conventions)

**Interfaces:**
- Consumes: `GAME_ITEM_CATALOG` (Task 1), `listGoalsByOwner` (Task 4), `recipeTreeNodes` (existing), `isAdminActor` (existing).
- Produces: `handleGoalAutocomplete(interaction, db)` in `commands.js`; a new `else if` branch in `index.js`'s autocomplete routing.

**This is the one place in this whole plan where RBAC must be re-implemented from scratch** — `index.js`'s autocomplete branch bypasses `executeDuneCommand()`'s normal `isCommandAllowed`/cooldown pipeline entirely (confirmed by reading it directly). A DB-backed autocomplete with no inline scoping here would leak other owners'/guilds' goal labels on every keystroke.

- [ ] **Step 1: Write the failing tests**

```js
// test/goalAutocomplete.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGoalAutocomplete } from "../src/commands.js";
import { createDatabase, upsertGuild, addGuildRole } from "../src/database.js";
import { createGoal } from "../src/database.js";

function mockGoalAutocompleteInteraction({ focusedName, focusedValue = "", scope = null, userId = "u1", guildId = "guild-1", guildOwnerId = "someone-else", memberRoles = [] }) {
  const responded = [];
  return {
    isAutocomplete: () => true,
    commandName: "dune",
    guildId,
    guild: { ownerId: guildOwnerId },
    member: { roles: memberRoles },
    user: { id: userId },
    options: {
      getSubcommandGroup: () => "goal",
      getSubcommand: () => "create", // overridden per-test where relevant via focusedName/scope logic in the handler
      getFocused: (full) => (full ? { name: focusedName, value: focusedValue } : focusedValue),
      getString: (name) => (name === "scope" ? scope : null),
      getInteger: () => null
    },
    respond: async (choices) => { responded.push(...choices); },
    _responded: responded
  };
}

test("item autocomplete: case-insensitive substring match against the full vendored catalog", async () => {
  const db = createDatabase(":memory:");
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "item", focusedValue: "Silicone" });
  await handleGoalAutocomplete(interaction, db);
  assert.ok(interaction._responded.some((c) => c.value === "Silicone"));
});

test("item autocomplete never exceeds Discord's 25-choice cap against the much larger catalog", async () => {
  const db = createDatabase(":memory:");
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "item", focusedValue: "" });
  await handleGoalAutocomplete(interaction, db);
  assert.ok(interaction._responded.length <= 25);
});

test("id autocomplete for scope=personal only ever suggests the caller's own goals, never another player's", async () => {
  const db = createDatabase(":memory:");
  createGoal(db, { ownerType: "player", ownerId: "u1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u1" });
  createGoal(db, { ownerType: "player", ownerId: "u2-someone-else", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u2-someone-else" });
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "id", focusedValue: "", scope: "personal", userId: "u1" });
  await handleGoalAutocomplete(interaction, db);
  assert.equal(interaction._responded.length, 1, "must only see u1's own goal, not u2's");
});

test("id autocomplete for scope=guild requires admin/owner tier before suggesting anything, even other guild members' goals", async () => {
  const db = multiTenantDbHelper();
  createGoal(db, { ownerType: "guild", ownerId: "guild-1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "someone" });
  const nonAdminInteraction = mockGoalAutocompleteInteraction({ focusedName: "id", focusedValue: "", scope: "guild", userId: "regular-member", guildId: "guild-1", guildOwnerId: "the-real-owner", memberRoles: [] });
  await handleGoalAutocomplete(nonAdminInteraction, db);
  assert.equal(nonAdminInteraction._responded.length, 0, "a non-admin must see zero guild goal suggestions, not a leaked list");

  function multiTenantDbHelper() {
    const d = createDatabase(":memory:");
    upsertGuild(d, { guildId: "guild-1", guildName: "Test", consoleUrl: "https://example.test", adapterToken: "t", status: "active" });
    return d;
  }
});

test("node autocomplete for a simple goal only ever offers the goal's own item, never a recipe-tree node", async () => {
  const db = createDatabase(":memory:");
  const goalId = createGoal(db, { ownerType: "player", ownerId: "u1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u1" });
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "node", focusedValue: "", userId: "u1" });
  interaction.options.getInteger = (name) => (name === "id" ? goalId : null);
  await handleGoalAutocomplete(interaction, db);
  assert.deepEqual(interaction._responded.map((c) => c.value), ["Silicone"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/goalAutocomplete.test.js`
Expected: `handleGoalAutocomplete is not a function`.

- [ ] **Step 3: Implement `handleGoalAutocomplete()`**

Add to `commands.js`, near `handleCalculatorAutocomplete`:

```js
export async function handleGoalAutocomplete(interaction, db) {
  const focused = interaction.options.getFocused(true);
  const query = String(focused.value ?? "").toLowerCase();

  if (focused.name === "item") {
    const matches = GAME_ITEM_CATALOG
      .filter((entry) => entry.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((entry) => ({ name: entry.name, value: entry.id }));
    await interaction.respond(matches);
    return;
  }

  if (focused.name === "id") {
    const scope = interaction.options.getString("scope");
    let ownerType, ownerId;
    if (scope === "guild") {
      if (!interaction.guildId || !isAdminActor(interaction, { multiTenant: !!db }, db, interaction.guildId)) {
        await interaction.respond([]);
        return;
      }
      ownerType = "guild"; ownerId = interaction.guildId;
    } else {
      ownerType = "player"; ownerId = interaction.user.id;
    }
    const goals = listGoalsByOwner(db, { ownerType, ownerId, includeCompleted: false })
      .filter((g) => String(g.id).includes(query) || (GAME_ITEM_CATALOG_BY_ID.get(g.item_id)?.name ?? "").toLowerCase().includes(query))
      .slice(0, 25)
      .map((g) => ({ name: `#${g.id} ${GAME_ITEM_CATALOG_BY_ID.get(g.item_id)?.name ?? g.item_id}`, value: g.id }));
    await interaction.respond(goals);
    return;
  }

  if (focused.name === "node") {
    const goalId = interaction.options.getInteger("id");
    if (!goalId) {
      await interaction.respond([{ name: "Select a goal id first", value: 0 }]);
      return;
    }
    // Same ownership scoping as the real on-hand command -- try personal
    // first, then guild (with the same admin-tier gate).
    let goal = getGoalScoped(db, { id: goalId, ownerType: "player", ownerId: interaction.user.id });
    if (!goal && interaction.guildId && isAdminActor(interaction, { multiTenant: !!db }, db, interaction.guildId)) {
      goal = getGoalScoped(db, { id: goalId, ownerType: "guild", ownerId: interaction.guildId });
    }
    if (!goal) {
      await interaction.respond([]);
      return;
    }
    if (goal.item_kind === "simple") {
      const name = GAME_ITEM_CATALOG_BY_ID.get(goal.item_id)?.name ?? goal.item_id;
      await interaction.respond([{ name, value: goal.item_id }]);
      return;
    }
    const recipeKey = GAME_ITEM_ID_TO_RECIPE_KEY.get(goal.item_id);
    const nodes = recipeTreeNodes(recipeKey)
      .filter((n) => n.displayName.toLowerCase().includes(query))
      .map((n) => ({ name: n.displayName, value: n.key === recipeKey ? goal.item_id : RECIPE_KEY_TO_GAME_ITEM_ID.get(n.key) }))
      // `water` (and any other future recipe-tree node with no real game-item
      // id -- see gameItemIdBridge.js's documented exception) must never be
      // suggested here: it can never actually be submitted to /dune goal
      // on-hand (executeGoalOnHand's own validNodes excludes it the same
      // way), so offering it would suggest a value the command itself then
      // rejects as "not an ingredient" -- confusing, not helpful. A
      // fallback to the raw recipe key here (an earlier draft used `?? n.key`)
      // would be actively wrong, not just incomplete: it would suggest
      // mentat's own internal key ("water") as if it were a real,
      // selectable game item id.
      .filter((choice) => choice.value !== undefined)
      .slice(0, 25);
    await interaction.respond(nodes);
  }
}
```

- [ ] **Step 4: Wire into `index.js`**

```js
      } else if (group === "goal") {
        await handleGoalAutocomplete(interaction, db);
      }
```

(Add this as another `else if` branch alongside the existing `if (group === "data" && sub === "calculator")` check, inside the same `interaction.isAutocomplete?.() && interaction.commandName === "dune"` block. Import `handleGoalAutocomplete` into `index.js`'s existing import line from `./commands.js`.)

- [ ] **Step 5: Run tests, verify green**

Run: `node --test test/goalAutocomplete.test.js`

- [ ] **Step 6: Commit**

```bash
git add src/commands.js src/index.js test/goalAutocomplete.test.js
git commit -m "feat(goals): item/id/node autocomplete, independently RBAC-scoped"
```

---

## Task 11: `getCommandRegistry()` / `helpPayload()` Entries

**Files:**
- Modify: `src/commands.js`
- Test: `test/commands.test.js`

**Interfaces:** None new — this closes the exact gap Phase 1's own final review already found once (a real command silently missing from both surfaces).

- [ ] **Step 1: Write the failing test**

Check `test/commands.test.js` for an existing test asserting `helpPayload()`/`getCommandRegistry()` mirror the full real command surface (Phase 1's Task 7 had to satisfy one of these) — if one exists, it should now fail because `goal` isn't listed. If none exists in a form that would catch this, add:

```js
test("helpPayload lists every goal:* subcommand", () => {
  const payload = helpPayload({ discord: { rbac: { mode: "open" } } }, { member: { roles: [] }, user: { id: "u1" } }, null, null);
  const names = [...payload.available, ...payload.locked].map((c) => c.name);
  for (const sub of ["create", "on-hand", "list", "progress", "delete"]) {
    assert.ok(names.includes(`goal:${sub}`), `helpPayload is missing goal:${sub}`);
  }
});

test("getCommandRegistry lists the goal group", () => {
  const registry = getCommandRegistry();
  const goalGroup = registry.find((g) => g.group === "goal");
  assert.ok(goalGroup, "getCommandRegistry is missing the goal group entirely");
  for (const sub of ["create", "on-hand", "list", "progress", "delete"]) {
    assert.ok(goalGroup.commands.some((c) => c.name.startsWith(sub)), `getCommandRegistry's goal group is missing ${sub}`);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/commands.test.js`

- [ ] **Step 3: Add the entries**

In `helpPayload()`'s `all` array, add (matching the `data:calculator` entry's format, right after it):

```js
    { name: "goal:create", desc: "Create a personal or guild farming goal.", role: "player" },
    { name: "goal:on-hand", desc: "Update your on-hand quantity for a goal.", role: "player" },
    { name: "goal:list", desc: "List your (or your guild's) goals.", role: "player" },
    { name: "goal:progress", desc: "Full progress detail for one goal.", role: "player" },
    { name: "goal:delete", desc: "Delete a goal.", role: "player" },
```

In `getCommandRegistry()`, add a new group entry (matching the `data` group's format):

```js
    {
      group: "goal",
      title: "The Long Game — Farming Goals",
      commands: [
        { name: "create", desc: "Create a personal or guild farming goal", role: "player" },
        { name: "on-hand <id> <node>", desc: "Update your on-hand quantity for a goal", role: "player" },
        { name: "list", desc: "List your (or your guild's) goals", role: "player" },
        { name: "progress <id>", desc: "Full progress detail for one goal", role: "player" },
        { name: "delete <id>", desc: "Delete a goal", role: "player" }
      ]
    },
```

- [ ] **Step 4: Run tests, verify green**

Run: `node --test test/commands.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/commands.js test/commands.test.js
git commit -m "feat(goals): register goal:* in getCommandRegistry() and helpPayload()"
```

---

## Task 12: Redaction Safety

**Files:**
- Test: `test/commands.test.js` (add to it — no source change expected if Tasks 5-9 followed the fixed-field-name constraint correctly; this task exists to *prove* it, not to build new code)

**Interfaces:** None new.

- [ ] **Step 1: Write and run the test**

```js
test("a goal targeting an item whose name contains 'Token' renders its real name, not [REDACTED]", async () => {
  const config = { discord: { defaultEphemeral: true, rbac: { mode: "open" } } };
  const tokenItem = GAME_ITEM_CATALOG.find((e) => e.name.includes("Token"));
  assert.ok(tokenItem, "test setup problem: no catalog item with 'Token' in its name found");
  const interaction = goalCreateInteraction({ item: tokenItem.id, quantity: 5 });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, config);
  const text = JSON.stringify(edited?.embeds?.[0]);
  assert.match(text, new RegExp(tokenItem.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(text, /\[REDACTED\]/);
});
```

Run: `node --test test/commands.test.js`

**If this test fails**: it means one of Tasks 5-9 built a payload shape `redactSecrets()` flags — go back and check whether any goal-related payload object uses a caller-supplied string as an object key, or constructs a `"Name: quantity"`-style label string before it reaches `redactSecrets()`. Fix the payload shape (fixed field names only), not `redactSecrets()` itself.

- [ ] **Step 2: Commit**

```bash
git add test/commands.test.js
git commit -m "test(goals): confirm redactSecrets() doesn't false-positive on real item names"
```

---

## Task 13: `docs/architecture.md` Update

**Files:**
- Modify: `docs/architecture.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Find and update the persisted-table list**

Find `docs/architecture.md`'s "Known Past Confusion" section (or wherever it lists `guilds, guild_roles, guild_settings, ...`) and add `goals, goal_on_hand_entries, goal_audit_log` to that list, with a one-line description matching the existing entries' style (e.g. "`goals`/`goal_on_hand_entries`/`goal_audit_log` — Phase 3 farming goal tracking, see `docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md`").

This closes a gap the design's own audit found: `scripts/check-architecture-doc-drift.js` does **not** mechanically check this table list at all (confirmed by reading it directly during the audit), so nothing else will catch this being missed.

- [ ] **Step 2: Run the drift checker anyway, to confirm it stays clean**

Run: `npm run docs:check-architecture-drift`
Expected: still passes (this script checks `rbac.js`/`writeActions.js`/`writeHandler.js`/`package.json`, none of which this feature touches) — this step exists to confirm Task 5-11's changes genuinely didn't touch anything that script does cover.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md
git commit -m "docs(architecture): add goals/goal_on_hand_entries/goal_audit_log to the persisted-table list"
```

---

## Task 14: Final Integration — Discord Budget, User Guide, Change Note, Full Verification

**Files:**
- Modify: `test/commands.test.js`
- Modify: `docs/user-guide.md`
- Create: `docs/changes/PR-XXXX-goal-order-tracking.md`
- Modify: `docs/changes/README.md`

**Interfaces:** None new.

- [ ] **Step 1: Extend the Discord command-budget regression test**

`test/commands.test.js` already has `commandDefinitions: write-group /dune build stays under Discord's 8000-char command budget`. Re-run it now that the `goal` group is registered:

Run: `node --test test/commands.test.js -t "8000-char"` (adjust the `-t` filter to match the real test name if it differs)

If it fails (either the hard 8000 or the 7800 target), **trim option descriptions** across Tasks 5-9's subcommands (shorter `.setDescription(...)` strings) until it passes — do not raise the 7800/8000 thresholds themselves. Re-run until green.

- [ ] **Step 2: Add a `docs/user-guide.md` entry**

Find the existing command-group table (search for `data calculator` per Phase 1's own precedent) and add a `goal create|on-hand|list|progress|delete` row group, following that file's existing format and level of detail.

- [ ] **Step 3: Run the full test suite**

Run: `npm run check` (or the repo's real full-verification command — check `package.json`'s `scripts.check` for the exact composition, matching Phase 1's own final task).
Expected: everything passes, including `registry:validate`, `docs:check-architecture-drift`, `release:check`, `package:addon`, `sbom`.

- [ ] **Step 4: Run `npm audit`**

Run: `npm audit --audit-level=moderate`
Expected: 0 vulnerabilities (this feature adds no new dependency, so this should be a no-op confirmation).

- [ ] **Step 5: Create the change note (placeholder PR number, matching Phase 1's own precedent)**

Create `docs/changes/PR-XXXX-goal-order-tracking.md`:

```markdown
# PR Change Summary — Goal & Order Tracking (Phase 3)

## Addressed Items

### 1. `/dune goal create|on-hand|list|progress|delete` — persistent farming goals and orders ✅

**Problem:** Players and guilds had no way to track a farming goal over time without re-running the calculator from scratch each session, and no way to target a goal at any of the 2,558 items in the game beyond the 15 the calculator has recipes for.

**Solution:** Three new SQLite tables (`goals`, `goal_on_hand_entries`, `goal_audit_log`) back five new subcommands. Craftable-item goals reuse Phase 1's full calculation pipeline via a newly-extracted shared function (`resolveEffectiveOnHandCredit()`); any other catalog item gets simple target-minus-on-hand tracking. Guild goals are RBAC-gated to admin-tier/ownership, bound to the creating guild to prevent cross-tenant access.

**Commands:**
- `/dune goal create scope:<personal|guild> item:<...> quantity:<1-100000> [due-at] [station-tier] [crafting-contract]`
- `/dune goal on-hand id:<...> node:<...> quantity:<0-100000>`
- `/dune goal list scope:<personal|guild> [include-completed]`
- `/dune goal progress id:<...>`
- `/dune goal delete id:<...>`

**Implementation Details:**
- `src/gameItemCatalog.js`/`.data.json` — vendored, deduplicated copy of Core's real 2,551-item catalog
- `src/gameItemIdBridge.js` — standalone Map-based bridge from mentat's recipe keys to real game item ids
- `src/craftingCalculator.js`'s `resolveEffectiveOnHandCredit()` — extracted from Phase 1's `executeCalculator()`, reused by both
- `src/database.js`'s `goals`/`goal_on_hand_entries`/`goal_audit_log` schema and accessors
- Full design record and Layer 1 audit: `docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md`, tracking issue `mentat`#420
```

- [ ] **Step 6: Add the change-note index row**

Add a row to `docs/changes/README.md`'s index table, matching its existing format: `| PR-XXXX | PR | Goal & order tracking (Phase 3) | Not yet opened |`

- [ ] **Step 7: Final commit**

```bash
git add test/commands.test.js docs/user-guide.md docs/changes/
git commit -m "docs(goals): user guide entry, PR change note, final Discord budget verification"
```

**Do not push or open a PR as part of this plan** — per this project's own standing practice (see Phase 1's own plan/implementation), pushing a feature branch and opening a PR is deferred to the controller's `finishing-a-development-branch` step at the very end of the whole SDD process, not done inside a task.
