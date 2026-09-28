# Crafting Calculator Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `/dune data calculator` in the `mentat` repository — a pure, stateless, zero-adapter-call Discord command that computes crafting requirements, shortfall-against-on-hand-stock, max-completable-units, bottleneck identification, and duration for 15 verified craftable items.

**Architecture:** Two new pure-function modules (`src/craftingData.js` for the versioned recipe table, `src/craftingCalculator.js` for traversal/rounding/credit/duration logic) feed a new embed formatter (`src/embedFormat.js`) and a new slash-command handler wired into the existing `commands.js` dispatch chain — the same `payload = ...` / `embed = formatXEmbed(payload)` pattern every other `data:*` command already uses. A new dependent-autocomplete interaction path (`AutocompleteInteraction`, not yet handled anywhere in `index.js`) resolves `on-hand-N` suggestions from whichever `item` is already selected.

**Tech Stack:** Plain JavaScript (ESM), discord.js `SlashCommandBuilder`/`AutocompleteInteraction`, `node --test` (this repo's existing test runner via `scripts/run-tests.js`), no new npm dependency.

**Spec:** `docs/calculator-design.md`, `docs/calculator-architecture.md`, `docs/calculator-security-review.md`, `docs/calculator-grc.md`, `docs/calculator-implementation-prompt.md` — read all five before starting; this plan does not repeat their reasoning, only the concrete steps. Where this plan and any of those five documents ever seem to disagree, the documents win — stop and flag it rather than silently picking one.

## Global Constraints

- `quantity` and every `on-hand-N-quantity` bound: **1–100,000** (quantity) / **0–100,000** (on-hand quantities) — enforced on the Discord option (`setMinValue`/`setMaxValue`) **and independently inside the calculation functions** (`calculateCraftingPlan()`, `applyOnHandCredit()`). Never trust the Discord-side bound alone (FINDING-CALC-1, audit finding S-1).
- Every node-keyed lookup structure inside `applyOnHandCredit()` (the pooled-requirement map, the returned shortfall map) **must be a `Map`, never a plain object literal** — closes a real prototype-pollution finding (S-2). `on-hand-N` values can reach this function after bypassing autocomplete via free-typing.
- Ceiling rounding (`Math.ceil`), applied **per ingredient, per single craft**, before multiplying by batch count. Crafting Contract's `0.75` cost factor (`-25%`) applies to every ingredient quantity — including Water — but **never to an intermediate craftable's own count** (e.g. Plastanium still needs exactly 1 Stravidium Fiber per craft regardless of the modifier; only that fiber's *own ingredients* get cost-factored when it's crafted). See Task 2's worked-example test for the exact numbers this produces. Deep Desert Discount and Refining Contract are **permanently out of scope** — do not implement either, in any form, for any reason.
- Every recipe **variant** (per-tier, not per-item) must carry a `source: { url, verifiedAt }` field. An item missing a real tier (e.g. `plastanium_ingot` has no `small`) must have **no key at all** for that tier — never a null/empty placeholder, never a fabricated interpolated value.
- Zero adapter calls, zero database writes, zero new npm dependency, zero new cooldown namespace — this command reuses the existing shared `cooldown.js` mechanism automatically by being dispatched through `executeDuneCommand()`'s existing `key`-based cooldown check.
- `calculateCraftingPlan()` and `applyOnHandCredit()` return **structured plan objects**, never pre-formatted strings — all Discord-facing formatting lives in `embedFormat.js` only, so the calculation logic stays unit-testable without `discord.js`.
- Unknown item / unavailable tier / duplicate on-hand node / mismatched on-hand pair / out-of-range quantity all throw a plain `Error` with the exact user-facing message text as `error.message` — `executeDuneCommand()`'s existing top-level `try/catch` → `sendError(interaction, { error: error.message })` fallback already renders this correctly; do not add any new error-handling branch to `commands.js`'s catch block for this feature.

## Review Focus

- **A free-typed `on-hand-N` value containing `"__proto__"`, `"constructor"`, or `"prototype"`** (autocomplete bypassed) — a reasonable person expects this to be rejected as "not an ingredient of `<item>`," never to silently resolve against `Object.prototype` and corrupt shared state for every other user of this long-running process. Covered in Task 3.
- **Two `on-hand-N` slots naming the same node** — a reasonable person expects an explicit rejection naming both slots, never a silent sum or silent first-wins. Covered in Task 7.
- **`quantity`/`on-hand-N-quantity` delivered as a non-integer, negative, zero (for `on-hand-N-quantity` specifically — `quantity` itself has a floor of 1, but `on-hand-N-quantity` floors at 0 and must still reject negative/non-integer/NaN), or a value bypassing Discord's own client-side bound entirely** (a modified client or replayed payload) — a reasonable person expects a clear rejection, never an `unhandled TypeError`/`NaN` propagating into the response. Covered in Tasks 2 and 3.
- **Requesting a station tier that has no real recipe variant for the chosen item** (e.g. `small` for Plastanium, `large` for any Chemical Refinery item) — a reasonable person expects an explicit "no recipe variant at this tier, available tiers: X, Y" message, never a silent fallback to a different tier's numbers. Covered in Task 2.
- **An `on-hand-N` value that is real, resolves via autocomplete, but names a node genuinely outside the *selected* item's own recipe tree** (e.g. crediting Copper Ore against a Duraluminum request) — a reasonable person expects a clear rejection naming the mismatch, never the credit being silently applied to nothing or silently ignored. Covered in Task 7.

---

## Task 1: Recipe Data Module

**Files:**
- Create: `src/craftingData.js`
- Test: `test/craftingData.test.js`

**Interfaces:**
- Produces: `CRAFTING_RECIPES` (a frozen object, keyed by item key, each entry `{ displayName, tier, outputPerCraft, variants: { [tierKey]: { station, craftTimeSeconds, inputs: [{ resource, quantity, craftable }] } }, source: { url, verifiedAt } }`), `LEAF_RESOURCES` (a frozen object mapping leaf resource key → display name), `TIER_KEYS` (`["small", "medium", "large"]`, exported for reuse by the Discord option's choice list and by tests).

- [ ] **Step 1: Write the failing data-integrity tests**

```js
// test/craftingData.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { CRAFTING_RECIPES, LEAF_RESOURCES, TIER_KEYS } from "../src/craftingData.js";

const ITEM_KEYS = Object.keys(CRAFTING_RECIPES);

test("CRAFTING_RECIPES has exactly 15 items", () => {
  assert.equal(ITEM_KEYS.length, 15);
});

test("every recipe variant has a source.url and source.verifiedAt", () => {
  for (const key of ITEM_KEYS) {
    const recipe = CRAFTING_RECIPES[key];
    assert.ok(recipe.source?.url, `${key} missing source.url`);
    assert.ok(recipe.source?.verifiedAt, `${key} missing source.verifiedAt`);
  }
});

test("every variant key is one of small/medium/large, matching the verified per-item tier availability", () => {
  const expectedTiers = {
    copper_ingot: ["small", "medium", "large"],
    iron_ingot: ["small", "medium", "large"],
    steel_ingot: ["small", "medium", "large"],
    aluminum_ingot: ["medium", "large"],
    duraluminum_ingot: ["medium", "large"],
    plastanium_ingot: ["medium", "large"],
    stravidium_fiber: ["medium"],
    cobalt_paste: ["small", "medium"],
    silicone_block: ["small", "medium"],
    small_fuel_cell: ["small", "medium"],
    medium_fuel_cell: ["small", "medium"],
    large_fuel_cell: ["medium"],
    spice_fuel_cell: ["medium"],
    low_grade_lubricant: ["small", "medium"],
    industrial_lubricant: ["small", "medium"]
  };
  for (const key of ITEM_KEYS) {
    const actualTiers = Object.keys(CRAFTING_RECIPES[key].variants).sort();
    const expected = [...expectedTiers[key]].sort();
    assert.deepEqual(actualTiers, expected, `${key} has tiers [${actualTiers}], expected [${expected}]`);
    for (const tierKey of actualTiers) {
      assert.ok(TIER_KEYS.includes(tierKey), `${key}'s tier key "${tierKey}" is not one of ${TIER_KEYS}`);
    }
  }
});

test("no recipe input has a zero or negative quantity", () => {
  for (const key of ITEM_KEYS) {
    for (const [tierKey, variant] of Object.entries(CRAFTING_RECIPES[key].variants)) {
      for (const input of variant.inputs) {
        assert.ok(input.quantity > 0, `${key}.${tierKey}'s input "${input.resource}" has quantity ${input.quantity}`);
      }
    }
  }
});

test("every input resolves to either a known leaf resource or another known recipe key -- no dangling references", () => {
  const leafKeys = new Set(Object.keys(LEAF_RESOURCES));
  for (const key of ITEM_KEYS) {
    for (const [tierKey, variant] of Object.entries(CRAFTING_RECIPES[key].variants)) {
      for (const input of variant.inputs) {
        const resolvesAsLeaf = leafKeys.has(input.resource);
        const resolvesAsRecipe = ITEM_KEYS.includes(input.resource);
        assert.ok(resolvesAsLeaf || resolvesAsRecipe, `${key}.${tierKey}'s input "${input.resource}" resolves to neither a leaf resource nor a known recipe`);
        assert.equal(input.craftable, resolvesAsRecipe, `${key}.${tierKey}'s input "${input.resource}" has craftable=${input.craftable} but resolvesAsRecipe=${resolvesAsRecipe}`);
      }
    }
  }
});

test("no recipe recurses in a cycle", () => {
  function hasCycle(itemKey, visiting = new Set()) {
    if (visiting.has(itemKey)) return true;
    const recipe = CRAFTING_RECIPES[itemKey];
    if (!recipe) return false; // leaf resource, not a cycle
    visiting.add(itemKey);
    for (const variant of Object.values(recipe.variants)) {
      for (const input of variant.inputs) {
        if (input.craftable && hasCycle(input.resource, visiting)) return true;
      }
    }
    visiting.delete(itemKey);
    return false;
  }
  for (const key of ITEM_KEYS) {
    assert.equal(hasCycle(key), false, `${key} participates in a cycle`);
  }
});

test("the 5 known chained items nest exactly as documented", () => {
  const chained = {
    steel_ingot: "iron_ingot",
    duraluminum_ingot: "aluminum_ingot",
    plastanium_ingot: "stravidium_fiber",
    low_grade_lubricant: "silicone_block",
    industrial_lubricant: "silicone_block"
  };
  for (const [parent, child] of Object.entries(chained)) {
    const hasNestedInput = Object.values(CRAFTING_RECIPES[parent].variants)
      .every((variant) => variant.inputs.some((i) => i.craftable && i.resource === child));
    assert.ok(hasNestedInput, `${parent} does not nest ${child} in every variant`);
  }
});

test("outputPerCraft matches the 3 known multi-output items, 1 for everything else", () => {
  const multiOutput = { spice_fuel_cell: 10, low_grade_lubricant: 5, industrial_lubricant: 10 };
  for (const key of ITEM_KEYS) {
    const expected = multiOutput[key] ?? 1;
    assert.equal(CRAFTING_RECIPES[key].outputPerCraft, expected, `${key} has outputPerCraft ${CRAFTING_RECIPES[key].outputPerCraft}, expected ${expected}`);
  }
});

test("CRAFTING_RECIPES is frozen (cannot be mutated at runtime)", () => {
  assert.throws(() => { CRAFTING_RECIPES.copper_ingot.tier = 999; }, TypeError);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/craftingData.test.js`
Expected: FAIL with `Cannot find module '../src/craftingData.js'`

- [ ] **Step 3: Write `src/craftingData.js`**

Transcribe exactly from `docs/calculator-implementation-prompt.md`'s Recipe Data table (verified 2026-07-24 against https://dune.gaming.tools). Use `verifiedAt: "2026-07-24"` for every variant.

```js
// src/craftingData.js
//
// Recipe data and calculation formula derived from published Dune
// Awakening game mechanics; verified against
// https://dune.gaming.tools/crafting-calculator (fan reference site, not
// affiliated with Funcom/Legendary). See docs/calculator-grc.md for the
// full data-provenance and drift-risk disclosure this comment satisfies.
//
// Every recipe VARIANT (not just item) carries its own source/verifiedAt
// pair -- see docs/calculator-security-review.md FINDING-CALC-3. Recipe
// ratios drift with game balance patches; this data is "trust but verify",
// not authoritative -- see docs/calculator-grc.md's Data-Drift Risk
// section for the required re-verification discipline before ever editing
// a value here.

export const TIER_KEYS = Object.freeze(["small", "medium", "large"]);

export const LEAF_RESOURCES = Object.freeze({
  water: "Water",
  copper_ore: "Copper Ore",
  iron_ore: "Iron Ore",
  carbon_ore: "Carbon Ore",
  aluminum_ore: "Aluminum Ore",
  titanium_ore: "Titanium Ore",
  jasmium_crystal: "Jasmium Crystal",
  stravidium_mass: "Stravidium Mass",
  erythrite_crystal: "Erythrite Crystal",
  flour_sand: "Flour Sand",
  spice_residue: "Spice Residue",
  irradiated_slag: "Irradiated Slag",
  fuel_cell: "Fuel Cell"
});

const SOURCE_DATE = "2026-07-24";

export const CRAFTING_RECIPES = Object.freeze({
  copper_ingot: Object.freeze({
    displayName: "Copper Ingot",
    tier: 1,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 3, inputs: Object.freeze([
        Object.freeze({ resource: "copper_ore", quantity: 2, craftable: false })
      ]) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 4, inputs: Object.freeze([
        Object.freeze({ resource: "copper_ore", quantity: 3, craftable: false })
      ]) }),
      small: Object.freeze({ station: "Small Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "copper_ore", quantity: 4, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/copperbar", verifiedAt: SOURCE_DATE })
  }),

  iron_ingot: Object.freeze({
    displayName: "Iron Ingot",
    tier: 2,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 25, craftable: false }),
        Object.freeze({ resource: "iron_ore", quantity: 3, craftable: false })
      ]) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 7, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 25, craftable: false }),
        Object.freeze({ resource: "iron_ore", quantity: 4, craftable: false })
      ]) }),
      small: Object.freeze({ station: "Small Ore Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 25, craftable: false }),
        Object.freeze({ resource: "iron_ore", quantity: 5, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/ironbar", verifiedAt: SOURCE_DATE })
  }),

  steel_ingot: Object.freeze({
    displayName: "Steel Ingot",
    tier: 3,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 3, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "carbon_ore", quantity: 2, craftable: false }),
        Object.freeze({ resource: "iron_ingot", quantity: 1, craftable: true })
      ]) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 4, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "carbon_ore", quantity: 3, craftable: false }),
        Object.freeze({ resource: "iron_ingot", quantity: 1, craftable: true })
      ]) }),
      small: Object.freeze({ station: "Small Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "carbon_ore", quantity: 4, craftable: false }),
        Object.freeze({ resource: "iron_ingot", quantity: 1, craftable: true })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/steelbar", verifiedAt: SOURCE_DATE })
  }),

  aluminum_ingot: Object.freeze({
    displayName: "Aluminum Ingot",
    tier: 4,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 200, craftable: false }),
        Object.freeze({ resource: "aluminum_ore", quantity: 4, craftable: false })
      ]) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 200, craftable: false }),
        Object.freeze({ resource: "aluminum_ore", quantity: 7, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/aluminiumbar", verifiedAt: SOURCE_DATE })
  }),

  duraluminum_ingot: Object.freeze({
    displayName: "Duraluminum Ingot",
    tier: 5,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 4, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 500, craftable: false }),
        Object.freeze({ resource: "jasmium_crystal", quantity: 3, craftable: false }),
        Object.freeze({ resource: "aluminum_ingot", quantity: 1, craftable: true })
      ]) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 500, craftable: false }),
        Object.freeze({ resource: "jasmium_crystal", quantity: 4, craftable: false }),
        Object.freeze({ resource: "aluminum_ingot", quantity: 1, craftable: true })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/duraluminumrod", verifiedAt: SOURCE_DATE })
  }),

  plastanium_ingot: Object.freeze({
    displayName: "Plastanium Ingot",
    tier: 6,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 1250, craftable: false }),
        Object.freeze({ resource: "titanium_ore", quantity: 4, craftable: false }),
        Object.freeze({ resource: "stravidium_fiber", quantity: 1, craftable: true })
      ]) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 1250, craftable: false }),
        Object.freeze({ resource: "titanium_ore", quantity: 6, craftable: false }),
        Object.freeze({ resource: "stravidium_fiber", quantity: 1, craftable: true })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/t6refinedresourcea", verifiedAt: SOURCE_DATE })
  }),

  stravidium_fiber: Object.freeze({
    displayName: "Stravidium Fiber",
    tier: 6,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 100, craftable: false }),
        Object.freeze({ resource: "stravidium_mass", quantity: 3, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/t6refinedresourceb", verifiedAt: SOURCE_DATE })
  }),

  cobalt_paste: Object.freeze({
    displayName: "Cobalt Paste",
    tier: 3,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 75, craftable: false }),
        Object.freeze({ resource: "erythrite_crystal", quantity: 2, craftable: false })
      ]) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 75, craftable: false }),
        Object.freeze({ resource: "erythrite_crystal", quantity: 3, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/cobaltbar", verifiedAt: SOURCE_DATE })
  }),

  silicone_block: Object.freeze({
    displayName: "Silicone Block",
    tier: 2,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "flour_sand", quantity: 3, craftable: false })
      ]) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "flour_sand", quantity: 5, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/silicone", verifiedAt: SOURCE_DATE })
  }),

  small_fuel_cell: Object.freeze({
    displayName: "Small Vehicle Fuel Cell",
    tier: 1,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "fuel_cell", quantity: 20, craftable: false })
      ]) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "fuel_cell", quantity: 25, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/fuelcanister", verifiedAt: SOURCE_DATE })
  }),

  medium_fuel_cell: Object.freeze({
    displayName: "Medium Vehicle Fuel Cell",
    tier: 3,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 40, craftable: false })
      ]) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 45, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/fuelcanister_medium", verifiedAt: SOURCE_DATE })
  }),

  large_fuel_cell: Object.freeze({
    displayName: "Large Vehicle Fuel Cell",
    tier: 4,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 30, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 80, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/fuelcanister_large", verifiedAt: SOURCE_DATE })
  }),

  spice_fuel_cell: Object.freeze({
    displayName: "Spice-infused Fuel Cell",
    tier: 6,
    outputPerCraft: 10,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 200, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 30, craftable: false }),
        Object.freeze({ resource: "spice_residue", quantity: 48, craftable: false }),
        Object.freeze({ resource: "irradiated_slag", quantity: 2, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/spicedfuelcell", verifiedAt: SOURCE_DATE })
  }),

  low_grade_lubricant: Object.freeze({
    displayName: "Low-grade Lubricant",
    tier: 3,
    outputPerCraft: 5,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 4, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 1, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 1, craftable: true })
      ]) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 4, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 2, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 1, craftable: true })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/windturbinelubricant1", verifiedAt: SOURCE_DATE })
  }),

  industrial_lubricant: Object.freeze({
    displayName: "Industrial-grade Lubricant",
    tier: 5,
    outputPerCraft: 10,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 6, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 4, craftable: true }),
        Object.freeze({ resource: "spice_residue", quantity: 5, craftable: false })
      ]) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 40, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 8, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 4, craftable: true }),
        Object.freeze({ resource: "spice_residue", quantity: 5, craftable: false })
      ]) })
    }),
    source: Object.freeze({ url: "https://dune.gaming.tools/items/windturbinelubricant2", verifiedAt: SOURCE_DATE })
  })
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/craftingData.test.js`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/craftingData.js test/craftingData.test.js
git commit -m "feat(calculator): add verified 15-item recipe data table"
```

---

## Task 2: `calculateCraftingPlan()`

**Files:**
- Create: `src/craftingCalculator.js`
- Test: `test/craftingCalculator.test.js`

**Interfaces:**
- Consumes: `CRAFTING_RECIPES`, `LEAF_RESOURCES` from `src/craftingData.js` (Task 1).
- Produces: `calculateCraftingPlan(itemKey, quantity, { stationTier = "large", craftingContract = false } = {})` → `{ itemKey, quantity, stationTier, craftingContract, station, craftTimeSeconds, crafts, leftover, directInputs: [{ resource, quantity, craftable }], nestedCrafts: { [resource]: { crafts, station, craftTimeSeconds, inputs: [{ resource, quantity, craftable }] } }, totalRawMaterials: [{ resource, quantity }], totalTimeSeconds }`. Throws `Error` (message is the exact user-facing text) for: unknown `itemKey`, `quantity` outside `[1, 100000]` or non-integer, no variant at `stationTier` for `itemKey`, a circular dependency (defensive — no cycle exists in today's data, but the guard must be real and tested via a synthetic fixture).
- Produces (for Task 3/7 reuse): `MAX_QUANTITY = 100000`, `MIN_QUANTITY = 1` exported constants so `commands.js` and `applyOnHandCredit()` never hardcode the bound twice.

- [ ] **Step 1: Write the failing tests**

```js
// test/craftingCalculator.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCraftingPlan, MIN_QUANTITY, MAX_QUANTITY } from "../src/craftingCalculator.js";

function totalOf(plan, resource) {
  return plan.totalRawMaterials.find((r) => r.resource === resource)?.quantity ?? 0;
}

test("non-nested recipe: Copper Ingot x5, large tier -- flat multiplication", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  assert.equal(plan.crafts, 5);
  assert.equal(totalOf(plan, "copper_ore"), 10);
  assert.equal(plan.leftover, 0);
});

test("nested recipe: Plastanium Ingot x25, large tier, no contract -- matches the verified worked example exactly", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large", craftingContract: false });
  assert.equal(plan.crafts, 25);
  assert.equal(totalOf(plan, "water"), 33750);
  assert.equal(totalOf(plan, "titanium_ore"), 100);
  assert.equal(totalOf(plan, "stravidium_mass"), 75);
  assert.equal(plan.totalTimeSeconds, 25 * 20 + 25 * 10);
  assert.ok(plan.nestedCrafts.stravidium_fiber, "must report the nested Stravidium Fiber craft");
  assert.equal(plan.nestedCrafts.stravidium_fiber.crafts, 25);
});

test("same recipe with craftingContract:true matches the verified worked example exactly -- ceiling rounding per ingredient per craft", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large", craftingContract: true });
  // Direct: water ceil(1250*0.75)=938 * 25 = 23450; nested: water ceil(100*0.75)=75 * 25 = 1875
  assert.equal(totalOf(plan, "water"), 23450 + 1875);
  assert.equal(totalOf(plan, "titanium_ore"), 3 * 25); // ceil(4*0.75)=3
  // Stravidium Mass unaffected by rounding: ceil(3*0.75)=ceil(2.25)=3, unchanged from the no-contract case
  assert.equal(totalOf(plan, "stravidium_mass"), 3 * 25);
});

test("multi-output recipe: Low-grade Lubricant x12 (output x5/craft) -- crafts=3, totalOut=15, leftover=3", () => {
  const plan = calculateCraftingPlan("low_grade_lubricant", 12, { stationTier: "medium" });
  assert.equal(plan.crafts, 3);
  assert.equal(plan.crafts * 5, 15);
  assert.equal(plan.leftover, 3);
});

test("quantity boundary: exactly 1 and exactly 100000 succeed", () => {
  assert.doesNotThrow(() => calculateCraftingPlan("copper_ingot", MIN_QUANTITY, { stationTier: "large" }));
  assert.doesNotThrow(() => calculateCraftingPlan("copper_ingot", MAX_QUANTITY, { stationTier: "large" }));
});

test("quantity boundary: 0, negative, over-max, non-integer, non-numeric all reject with a typed error", () => {
  for (const bad of [0, -1, MAX_QUANTITY + 1, 1.5, NaN, "25", null, undefined]) {
    assert.throws(() => calculateCraftingPlan("copper_ingot", bad, { stationTier: "large" }), Error, `quantity=${bad} should throw`);
  }
});

test("unknown item key rejects with a typed, catchable error", () => {
  assert.throws(() => calculateCraftingPlan("not_a_real_item", 5, {}), /Unknown item/);
});

test("station-tier with no known variant for the item returns an explicit error, never a silent fallback", () => {
  assert.throws(() => calculateCraftingPlan("plastanium_ingot", 5, { stationTier: "small" }), /no recipe variant at this tier/i);
  assert.throws(() => calculateCraftingPlan("stravidium_fiber", 5, { stationTier: "large" }), /no recipe variant at this tier/i);
});

test("a synthetic circular-dependency fixture throws rather than hanging or stack-overflowing", () => {
  // Constructed only within this test -- never added to real craftingData.js.
  // walkRecipeTree() takes `recipes` as its last parameter (defaulting to
  // the real CRAFTING_RECIPES for every production call site -- see Step 3),
  // specifically so this cycle guard is testable without needing the real,
  // deliberately-acyclic production data to contain a cycle.
  const cyclicRecipes = {
    item_a: { displayName: "A", outputPerCraft: 1, variants: { large: { station: "Test", craftTimeSeconds: 1, inputs: [{ resource: "item_b", quantity: 1, craftable: true }] } } },
    item_b: { displayName: "B", outputPerCraft: 1, variants: { large: { station: "Test", craftTimeSeconds: 1, inputs: [{ resource: "item_a", quantity: 1, craftable: true }] } } }
  };
  assert.throws(() => walkRecipeTree("item_a", 5, "large", false, cyclicRecipes), /circular/i);
});
```

Import `walkRecipeTree` alongside the other named imports at the top of `test/craftingCalculator.test.js`: `import { calculateCraftingPlan, walkRecipeTree, MIN_QUANTITY, MAX_QUANTITY } from "../src/craftingCalculator.js";`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/craftingCalculator.test.js`
Expected: FAIL with `Cannot find module '../src/craftingCalculator.js'`

- [ ] **Step 3: Write `src/craftingCalculator.js` (this task's portion)**

```js
// src/craftingCalculator.js
//
// Pure traversal/rounding/modifier logic -- zero Discord.js, zero network,
// zero database. This is a direct, cited port of dune.gaming.tools' own
// verified algorithm (see docs/calculator-architecture.md's Verified
// Reference Algorithm section for the decompiled source and citation) --
// do not re-derive the rounding/modifier rules independently.

import { CRAFTING_RECIPES, LEAF_RESOURCES } from "./craftingData.js";

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 100000;

function validateQuantity(value, { min, max, label }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max} (got "${value}").`);
  }
  return value;
}

function costFactor(craftingContractActive) {
  return craftingContractActive ? 0.75 : 1;
}

function ingredientPerCraft(rawQuantity, craftingContractActive) {
  return Math.ceil(rawQuantity * costFactor(craftingContractActive));
}

function craftsNeeded(requiredQuantity, outputPerCraft) {
  return Math.ceil(requiredQuantity / outputPerCraft);
}

// Exported for direct unit testing of the cycle guard against a synthetic
// recipe graph (see test/craftingCalculator.test.js) without needing to
// mutate the real, frozen CRAFTING_RECIPES. `recipes` defaults to the real
// data for every production call site.
export function walkRecipeTree(itemKey, quantity, stationTier, craftingContract, recipes = CRAFTING_RECIPES, visiting = new Set()) {
  if (visiting.has(itemKey)) {
    throw new Error(`Circular recipe dependency detected involving "${itemKey}".`);
  }
  const recipe = recipes[itemKey];
  if (!recipe) {
    throw new Error(`Unknown item: "${itemKey}".`);
  }
  const variant = recipe.variants[stationTier];
  if (!variant) {
    const available = Object.keys(recipe.variants).join(", ");
    throw new Error(`${recipe.displayName} has no recipe variant at the "${stationTier}" tier -- available tiers: ${available}.`);
  }

  const crafts = craftsNeeded(quantity, recipe.outputPerCraft);
  const leftover = crafts * recipe.outputPerCraft - quantity;

  const directInputs = variant.inputs.map((input) => ({
    resource: input.resource,
    quantity: ingredientPerCraft(input.quantity, craftingContract) * crafts,
    craftable: input.craftable
  }));

  const nestedCrafts = {};
  const nextVisiting = new Set(visiting).add(itemKey);
  for (const input of directInputs) {
    if (!input.craftable) continue;
    const nested = walkRecipeTree(input.resource, input.quantity, stationTier, craftingContract, recipes, nextVisiting);
    nestedCrafts[input.resource] = nested;
    // Merge the nested plan's own nestedCrafts up (supports depth > 1,
    // even though today's data is depth-1 only -- see the architecture
    // doc's Dependency Graph note on not hardcoding a depth limit).
    Object.assign(nestedCrafts, nested.nestedCrafts);
  }

  // Pool every resource across this level and every nested level into one
  // total per distinct resource -- see the design doc's Step 2 pooling
  // requirement. A resource is "raw" here if it's not itself a key in
  // nestedCrafts (i.e. it wasn't further crafted at this level).
  const pooledTotals = new Map();
  const addToPool = (resource, quantity) => {
    pooledTotals.set(resource, (pooledTotals.get(resource) || 0) + quantity);
  };
  for (const input of directInputs) {
    if (input.craftable) continue; // raw leaf under THIS item, pool it
    addToPool(input.resource, input.quantity);
  }
  for (const nested of Object.values(nestedCrafts)) {
    for (const input of nested.directInputs) {
      if (input.craftable) continue;
      addToPool(input.resource, input.quantity);
    }
  }

  const totalTimeSeconds = crafts * variant.craftTimeSeconds
    + Object.values(nestedCrafts).reduce((sum, n) => sum + n.crafts * n.variantCraftTimeSeconds, 0);

  return {
    itemKey,
    quantity,
    stationTier,
    craftingContract,
    station: variant.station,
    craftTimeSeconds: variant.craftTimeSeconds,
    variantCraftTimeSeconds: variant.craftTimeSeconds, // used by the parent's totalTimeSeconds reduce above
    crafts,
    leftover,
    directInputs,
    nestedCrafts,
    totalRawMaterials: [...pooledTotals.entries()].map(([resource, quantity]) => ({ resource, quantity })),
    totalTimeSeconds
  };
}

export function calculateCraftingPlan(itemKey, quantity, { stationTier = "large", craftingContract = false } = {}) {
  validateQuantity(quantity, { min: MIN_QUANTITY, max: MAX_QUANTITY, label: "quantity" });
  return walkRecipeTree(itemKey, quantity, stationTier, craftingContract);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/craftingCalculator.test.js`
Expected: PASS for every test except the placeholder cycle-guard test — replace that test's body with the real `walkRecipeTree`-against-synthetic-data version described in Step 1's note, then re-run until all pass.

- [ ] **Step 5: Commit**

```bash
git add src/craftingCalculator.js test/craftingCalculator.test.js
git commit -m "feat(calculator): calculateCraftingPlan with verified ceiling-rounding/pooling/cycle-guard"
```

---

## Task 3: `applyOnHandCredit()`

**Files:**
- Modify: `src/craftingCalculator.js` (add export, same file per the architecture doc's "no new files beyond the original two" note)
- Modify: `test/craftingCalculator.test.js` (append)

**Interfaces:**
- Consumes: `calculateCraftingPlan()`'s return shape (Task 2), `MIN_QUANTITY`/`MAX_QUANTITY` (Task 2), `CRAFTING_RECIPES`/`LEAF_RESOURCES` (Task 1).
- Produces: `applyOnHandCredit(plan, onHandEntries, { quantity, targetItemOnHand = 0 } = {})` → `{ ...plan, quantity, effectiveQuantity: plan.quantity, shortfall: Map<resource, number>, maxCompletable: { units, limitingNode } | undefined }`. `onHandEntries` is `[{ node, quantity }]` — ingredient-level only, the target-item-itself entry (if any) must already be resolved into `effectiveQuantity`/`targetItemOnHand` by the caller (`commands.js`, Task 7's Step A) before this function is ever called. Throws `Error` for: any `onHandEntries[].quantity` outside `[0, 100000]` or non-integer (re-validated here independently — finding S-1), any `onHandEntries[].node` not present anywhere in `plan`'s tree (target item, any nested craftable, or any leaf).

- [ ] **Step 1: Write the failing tests**

```js
// append to test/craftingCalculator.test.js
import { calculateCraftingPlan, applyOnHandCredit, MAX_QUANTITY } from "../src/craftingCalculator.js";

test("applyOnHandCredit: crediting a flat ingredient directly -- subtraction only, no cascade", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 40 }], { quantity: 25 });
  assert.equal(credited.shortfall.get("titanium_ore"), 100 - 40);
  assert.equal(credited.maxCompletable.units, 10, "40 titanium ore / 4 per craft = 10 completable");
  assert.equal(credited.maxCompletable.limitingNode, "titanium_ore");
});

test("applyOnHandCredit: crediting the intermediate craftable itself -- cascades down", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "stravidium_fiber", quantity: 8 }], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 8, "8 stravidium fiber on hand -> 8 plastanium completable (1:1 ratio)");
  assert.equal(credited.maxCompletable.limitingNode, "stravidium_fiber");
});

test("applyOnHandCredit: crediting a leaf resource underneath the intermediate -- no cascade upward, pooled subtraction only (worked example)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "stravidium_mass", quantity: 60 }], { quantity: 25 });
  assert.equal(credited.shortfall.get("stravidium_mass"), 75 - 60);
  assert.equal(credited.maxCompletable.units, 20, "60 stravidium mass / 3 per plastanium = 20 completable");
  assert.equal(credited.maxCompletable.limitingNode, "stravidium_mass");
});

test("applyOnHandCredit: chain-aware max completable, intermediate as the limiting node over a much larger raw-ingredient supply (worked example)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [
    { node: "stravidium_fiber", quantity: 8 },
    { node: "titanium_ore", quantity: 2000 }
  ], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 8);
  assert.equal(credited.maxCompletable.limitingNode, "stravidium_fiber");
});

test("applyOnHandCredit: target-item-itself credit combined with insufficient ingredient supply", () => {
  // 5 of 25 already done (resolved by the caller into effectiveQuantity=20
  // and targetItemOnHand=5 BEFORE calculateCraftingPlan/applyOnHandCredit
  // are ever called -- this test exercises applyOnHandCredit's own
  // combination formula directly).
  const plan = calculateCraftingPlan("plastanium_ingot", 20, { stationTier: "large" }); // effectiveQuantity
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 40 }], { quantity: 25, targetItemOnHand: 5 });
  // supply-constrained: 40/4 = 10; maxCompletable = min(25, 5 + 10) = 15
  assert.equal(credited.maxCompletable.units, 15);
  assert.equal(credited.effectiveQuantity, 20);
});

test("applyOnHandCredit: on-hand quantity bound re-validated independently (finding S-1)", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  for (const bad of [-1, MAX_QUANTITY + 1, 1.5, NaN]) {
    assert.throws(() => applyOnHandCredit(plan, [{ node: "copper_ore", quantity: bad }], { quantity: 5 }), Error);
  }
});

test("applyOnHandCredit: a node not in the plan's tree rejects with a clear error", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  assert.throws(() => applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 5 }], { quantity: 5 }), /not an ingredient/i);
});

test("applyOnHandCredit: a node key of '__proto__' is rejected as unknown, never resolved against Object.prototype (finding S-2)", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  assert.throws(() => applyOnHandCredit(plan, [{ node: "__proto__", quantity: 5 }], { quantity: 5 }), /not an ingredient/i);
  assert.equal(Object.prototype.polluted, undefined, "must never actually pollute Object.prototype");
});

test("applyOnHandCredit: no on-hand values at all -- maxCompletable is undefined, not a computed 0", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [], { quantity: 5 });
  assert.equal(credited.maxCompletable, undefined);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/craftingCalculator.test.js`
Expected: FAIL — `applyOnHandCredit is not a function` (or not exported).

- [ ] **Step 3: Add `applyOnHandCredit()` to `src/craftingCalculator.js`**

```js
// append to src/craftingCalculator.js

// Every node-keyed structure below is a Map, never a plain object -- see
// docs/calculator-architecture.md's Shortfall Traversal Design citation
// for the prototype-pollution class this specifically prevents (finding
// S-2). A free-typed on-hand-N value that bypassed Discord's autocomplete
// could otherwise carry "__proto__"/"constructor"/"prototype" and resolve
// against real inherited properties instead of undefined.
function flattenPlanNodes(plan) {
  // Returns a Map<nodeKey, { pooledQuantity, isIntermediate, ratio }>
  // covering the target item itself, every intermediate craftable, and
  // every raw leaf -- everything an on-hand-N value could legally name.
  const nodes = new Map();
  nodes.set(plan.itemKey, { pooledQuantity: plan.quantity, isIntermediate: false, isTarget: true });
  for (const [resource, nested] of Object.entries(plan.nestedCrafts)) {
    nodes.set(resource, { pooledQuantity: nested.quantity, isIntermediate: true, ratio: nested.quantity / plan.quantity });
  }
  for (const entry of plan.totalRawMaterials) {
    nodes.set(entry.resource, { pooledQuantity: entry.quantity, isIntermediate: false, ratio: entry.quantity / plan.quantity });
  }
  return nodes;
}

export function applyOnHandCredit(plan, onHandEntries = [], { quantity, targetItemOnHand = 0 } = {}) {
  // [SECURITY, finding S-1] Re-validate every on-hand quantity here,
  // independently of whatever the Discord option or the caller already
  // checked -- same reasoning as calculateCraftingPlan()'s own quantity
  // re-validation.
  for (const entry of onHandEntries) {
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > MAX_QUANTITY) {
      throw new Error(`On-hand quantity for "${entry.node}" must be a whole number between 0 and ${MAX_QUANTITY} (got "${entry.quantity}").`);
    }
  }

  const nodeMap = flattenPlanNodes(plan); // Map, per finding S-2
  const shortfall = new Map();
  for (const [key, info] of nodeMap.entries()) {
    if (key === plan.itemKey) continue; // target item's own shortfall isn't tracked here -- see effectiveQuantity
    shortfall.set(key, info.pooledQuantity);
  }

  let supplyConstrainedUnits = Infinity;
  let limitingNode;

  for (const entry of onHandEntries) {
    const info = nodeMap.get(entry.node); // Map.get -- never `nodeMap[entry.node]`
    if (!info || entry.node === plan.itemKey) {
      throw new Error(`"${entry.node}" is not an ingredient of ${plan.itemKey}.`);
    }

    const currentShortfall = shortfall.get(entry.node) ?? 0;
    const newShortfall = Math.max(0, currentShortfall - entry.quantity);
    shortfall.set(entry.node, newShortfall);

    if (info.isIntermediate) {
      // Cascade: this dataset's every nested item has outputPerCraft baked
      // into `nested.crafts` already, so scaling each of the nested item's
      // own raw inputs proportionally to the shortfall reduction (rather
      // than recomputing a separate reducedCrafts count) is simpler and
      // exactly equivalent -- then re-pool the scaled amounts.
      const nested = plan.nestedCrafts[entry.node];
      const creditRatio = currentShortfall === 0 ? 0 : (currentShortfall - newShortfall) / currentShortfall;
      for (const input of nested.directInputs) {
        if (input.craftable) continue;
        const reduction = Math.round(input.quantity * creditRatio);
        shortfall.set(input.resource, Math.max(0, (shortfall.get(input.resource) ?? 0) - reduction));
      }
    }

    // Supply-constrained maxCompletable: on-hand quantity / per-target-unit ratio.
    const ratio = info.ratio ?? 1;
    const supportedUnits = Math.floor(entry.quantity / ratio);
    if (supportedUnits < supplyConstrainedUnits) {
      supplyConstrainedUnits = supportedUnits;
      limitingNode = entry.node;
    }
  }

  let maxCompletable;
  if (targetItemOnHand > 0 || onHandEntries.length > 0) {
    const combined = onHandEntries.length > 0
      ? targetItemOnHand + supplyConstrainedUnits
      : targetItemOnHand;
    maxCompletable = {
      units: Math.min(quantity, combined),
      limitingNode: onHandEntries.length > 0 ? limitingNode : undefined
    };
  }

  return {
    ...plan,
    quantity,
    effectiveQuantity: plan.quantity,
    shortfall,
    maxCompletable
  };
}
```

**Implementation note:** the cascade math above (`creditRatio`) is one valid way to satisfy the architecture doc's requirement that crediting an intermediate craftable proportionally reduces its own nested ingredients. Before considering this step done, verify your implementation reproduces the exact worked-example numbers in the tests above — if it doesn't, fix the implementation, per this plan's Global Constraints and the implementation prompt's own instruction not to adjust expected numbers to match a different implementation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/craftingCalculator.test.js`
Expected: PASS, all tests from Tasks 2 and 3.

- [ ] **Step 5: Commit**

```bash
git add src/craftingCalculator.js test/craftingCalculator.test.js
git commit -m "feat(calculator): applyOnHandCredit with Map-based lookups, chain-aware max-completable"
```

---

## Task 4: `estimateDuration()`

**Files:**
- Modify: `src/craftingCalculator.js` (append export)
- Modify: `test/craftingCalculator.test.js` (append)

**Interfaces:**
- Consumes: the credited-plan shape from `applyOnHandCredit()` (Task 3) or a plain `calculateCraftingPlan()` result (Task 2) when no on-hand values were supplied.
- Produces: `estimateDuration(plan, { stationCount = 1 } = {})` → `[{ station: "Ore Refinery" | "Chemical Refinery", seconds, craftsRemaining }]`, omitting any station family with zero remaining crafts (never a zero-second line).

- [ ] **Step 1: Write the failing tests**

```js
// append to test/craftingCalculator.test.js
import { estimateDuration } from "../src/craftingCalculator.js";

test("estimateDuration: single-station-type worked example (Copper Ingot x500) -- exactly one line, no phantom Chemical Refinery line", () => {
  const plan = calculateCraftingPlan("copper_ingot", 500, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 1 });
  assert.equal(durations.length, 1);
  assert.equal(durations[0].station, "Ore Refinery");
  assert.equal(durations[0].seconds, 500 * 3);
});

test("estimateDuration: two station families reported independently, never summed (Plastanium worked example)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 1 });
  const ore = durations.find((d) => d.station === "Ore Refinery");
  const chem = durations.find((d) => d.station === "Chemical Refinery");
  assert.equal(ore.seconds, 25 * 20);
  assert.equal(chem.seconds, 25 * 10);
});

test("estimateDuration: stationCount divides crafts, rounding up", () => {
  const plan = calculateCraftingPlan("copper_ingot", 500, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 3 });
  assert.equal(durations[0].seconds, Math.ceil(500 / 3) * 3);
});

test("estimateDuration: a fully-credited plan (zero remaining crafts) reports zero duration lines", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "copper_ore", quantity: 100 }], { quantity: 5 });
  const durations = estimateDuration(credited, { stationCount: 1 });
  assert.equal(durations.length, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/craftingCalculator.test.js`
Expected: FAIL — `estimateDuration is not a function`.

- [ ] **Step 3: Add `estimateDuration()` to `src/craftingCalculator.js`**

```js
// append to src/craftingCalculator.js

const STATION_FAMILY = (stationName) => stationName.includes("Chemical") ? "Chemical Refinery" : "Ore Refinery";

export function estimateDuration(plan, { stationCount = 1 } = {}) {
  const byFamily = new Map(); // family -> { seconds, craftsRemaining }

  const remainingCraftsFor = (nodeKey, fallbackCrafts) => {
    if (!plan.shortfall) return fallbackCrafts; // no on-hand credit applied -- everything is "remaining"
    const remaining = plan.shortfall.get(nodeKey);
    return remaining === undefined ? fallbackCrafts : remaining > 0 ? fallbackCrafts : 0;
  };

  const addFamily = (stationName, crafts, craftTimeSeconds) => {
    if (crafts <= 0) return;
    const family = STATION_FAMILY(stationName);
    const seconds = Math.ceil(crafts / stationCount) * craftTimeSeconds;
    const existing = byFamily.get(family) || { seconds: 0, craftsRemaining: 0 };
    byFamily.set(family, { seconds: existing.seconds + seconds, craftsRemaining: existing.craftsRemaining + crafts });
  };

  const topCrafts = remainingCraftsFor(plan.itemKey, plan.crafts);
  addFamily(plan.station, topCrafts, plan.craftTimeSeconds);

  for (const nested of Object.values(plan.nestedCrafts)) {
    const nestedCrafts = remainingCraftsFor(nested.itemKey, nested.crafts);
    addFamily(nested.station, nestedCrafts, nested.craftTimeSeconds);
  }

  return [...byFamily.entries()].map(([station, { seconds, craftsRemaining }]) => ({ station, seconds, craftsRemaining }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/craftingCalculator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/craftingCalculator.js test/craftingCalculator.test.js
git commit -m "feat(calculator): estimateDuration, per-station-family, omits zero-craft lines"
```

---

## Task 5: `recipeTreeNodes()` (autocomplete data helper)

**Files:**
- Modify: `src/craftingCalculator.js` (append export)
- Modify: `test/craftingCalculator.test.js` (append)

**Interfaces:**
- Consumes: `CRAFTING_RECIPES` (Task 1).
- Produces: `recipeTreeNodes(itemKey)` → `[{ key, displayName }]` covering the target item itself, every direct ingredient, and every nested craftable's own ingredients (deduplicated) — the exact list `on-hand-N` autocomplete is allowed to suggest for a given `item`. Throws for an unknown `itemKey` (mirrors `calculateCraftingPlan`'s own error).

- [ ] **Step 1: Write the failing tests**

```js
// append to test/craftingCalculator.test.js
import { recipeTreeNodes } from "../src/craftingCalculator.js";

test("recipeTreeNodes: Copper Ingot (flat item) returns itself + copper ore only", () => {
  const nodes = recipeTreeNodes("copper_ingot").map((n) => n.key).sort();
  assert.deepEqual(nodes, ["copper_ingot", "copper_ore"].sort());
});

test("recipeTreeNodes: Plastanium Ingot (chained) returns itself, direct ingredients, and the nested craftable's own ingredients", () => {
  const nodes = recipeTreeNodes("plastanium_ingot").map((n) => n.key).sort();
  assert.deepEqual(nodes, ["plastanium_ingot", "water", "titanium_ore", "stravidium_fiber", "stravidium_mass"].sort());
});

test("recipeTreeNodes: Industrial-grade Lubricant, the verified worst case, returns exactly 6 nodes", () => {
  const nodes = recipeTreeNodes("industrial_lubricant");
  assert.equal(nodes.length, 6);
});

test("recipeTreeNodes: unknown item throws", () => {
  assert.throws(() => recipeTreeNodes("not_a_real_item"), /Unknown item/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/craftingCalculator.test.js`
Expected: FAIL — `recipeTreeNodes is not a function`.

- [ ] **Step 3: Add `recipeTreeNodes()` to `src/craftingCalculator.js`**

```js
// append to src/craftingCalculator.js
import { LEAF_RESOURCES } from "./craftingData.js"; // already imported above -- ensure single import line, don't duplicate

export function recipeTreeNodes(itemKey) {
  const recipe = CRAFTING_RECIPES[itemKey];
  if (!recipe) {
    throw new Error(`Unknown item: "${itemKey}".`);
  }
  const seen = new Map();
  seen.set(itemKey, recipe.displayName);
  // Union of every variant's inputs (a node might only appear in one tier's
  // variant, e.g. Jasmium Crystal count differs by tier but the node itself
  // is the same across tiers) -- walk every variant, not just one.
  for (const variant of Object.values(recipe.variants)) {
    for (const input of variant.inputs) {
      const displayName = LEAF_RESOURCES[input.resource] ?? CRAFTING_RECIPES[input.resource]?.displayName ?? input.resource;
      seen.set(input.resource, displayName);
      if (input.craftable) {
        const nestedRecipe = CRAFTING_RECIPES[input.resource];
        for (const nestedVariant of Object.values(nestedRecipe.variants)) {
          for (const nestedInput of nestedVariant.inputs) {
            const nestedDisplayName = LEAF_RESOURCES[nestedInput.resource] ?? CRAFTING_RECIPES[nestedInput.resource]?.displayName ?? nestedInput.resource;
            seen.set(nestedInput.resource, nestedDisplayName);
          }
        }
      }
    }
  }
  return [...seen.entries()].map(([key, displayName]) => ({ key, displayName }));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/craftingCalculator.test.js`
Expected: PASS, full file.

- [ ] **Step 5: Commit**

```bash
git add src/craftingCalculator.js test/craftingCalculator.test.js
git commit -m "feat(calculator): recipeTreeNodes helper for dependent on-hand-N autocomplete"
```

---

## Task 6: `formatCalculatorEmbed()`

**Files:**
- Modify: `src/embedFormat.js` (append)
- Create: `test/embedFormat.calculator.test.js`

**Interfaces:**
- Consumes: the return shape of `applyOnHandCredit()` (Task 3, or a plain `calculateCraftingPlan()` result when no on-hand values were given) plus `estimateDuration()`'s output (Task 4).
- Produces: `formatCalculatorEmbed(plan, durations, { onHandEntries = [] } = {})` → a discord.js embed object via the existing `duneEmbed()` helper.

- [ ] **Step 1: Write the failing tests**

```js
// test/embedFormat.calculator.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCalculatorEmbed } from "../src/embedFormat.js";
import { calculateCraftingPlan, applyOnHandCredit, estimateDuration } from "../src/craftingCalculator.js";

test("formatCalculatorEmbed: plain request (no on-hand) reproduces the v1-style output and includes the discoverability tip", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 1 });
  const embed = formatCalculatorEmbed(plan, durations, { onHandEntries: [] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /33,750|33750/, "must show pooled total water");
  assert.match(text, /Tip/, "plain response must include the discoverability tip");
  assert.doesNotMatch(text, /\(goal\)/, "plain response title must not have the (goal) suffix");
});

test("formatCalculatorEmbed: with on-hand values, title gets (goal) suffix and tip is omitted", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 2000 }], { quantity: 25 });
  const durations = estimateDuration(credited, { stationCount: 1 });
  const embed = formatCalculatorEmbed(credited, durations, { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /\(goal\)/);
  assert.doesNotMatch(text, /Tip/, "a response already using on-hand values must not repeat the discoverability tip");
});

test("formatCalculatorEmbed: max-completable line uses the warning emoji when short of the goal, success emoji when sufficient", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const shortCredit = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 40 }], { quantity: 25 });
  const shortEmbed = formatCalculatorEmbed(shortCredit, estimateDuration(shortCredit, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 40 }] });
  assert.match(JSON.stringify(shortEmbed.data ?? shortEmbed), /⚠️/);

  const sufficientCredit = applyOnHandCredit(plan, [
    { node: "titanium_ore", quantity: 2000 },
    { node: "stravidium_fiber", quantity: 25 }
  ], { quantity: 25 });
  const sufficientEmbed = formatCalculatorEmbed(sufficientCredit, estimateDuration(sufficientCredit, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }, { node: "stravidium_fiber", quantity: 25 }] });
  assert.match(JSON.stringify(sufficientEmbed.data ?? sufficientEmbed), /✅/);
});

test("formatCalculatorEmbed: leftover line shown for multi-output items when leftover > 0", () => {
  const plan = calculateCraftingPlan("low_grade_lubricant", 12, { stationTier: "medium" });
  const embed = formatCalculatorEmbed(plan, estimateDuration(plan, { stationCount: 1 }), { onHandEntries: [] });
  assert.match(JSON.stringify(embed.data ?? embed), /leftover/i);
});

test("formatCalculatorEmbed: crafting-contract footer shown only when active", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large", craftingContract: true });
  const embed = formatCalculatorEmbed(plan, estimateDuration(plan, { stationCount: 1 }), { onHandEntries: [] });
  assert.match(JSON.stringify(embed.data ?? embed), /Crafting Contract active/);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/embedFormat.calculator.test.js`
Expected: FAIL — `formatCalculatorEmbed is not a function`.

- [ ] **Step 3: Add `formatCalculatorEmbed()` to `src/embedFormat.js`**

Append near the other `format*Embed` functions, reusing `duneEmbed()` (already imported/defined in this file) and `LEAF_RESOURCES`/`CRAFTING_RECIPES` display names:

```js
// append to src/embedFormat.js
import { CRAFTING_RECIPES, LEAF_RESOURCES } from "./craftingData.js";

function resourceDisplayName(key) {
  return LEAF_RESOURCES[key] ?? CRAFTING_RECIPES[key]?.displayName ?? key;
}

export function formatCalculatorEmbed(plan, durations, { onHandEntries = [] } = {}) {
  const recipe = CRAFTING_RECIPES[plan.itemKey];
  const hasOnHand = onHandEntries.length > 0;
  const title = `🧮 Crafting Calculator — ${plan.quantity.toLocaleString()}× ${recipe.displayName}${hasOnHand ? " (goal)" : ""}`;

  const lines = [];
  lines.push(`Tier: ${plan.station} · Craft time: ${plan.craftTimeSeconds}s`);
  if (hasOnHand) {
    const onHandSummary = onHandEntries.map((e) => `${e.quantity.toLocaleString()} ${resourceDisplayName(e.node)}`).join(", ");
    lines.push(`On hand: ${onHandSummary}`);
  }

  const resourceRows = (entries) => entries.map(([resource, quantity]) => {
    const onHandEntry = onHandEntries.find((e) => e.node === resource);
    let note = "";
    if (onHandEntry) {
      note = quantity === 0 ? ` (${onHandEntry.quantity.toLocaleString()} on hand — fully covered)` : ` (${onHandEntry.quantity.toLocaleString()} on hand, ${quantity.toLocaleString()} more needed)`;
    }
    return `• ${resourceDisplayName(resource)}${" ".repeat(Math.max(1, 20 - resourceDisplayName(resource).length))}${quantity.toLocaleString()}${note}`;
  }).join("\n");

  if (hasOnHand) {
    lines.push("");
    lines.push("🗒️ **Shortfall (after on-hand credit, pooled across every level)**");
    lines.push(resourceRows([...plan.shortfall.entries()]));
  } else {
    lines.push("");
    lines.push("📦 **Direct Inputs (per this craft)**");
    lines.push(resourceRows(plan.directInputs.map((i) => [i.resource, i.quantity])));
  }

  for (const [nestedKey, nested] of Object.entries(plan.nestedCrafts)) {
    const remainingCrafts = hasOnHand ? (plan.shortfall.get(nestedKey) !== undefined ? Math.ceil(plan.shortfall.get(nestedKey) / (CRAFTING_RECIPES[nestedKey]?.outputPerCraft ?? 1)) : nested.crafts) : nested.crafts;
    if (remainingCrafts <= 0) continue;
    lines.push("");
    lines.push(`🔧 **Nested Craft: ${remainingCrafts}× ${resourceDisplayName(nestedKey)}**`);
    lines.push(`Station: ${nested.station} · Craft time: ${nested.crafts * nested.craftTimeSeconds}s`);
    const uniqueToThisLevel = nested.directInputs.filter((i) => !i.craftable);
    lines.push(resourceRows(uniqueToThisLevel.map((i) => [i.resource, i.quantity])));
  }

  if (!hasOnHand) {
    lines.push("");
    lines.push("🗒️ **Total Raw Materials to Gather**");
    lines.push(resourceRows(plan.totalRawMaterials.map((r) => [r.resource, r.quantity])));
  }

  if (plan.maxCompletable !== undefined) {
    lines.push("");
    if (plan.maxCompletable.units >= plan.quantity) {
      lines.push(`✅ You can complete all ${plan.quantity.toLocaleString()} requested.`);
    } else {
      const limitingName = resourceDisplayName(plan.maxCompletable.limitingNode);
      lines.push(`⚠️ You can complete at most ${plan.maxCompletable.units.toLocaleString()} ${recipe.displayName} with current ${limitingName} on hand — short ${(plan.quantity - plan.maxCompletable.units).toLocaleString()}.`);
    }
  }

  if (plan.leftover > 0) {
    lines.push("");
    lines.push(`+${plan.leftover} leftover (rounded up to whole crafts)`);
  }

  if (durations.length > 0) {
    lines.push("");
    const durationText = durations.map((d) => `${d.station} ${d.seconds.toLocaleString()}s (${Math.floor(d.seconds / 60)}m ${d.seconds % 60}s)`).join(" · ");
    lines.push(`⏱️ Duration: ${durationText}`);
  }

  if (plan.craftingContract) {
    lines.push("");
    lines.push("Crafting Contract active (-25% materials)");
  }

  if (!hasOnHand) {
    lines.push("");
    lines.push("💡 Tip: add on-hand-1 (and up to 5 more) to track a goal against what you already have — see /dune data calculator's own description.");
  }

  return duneEmbed({
    title,
    color: plan.maxCompletable && plan.maxCompletable.units < plan.quantity ? "warning" : "spice",
    description: lines.join("\n").slice(0, 4000)
  });
}
```

**Implementation note:** the exact line-by-line layout above is a reasonable starting point matching the design doc's worked examples in substance (pooled totals, explanatory on-hand notes, tip/goal-suffix rules, emoji-driven max-completable framing) — adjust formatting details as needed to match this file's existing visual conventions (`duneEmbed()`'s own field/description patterns), but do not drop any of the required elements: the `(goal)` suffix rule, the tip-omission rule, the explained-zero rule, the ✅/⚠️ emoji rule, or the leftover line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/embedFormat.calculator.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/embedFormat.js test/embedFormat.calculator.test.js
git commit -m "feat(calculator): formatCalculatorEmbed with shortfall/max-completable/duration rendering"
```

---

## Task 7: Slash Command Wiring (`commands.js`)

**Files:**
- Modify: `src/commands.js`
- Modify: `test/commands.test.js` (append)

**Interfaces:**
- Consumes: `calculateCraftingPlan`, `applyOnHandCredit`, `estimateDuration`, `MIN_QUANTITY`, `MAX_QUANTITY` from `src/craftingCalculator.js`; `CRAFTING_RECIPES` from `src/craftingData.js`; `formatCalculatorEmbed` from `src/embedFormat.js`.
- Produces: the `data:calculator` subcommand definition (in `buildDuneCommand()`), the `data:calculator` dispatch case, and `executeCalculator({ interaction })` — a synchronous handler that reads every option, resolves Step A (target-item on-hand → `effectiveQuantity`), validates duplicate/mismatched on-hand pairs, calls the Task 2/3/4 functions, and returns `{ plan, durations, onHandEntries }` for the formatter-selection chain to pass to `formatCalculatorEmbed()`.

- [ ] **Step 1: Write the failing tests**

```js
// append to test/commands.test.js
import { calculateCraftingPlan } from "../src/craftingCalculator.js"; // sanity import, not required for assertions below

function calculatorOptions(overrides = {}) {
  const values = {
    item: "plastanium_ingot",
    quantity: 25,
    "station-tier": "large",
    "crafting-contract": false,
    ...overrides
  };
  return {
    getSubcommandGroup: () => "data",
    getSubcommand: () => "calculator",
    getString: (name) => (typeof values[name] === "string" ? values[name] : null),
    getInteger: (name) => (typeof values[name] === "number" ? values[name] : null),
    getBoolean: (name) => (typeof values[name] === "boolean" ? values[name] : null)
  };
}

function calculatorInteraction(overrides = {}) {
  const interaction = mockInteraction("data", "calculator", { options: calculatorOptions(overrides), userId: `calc-${Math.random()}` });
  return interaction;
}

test("data:calculator plain request returns an embed with the pooled totals (no adapter call)", async () => {
  const interaction = calculatorInteraction();
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  const handled = await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.equal(handled, true);
  const text = JSON.stringify(edited?.embeds?.[0]);
  assert.match(text, /33,750|33750/);
});

test("data:calculator with on-hand values reports a shortfall, not the plain total", async () => {
  const interaction = calculatorInteraction({
    "on-hand-1": "titanium_ore",
    "on-hand-1-quantity": 2000
  });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  const text = JSON.stringify(edited?.embeds?.[0]);
  assert.match(text, /goal/i);
});

test("data:calculator rejects an unknown item with a plain, non-fabricated error", async () => {
  const interaction = calculatorInteraction({ item: "not_a_real_item" });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.match(edited?.embeds?.[0]?.data?.description || "", /Unknown item/);
});

test("data:calculator rejects two on-hand slots naming the same node", async () => {
  const interaction = calculatorInteraction({
    "on-hand-1": "water", "on-hand-1-quantity": 100,
    "on-hand-2": "water", "on-hand-2-quantity": 50
  });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.match(edited?.embeds?.[0]?.data?.description || "", /both name/i);
});

test("data:calculator rejects an on-hand-N-quantity supplied without a matching on-hand-N", async () => {
  const interaction = calculatorInteraction({ "on-hand-1-quantity": 100 }); // no on-hand-1
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  assert.match(edited?.embeds?.[0]?.data?.description || "", /on-hand-1/);
});

test("data:calculator target-item-itself on-hand value reduces effectiveQuantity (Step A)", async () => {
  const interaction = calculatorInteraction({
    quantity: 25,
    "on-hand-1": "plastanium_ingot",
    "on-hand-1-quantity": 5
  });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  await executeDuneCommand(interaction, {}, { discord: { defaultEphemeral: true, rbac: { mode: "open" } } });
  // effectiveQuantity=20 -> pooled water for 20 plastanium: 20*1250 + 20*100 = 27000
  assert.match(JSON.stringify(edited?.embeds?.[0]), /27,000|27000/);
});

test("buildDuneCommand: data:calculator is registered with all 16 options", () => {
  const built = buildDuneCommand().toJSON();
  const dataGroup = built.options.find((o) => o.name === "data");
  const calculator = dataGroup.options.find((o) => o.name === "calculator");
  assert.ok(calculator, "data:calculator must be registered");
  assert.equal(calculator.options.length, 16);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/commands.test.js`
Expected: FAIL — `data:calculator` not recognized / registered.

- [ ] **Step 3a: Register the command options in `buildDuneCommand()`**

In the `data` subcommand group block (`src/commands.js`, the `.addSubcommandGroup((g) => g.setName("data")...)` block found near line 131), add:

```js
.addSubcommand((c) => {
  c.setName("calculator").setDescription("Calculate crafting requirements — optionally track a goal against what you already have on hand.")
    .addStringOption((o) => o.setName("item").setDescription("Which item are you calculating for?").setRequired(true).setAutocomplete(true))
    .addIntegerOption((o) => o.setName("quantity").setDescription("How many total do you need (your goal)?").setMinValue(1).setMaxValue(100000))
    .addStringOption((o) => o.setName("station-tier").setDescription("Station size (only tiers this item actually has are honored)").addChoices(
      { name: "Large", value: "large" }, { name: "Medium", value: "medium" }, { name: "Small", value: "small" }
    ))
    .addBooleanOption((o) => o.setName("crafting-contract").setDescription("Apply the -25% Crafting Contract materials reduction"));
  for (let i = 1; i <= 6; i++) {
    c.addStringOption((o) => o.setName(`on-hand-${i}`).setDescription("Any ingredient you already have some of (slot order doesn't matter).").setAutocomplete(true));
    c.addIntegerOption((o) => o.setName(`on-hand-${i}-quantity`).setDescription("How much of that you currently have.").setMinValue(0).setMaxValue(100000));
  }
  c.addIntegerOption((o) => o.setName("station-count").setDescription("How many of that station type you're running at once (for the time estimate only — doesn't change any ingredient amount).").setMinValue(1).setMaxValue(50));
  return c;
})
```

- [ ] **Step 3b: Add the `executeCalculator()` handler**

Add near the other standalone handler functions (e.g. alongside `executeServiceSetup`-style functions, or near the top-level helper functions before `executeDuneCommand`):

```js
import { calculateCraftingPlan, applyOnHandCredit, estimateDuration, recipeTreeNodes, MIN_QUANTITY, MAX_QUANTITY } from "./craftingCalculator.js";
import { CRAFTING_RECIPES } from "./craftingData.js";
import { formatCalculatorEmbed } from "./embedFormat.js";

function readOnHandEntries(interaction) {
  const entries = [];
  for (let i = 1; i <= 6; i++) {
    const node = interaction.options.getString(`on-hand-${i}`);
    const quantity = interaction.options.getInteger(`on-hand-${i}-quantity`);
    if (node === null && quantity === null) continue;
    if (node === null || quantity === null) {
      throw new Error(`on-hand-${i} and on-hand-${i}-quantity must both be provided together, or both omitted.`);
    }
    entries.push({ node, quantity, slot: i });
  }
  // Duplicate-node check
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      if (entries[a].node === entries[b].node) {
        throw new Error(`on-hand-${entries[a].slot} and on-hand-${entries[b].slot} both name ${entries[a].node} — combine them into a single value instead of splitting across slots.`);
      }
    }
  }
  return entries;
}

function executeCalculator({ interaction }) {
  const itemKey = interaction.options.getString("item");
  if (!CRAFTING_RECIPES[itemKey]) {
    throw new Error(`Unknown item: '${itemKey}'. Try /dune data calculator and use the autocomplete suggestions.`);
  }
  const quantity = interaction.options.getInteger("quantity") ?? 1;
  const stationTier = interaction.options.getString("station-tier") ?? "large";
  const craftingContract = interaction.options.getBoolean("crafting-contract") ?? false;
  const stationCount = interaction.options.getInteger("station-count") ?? 1;

  const rawOnHandEntries = readOnHandEntries(interaction);
  const treeNodes = new Set(recipeTreeNodes(itemKey).map((n) => n.key));
  for (const entry of rawOnHandEntries) {
    if (!treeNodes.has(entry.node)) {
      throw new Error(`'${entry.node}' is not an ingredient of ${itemKey}. Try /dune data calculator and use the autocomplete suggestions for on-hand items.`);
    }
  }

  // Step A: resolve target-item-itself credit BEFORE calling calculateCraftingPlan().
  const targetEntry = rawOnHandEntries.find((e) => e.node === itemKey);
  const targetItemOnHand = targetEntry?.quantity ?? 0;
  const effectiveQuantity = Math.max(0, quantity - targetItemOnHand);
  const ingredientOnHandEntries = rawOnHandEntries.filter((e) => e.node !== itemKey);

  const rawPlan = calculateCraftingPlan(itemKey, effectiveQuantity || MIN_QUANTITY, { stationTier, craftingContract });
  // effectiveQuantity can legitimately be 0 (fully credited by target-item
  // on-hand alone) -- calculateCraftingPlan's own MIN_QUANTITY bound can't
  // accept 0, so compute a real plan at MIN_QUANTITY and then zero out its
  // reported quantity/totals for display when effectiveQuantity is 0.
  const plan = effectiveQuantity === 0 ? { ...rawPlan, quantity: 0, crafts: 0, leftover: 0 } : rawPlan;

  const hasIngredientCredit = ingredientOnHandEntries.length > 0;
  const credited = hasIngredientCredit || targetItemOnHand > 0
    ? applyOnHandCredit(plan, ingredientOnHandEntries, { quantity, targetItemOnHand })
    : plan;

  const durations = estimateDuration(credited, { stationCount });

  return { plan: credited, durations, onHandEntries: rawOnHandEntries };
}
```

- [ ] **Step 3c: Wire the dispatch case**

In the big `key === "data:..."` if-chain (near `data:population`/`data:maps`), add:

```js
} else if (key === "data:calculator") {
  payload = executeCalculator({ interaction });
}
```

In the formatter-selection if-chain (near `formatPopulationEmbed`/`formatMapsEmbed`), add:

```js
} else if (subcommand === "calculator") {
  embed = formatCalculatorEmbed(payload.plan, payload.durations, { onHandEntries: payload.onHandEntries });
```

**Note:** `executeCalculator()` throws plain `Error`s for every validation failure described in the design's Error UX table — these propagate up through the existing `payload = executeCalculator(...)` call inside `executeDuneCommand()`'s existing top-level `try { ... } catch (error) { ... }` block unchanged, landing in the final `else { await sendError(interaction, { error: error.message || String(error) }); }` branch already there. Do not add a new catch branch for this feature.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/commands.test.js`
Expected: PASS, all tests including the pre-existing ones (regression check).

- [ ] **Step 5: Commit**

```bash
git add src/commands.js test/commands.test.js
git commit -m "feat(calculator): wire /dune data calculator into commands.js dispatch"
```

---

## Task 8: Autocomplete Wiring

**Files:**
- Modify: `src/index.js`
- Modify: `src/commands.js` (add an exported autocomplete handler)
- Create: `test/calculatorAutocomplete.test.js`

**Interfaces:**
- Produces: `handleCalculatorAutocomplete(interaction)` (exported from `commands.js`) — reads `interaction.options.getFocused(true)` (`{ name, value }`) and, for `on-hand-N` fields specifically, `interaction.options.getString("item")` (the already-filled `item` value on the same in-progress command), and calls `interaction.respond([{ name, value }, ...])` (max 25).
- Modifies: `src/index.js`'s `Events.InteractionCreate` handler to add a new `interaction.isAutocomplete?.()` branch (this interaction type is not handled anywhere in this file today — confirm this before assuming otherwise) that calls `handleCalculatorAutocomplete(interaction)` when `interaction.commandName === "dune"` and the focused option belongs to `data:calculator`.

- [ ] **Step 1: Write the failing tests**

```js
// test/calculatorAutocomplete.test.js
import assert from "node:assert/strict";
import { test } from "node:test";
import { handleCalculatorAutocomplete } from "../src/commands.js";

function mockAutocompleteInteraction({ focusedName, focusedValue = "", item = null }) {
  const responded = [];
  return {
    isAutocomplete: () => true,
    commandName: "dune",
    options: {
      getSubcommandGroup: () => "data",
      getSubcommand: () => "calculator",
      getFocused: (full) => (full ? { name: focusedName, value: focusedValue } : focusedValue),
      getString: (name) => (name === "item" ? item : null)
    },
    respond: async (choices) => { responded.push(...choices); },
    _responded: responded
  };
}

test("item autocomplete: case-insensitive substring match against the 15 known items", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "item", focusedValue: "plast" });
  await handleCalculatorAutocomplete(interaction);
  assert.ok(interaction._responded.some((c) => c.value === "plastanium_ingot"));
});

test("on-hand-N autocomplete: with item already selected, suggests only that item's own tree nodes", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "on-hand-1", focusedValue: "", item: "plastanium_ingot" });
  await handleCalculatorAutocomplete(interaction);
  const values = interaction._responded.map((c) => c.value);
  assert.ok(values.includes("titanium_ore"));
  assert.ok(values.includes("stravidium_fiber"));
  assert.ok(!values.includes("copper_ore"), "must not suggest a node outside plastanium's own tree");
});

test("on-hand-N autocomplete: with no item selected yet, returns a single non-selectable placeholder, not an empty list", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "on-hand-1", focusedValue: "", item: null });
  await handleCalculatorAutocomplete(interaction);
  assert.equal(interaction._responded.length, 1);
  assert.match(interaction._responded[0].name, /select an item first/i);
});

test("autocomplete response never exceeds Discord's 25-choice cap", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "item", focusedValue: "" }); // empty query matches all 15
  await handleCalculatorAutocomplete(interaction);
  assert.ok(interaction._responded.length <= 25);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/calculatorAutocomplete.test.js`
Expected: FAIL — `handleCalculatorAutocomplete is not a function`.

- [ ] **Step 3a: Add `handleCalculatorAutocomplete()` to `src/commands.js`**

```js
// append to src/commands.js
export async function handleCalculatorAutocomplete(interaction) {
  const focused = interaction.options.getFocused(true); // { name, value }
  const query = String(focused.value || "").toLowerCase();

  if (focused.name === "item") {
    const matches = Object.entries(CRAFTING_RECIPES)
      .filter(([, recipe]) => recipe.displayName.toLowerCase().includes(query))
      .sort(([, a], [, b]) => a.tier - b.tier || a.displayName.localeCompare(b.displayName))
      .slice(0, 25)
      .map(([key, recipe]) => ({ name: recipe.displayName, value: key }));
    await interaction.respond(matches);
    return;
  }

  if (/^on-hand-\d$/.test(focused.name)) {
    const selectedItem = interaction.options.getString("item");
    if (!selectedItem || !CRAFTING_RECIPES[selectedItem]) {
      await interaction.respond([{ name: "Select an item first", value: "__none__" }]);
      return;
    }
    const nodes = recipeTreeNodes(selectedItem)
      .filter((n) => n.displayName.toLowerCase().includes(query))
      .slice(0, 25)
      .map((n) => ({ name: n.displayName, value: n.key }));
    await interaction.respond(nodes);
    return;
  }

  await interaction.respond([]);
}
```

- [ ] **Step 3b: Add the `AutocompleteInteraction` branch to `src/index.js`**

In the `Events.InteractionCreate` handler (`src/index.js`, near the existing `isButton?.()`/`isChatInputCommand?.()` branches), add — **before** the `isChatInputCommand?.()` branch, since an autocomplete interaction is a distinct type discord.js can deliver for the same command name:

```js
if (interaction.isAutocomplete?.() && interaction.commandName === "dune") {
  const group = interaction.options.getSubcommandGroup();
  const sub = interaction.options.getSubcommand();
  if (group === "data" && sub === "calculator") {
    await handleCalculatorAutocomplete(interaction);
  }
  return;
}
```

Add `handleCalculatorAutocomplete` to this file's existing `import { ... } from "./commands.js"` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/calculatorAutocomplete.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands.js src/index.js test/calculatorAutocomplete.test.js
git commit -m "feat(calculator): dependent on-hand-N autocomplete, new AutocompleteInteraction branch in index.js"
```

---

## Task 9: Integration Test

**Files:**
- Modify: `test/discord-bot-test-harness.js` (append to the existing `describe('Command Execution', ...)` block)

**Interfaces:**
- Consumes: `createMockInteraction` (`test/fixtures/mockInteraction.js`), `executeDuneCommand`, `getTestContext()` — all already established in this file.

- [ ] **Step 1: Write the failing test**

```js
// append inside describe('Command Execution', ...) in test/discord-bot-test-harness.js
test('data:calculator returns an embed via the full commands.js dispatch path, no adapter call required', async () => {
  const { adapterClient, config } = getTestContext();
  const interaction = createMockInteraction({
    command: 'data:calculator',
    roles: ['observer-role-id'],
    options: { item: 'copper_ingot', quantity: 5, 'station-tier': 'large' }
  });
  const result = await executeDuneCommand(interaction, adapterClient, config);
  assert.ok(result, 'Command should succeed');
  assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  const embed = interaction._editReply.embeds[0].data || interaction._editReply.embeds[0];
  assert.match(JSON.stringify(embed), /Copper Ingot/);
});
```

- [ ] **Step 2: Run to verify it fails, then passes**

Run: `node --test test/discord-bot-test-harness.js`
Expected: FAIL first (before Task 7 lands — if run standalone after Tasks 1-8 are already committed, it should PASS immediately; run it anyway to confirm the harness path itself, not just the unit tests, exercises the real dispatch).

- [ ] **Step 3: Fix any gap the harness surfaces**

`test/fixtures/mockInteraction.js`'s `getInteger`/`getBoolean` read from a flat `cmdOptions` map by name already — no fixture changes should be needed. If this test fails for a reason unrelated to the calculator itself (e.g. `getFocused` missing — it shouldn't be called on a `ChatInputCommandInteraction` path), fix the actual bug rather than loosening the test.

- [ ] **Step 4: Run full suite**

Run: `npm test`
Expected: PASS, 0 failures, no regressions in any pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add test/discord-bot-test-harness.js
git commit -m "test(calculator): integration test through the full commands.js dispatch path"
```

---

## Task 10: Documentation, Attribution, Final Verification

**Files:**
- Modify: `docs/user-guide.md`
- Create: `docs/changes/PR-####-crafting-calculator.md` (rename once the real PR number is known)
- Modify: `docs/changes/README.md`

**Interfaces:** None — documentation and verification only.

- [ ] **Step 1: Add the attribution comment (if not already present from Task 1)**

Confirm `src/craftingData.js`'s header comment (written in Task 1, Step 3) matches `docs/calculator-grc.md`'s required text exactly:

```js
// Recipe data and calculation formula derived from published Dune
// Awakening game mechanics; verified against
// https://dune.gaming.tools/crafting-calculator (fan reference site, not
// affiliated with Funcom/Legendary).
```

- [ ] **Step 2: Document the command in `docs/user-guide.md`**

Find the existing `data` command group section (search for `data population` or similar in that file) and add a `data calculator` entry following the same format as its siblings — command syntax, one-sentence description, and a one-line note that `on-hand-N` slots are optional and their order doesn't matter.

- [ ] **Step 3: Run this repo's own doc-drift test**

Run: `npm run docs:check-architecture-drift`
Expected: PASS (this feature doesn't touch `docs/architecture.md`'s tracked files, so this should already be clean — run it anyway to confirm).

- [ ] **Step 4: Open the PR, then write the change note with the real number**

After opening the PR (see PR Requirements below), create `docs/changes/PR-<real-number>-crafting-calculator.md` following the structure in `docs/changes/PR-0091-upstream-feedback-resolution.md`:

```markdown
# PR Change Summary — Crafting Calculator

## Addressed Items

### 1. `/dune data calculator` — crafting requirements, shortfall, and max-completable ✅

**Problem:** Players manually cross-reference a third-party site (dune.gaming.tools) for crafting math, and had no way to track partial progress against a farming goal inside Discord.

**Solution:** New `/dune data calculator` command computes, entirely locally (zero adapter calls, zero database writes): total ingredient requirements for 15 verified craftable items across their real per-tier station variants, an optional shortfall/max-completable/bottleneck calculation against up to 6 on-hand ingredient values, and per-station-family duration estimates.

**Commands:**
- `/dune data calculator item:<...> quantity:<1-100000> [station-tier] [crafting-contract] [on-hand-1..6] [on-hand-N-quantity] [station-count]`

**Implementation Details:**
- `src/craftingData.js` — versioned, source-cited recipe table (see `docs/calculator-grc.md` for data-provenance/drift-risk disclosure)
- `src/craftingCalculator.js` — `calculateCraftingPlan()`, `applyOnHandCredit()`, `estimateDuration()`, `recipeTreeNodes()`, all pure functions, no Discord.js
- `src/embedFormat.js`'s `formatCalculatorEmbed()`, `src/commands.js`'s `executeCalculator()`/`handleCalculatorAutocomplete()`, `src/index.js`'s new `AutocompleteInteraction` branch
- Full design record: `docs/calculator-design.md`, `docs/calculator-architecture.md`, `docs/calculator-security-review.md`, `docs/calculator-grc.md`
```

Add a corresponding row to `docs/changes/README.md`'s index table.

- [ ] **Step 5: Run full verification before marking the PR ready**

```bash
npm run check
npm audit --audit-level=moderate
```

Expected: both clean. If `pre-commit` is installed locally, also run `pre-commit run --all-files`.

- [ ] **Step 6: Commit**

```bash
git add docs/user-guide.md docs/changes/
git commit -m "docs(calculator): user guide entry, PR change note, attribution"
```

- [ ] **Step 7: Push and open the PR**

```bash
git push -u origin feat/crafting-calculator-phase-1
```

Open the PR against `main` using `.github/PULL_REQUEST_TEMPLATE.md`, referencing all four calculator design docs. Per this repo's own Requirement 20, this PR needs a Layer 2 (implementation) audit dispatched against the real diff before merge, and per Requirement 19-adjacent discipline for any `data:*` command touching player-facing behavior, a manual smoke-test in a test guild before merge — flag both as open items in the PR body rather than skipping them.

---

## Self-Review Notes (from the plan author, for the executor to double-check while implementing)

- **Spec coverage:** every numbered item in `docs/calculator-implementation-prompt.md`'s "Required Behavior" section maps to a task above (1/1a → Tasks 2-3; 2 → Task 2's cycle guard; 3 → Task 2's unknown-item error; 4 → Task 2's tier error; 5 → Tasks 2-4's structured-object-not-string return shape; 6 → Task 7's note that cooldown is inherited automatically; 7 → Task 1; 8 → Global Constraints' explicit prohibition; 9 → Task 1/10's attribution comment).
- **The `applyOnHandCredit()` cascade math in Task 3, Step 3 is illustrative, not gospel** — it is the one part of this plan most likely to need real debugging to match the exact worked-example numbers. Budget real time for it, and do not weaken the worked-example tests to match a buggy implementation; fix the implementation.
- **Task 7's `executeCalculator()` assumes a synchronous, non-async dispatch value is acceptable inside the existing `payload = await ...` pattern** — confirm this against the real surrounding code once Task 7 starts; if the existing if-chain's syntax requires every branch to use `await`, `await executeCalculator(...)` on a non-Promise value is still valid JavaScript and a no-op, so this is safe either way.
- **This plan does not attempt to fully specify every embed formatting pixel** — `docs/calculator-design.md`'s two full worked-example transcripts (§Response Shape) are the authoritative visual target; Task 6's tests check for the presence of key facts (totals, the `(goal)` suffix, the tip, emoji framing) rather than exact string equality, so there is room for the implementer to match this file's existing embed conventions exactly without the plan dictating character-for-character layout.
</content>
