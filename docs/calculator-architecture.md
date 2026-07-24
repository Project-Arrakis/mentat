# Crafting Calculator — Architecture

## Overview

The calculator is pure local arithmetic over a versioned, static recipe
table. It makes **zero external calls** — no adapter request, no database
query, no file I/O beyond the bundled data module. This is deliberately the
lowest-risk architecture available for this feature: recipe data changes are
data-only commits, not logic changes, and the calculation logic is fully
unit-testable without Discord.js or a network connection.

The traversal/rounding/modifier logic in this document is **not an original
design** — it is a direct, cited port of the reference site's own verified
algorithm (see §Verified Reference Algorithm below), adapted to this bot's
15-item scope. This was a deliberate choice: reinventing the math risked
subtle divergence from the numbers players already trust from the reference
tool; porting the actual verified algorithm eliminates that risk entirely.

## New Files

```
src/craftingData.js             — recipe table (data) + item metadata
src/craftingCalculator.js       — traversal/calculation logic, separate from data
test/craftingData.test.js       — internal-consistency assertions
test/craftingCalculator.test.js — traversal/math correctness, edge cases, bounds
```

## Modified Files

```
src/commands.js     — new `data:calculator` subcommand, dispatch case, autocomplete handler
src/embedFormat.js   — new formatCalculatorEmbed()
docs/user-guide.md   — new command documented under the `data` command group
```

## Verified Reference Algorithm

The reference site's crafting-calculator page (route node `10`) is a
SvelteKit component compiled to
`https://dune.gaming.tools/_app/immutable/nodes/10.Cx5T3nNJ.js`. This file is
plain, unobfuscated (only minified) JavaScript, publicly served to every
visitor's browser — reading it is equivalent to reading any other public
client-side web application source, no different from viewing a page's
rendered HTML. It was fetched and read directly (2026-07-24) to resolve
questions the static server-rendered HTML could not answer: exact rounding
rule, modifier scope, and batch/leftover logic.

The relevant class (`CraftingCalculatorStore` in the original, renamed here
for clarity) exposes this exact logic (variable names restored from the
minified originals for readability; behavior is unchanged):

```js
// Per-ingredient, per-single-craft cost factor.
// NOTE: deepDesert and craftingContractActive are mutually exclusive in the
// live UI (if/else chain) — but deepDesert never applies to our item set
// regardless, since it's gated on mainCategoryId "placeables"/"buildables"
// and every item in this feature's scope is mainCategoryId "items".
_costFactor(item) {
  return this.deepDesert && (item.mainCategoryId === "placeables" || item.mainCategoryId === "buildables")
    ? 0.5
    : this.craftingContractActive && item.mainCategoryId === "items"
    ? 0.75
    : 1;
}

// Ceiling rounding, applied BEFORE multiplying by craft count.
getIngredientPerCraft(item, quantity) {
  const factor = this._costFactor(item);
  return Math.ceil(quantity * factor);
}

getIngredientTotal(item, quantity, crafts) {
  return this.getIngredientPerCraft(item, quantity) * crafts;
}

// Batch count: always round UP to whole crafts, never partial.
// This produces "leftover" units when requiredQuantity doesn't divide
// evenly by outputPerCraft (relevant for our multi-output items: Spice-
// infused Fuel Cell x10, both Lubricants x5/x10).
crafts = Math.ceil(requiredQuantity / outputPerCraft);
```

The reference site's own demand-collection routine (`_collectDemand()`) is
an **unbounded breadth-first queue walk** over the recipe graph — it is not
a hardcoded "depth 1" recursion. It happens to terminate correctly for their
entire item database (weapons, armor, vehicles, building parts, everything)
because the underlying data has no cycles, but the algorithm itself contains
**no cycle-detection guard**. This is a latent robustness gap in the
reference implementation, not a deliberate design choice on their part.

**This implementation must not blindly copy that gap.** See §Traversal
Design below for the deliberate improvement made here.

## Recipe Data Model

```js
// src/craftingData.js (illustrative shape — not final code)
export const CRAFTING_RECIPES = Object.freeze({
  plastanium_ingot: {
    displayName: "Plastanium Ingot",
    tier: 6,
    outputPerCraft: 1,
    variants: {
      large: {
        station: "Large Ore Refinery",
        craftTimeSeconds: 20,
        inputs: [
          { resource: "water", quantity: 1250, craftable: false },
          { resource: "titanium_ore", quantity: 4, craftable: false },
          { resource: "stravidium_fiber", quantity: 1, craftable: true }, // nests
        ],
      },
      medium: {
        station: "Medium Ore Refinery",
        craftTimeSeconds: 30,
        inputs: [
          { resource: "water", quantity: 1250, craftable: false },
          { resource: "titanium_ore", quantity: 6, craftable: false },
          { resource: "stravidium_fiber", quantity: 1, craftable: true },
        ],
      },
      // NOTE: no `small` key — Plastanium has no Small Ore Refinery variant.
      // The absence of a key, not a null/empty placeholder, is how "tier
      // does not exist" is represented — see calculator-security-review.md
      // for why an explicit missing-tier error is required here.
    },
    source: {
      url: "https://dune.gaming.tools/items/t6refinedresourcea",
      verifiedAt: "2026-07-24",
    },
  },
  // ...14 more entries, one block each, same shape (some with only 1 or 2
  // variant keys present — see calculator-design.md's tier-availability
  // table for the exact per-item list)
});
```

This differs from the originally-drafted shape in one important way: each
item now has a `variants` map keyed by tier (`small`/`medium`/`large`), not
a single flat `inputs` array — because most items in this set have **more
than one** real station-tier recipe with genuinely different ingredient
quantities and craft times (confirmed per-item in the design doc's tier
table), not just a single "default" recipe with a hypothetical alternate.

## Traversal Design

```js
// src/craftingCalculator.js (illustrative shape)
export function calculateCraftingPlan(itemKey, quantity, {
  stationTier = "large",
  craftingContract = false,
} = {}) {
  // 1. Validate itemKey exists in CRAFTING_RECIPES — throw a typed,
  //    catchable error if not.
  // 2. Validate quantity is an integer in [1, 10000] — defense-in-depth,
  //    re-checked even though the Discord option already enforces it.
  // 3. Validate CRAFTING_RECIPES[itemKey].variants[stationTier] exists —
  //    throw a typed "no recipe variant at this tier" error if not. Never
  //    fall back to a different tier's numbers.
  // 4. Walk the recipe's `inputs` using an explicit visited-set (a Set of
  //    item keys currently on the path from the root request), matching
  //    the reference site's own BFS/queue approach but WITH a cycle guard
  //    the reference implementation itself lacks: if a `craftable: true`
  //    input's key is already in the visited set, throw a typed
  //    "circular recipe dependency detected" error instead of recursing
  //    infinitely. This is a deliberate hardening over the ported
  //    algorithm, added because our data-integrity test suite must be able
  //    to assert "no cycles exist" rather than simply hoping that holds.
  // 5. For each ingredient: quantityPerCraft = Math.ceil(rawQuantity *
  //    costFactor); costFactor = craftingContract ? 0.75 : 1 (Deep Desert
  //    Discount and Refining Contract are permanently out of scope — see
  //    calculator-design.md §Modifiers).
  // 6. crafts = Math.ceil(requiredQuantity / outputPerCraft); track
  //    leftover = crafts * outputPerCraft - requiredQuantity for the
  //    top-level requested item (matches the reference site's own
  //    "Leftovers" panel behavior).
  // 7. Return a structured plan object: { directInputs, nestedCrafts,
  //    totalRawMaterials, totalTimeSeconds, leftover } — NOT a
  //    pre-formatted string. Formatting is embedFormat.js's job, keeping
  //    this function unit-testable without touching Discord.js at all.
}
```

Note step 4's cycle guard: for this specific 15-item set, no cycle actually
exists (verified — see §Dependency Graph below), so the guard never
triggers in practice today. It exists so that a future recipe-data addition
that accidentally introduces a cycle fails a test loudly instead of hanging
or silently producing wrong numbers, matching this repo's general
defense-in-depth posture rather than assuming today's shallow, acyclic graph
holds forever.

## Dependency Graph

Recipes that nest (an output that is itself an input to another recipe),
confirmed exhaustively across all 15 items and every real tier variant:

```
Steel Ingot                <- Iron Ingot          (all 3 tiers)
Duraluminum Ingot          <- Aluminum Ingot       (both tiers)
Plastanium Ingot           <- Stravidium Fiber     (both tiers)
Low-grade Lubricant        <- Silicone Block       (both tiers)
Industrial-grade Lubricant <- Silicone Block       (both tiers)
```

Every nesting relationship in this set happens to be exactly **one level
deep** — no item here requires an input that itself requires another
crafted item beyond that (e.g. Stravidium Fiber's own input, Stravidium
Mass, is a gathered leaf resource with no recipe). This is confirmed as a
property of *this specific 15-item dataset*, not asserted as a permanent
architectural constraint — the traversal design in §Traversal Design above
does not hardcode a depth limit; it uses a general cycle-safe walk that
would correctly handle deeper nesting if a future recipe addition
introduced it, and the data-integrity test suite documents the current
depth-1 reality as a fact to be re-checked on every recipe-data change, not
a hard limit enforced by the code itself.

The following are leaf resources — gathered, not crafted, with no recipe of
their own: Copper Ore, Iron Ore, Carbon Ore, Aluminum Ore, Titanium Ore,
Jasmium Crystal, Stravidium Mass, Erythrite Crystal, Flour Sand, Spice
Residue, Irradiated Slag, Water, and base **Fuel Cell** (which is itself an
input to Small/Medium/Large Vehicle Fuel Cell, Spice-infused Fuel Cell, and
both Lubricants — it is a leaf node with five separate "used for crafting"
downstream references, not a craftable item in its own right). These are
reported as "gather N × [item]", never as a fabricated craft recipe.

## Station Placeable Reference

Confirmed directly from the reference site's own structured
placeable/category data (not inferred from item-page absence alone):

| Refinery family | Small | Medium | Large |
|---|:-:|:-:|:-:|
| Ore Refinery | ✅ | ✅ | ✅ |
| Chemical Refinery | ✅ | ✅ | **does not exist** |
| Spice Refinery | ✅ | ✅ | ✅ (not used by any of our 15 items) |

"Large Chemical Refinery" is not a missing data point — it is not a real
placeable in the game. This matters for the autocomplete/validation logic:
`station-tier: Large` must be a **valid, rejectable-with-explanation**
option only for the six Ore-Refinery items that actually have it, never
silently offered for Chemical-Refinery items.

## Autocomplete Wiring

Discord.js requires a distinct `interactionCreate` handling path for
`AutocompleteInteraction` versus `ChatInputCommandInteraction`. `src/index.js`
today only handles the latter (`client.on(Events.InteractionCreate, ...)` with
no existing autocomplete branch) — this is a **new interaction-handling
branch**, not an extension of an existing one, and should be scoped
accordingly in implementation effort.

## Data/Logic Separation Summary

| Concern | Owner | Rationale |
|---------|-------|-----------|
| Recipe values, tiers, stations, sources | `craftingData.js` | Changes on game balance patches; no logic risk |
| Traversal, rounding, modifier application, cycle guard, bounds enforcement | `craftingCalculator.js` | Pure functions, no Discord.js, no network |
| Embed rendering, truncation, thousands separators, leftover display | `embedFormat.js` | Matches every other `data:*` formatter |
| Command registration, dispatch, autocomplete resolution | `commands.js` / `index.js` | Matches existing subcommand pattern |

## Explicitly Out of Scope

- No new adapter route, no new database table, no new environment variable.
- No new npm dependency — expressible entirely in existing `discord.js` +
  plain JS.
- Deep Desert Discount and Refining Contract modifiers — verified
  structurally not applicable / non-functional; see
  [Design §Modifiers](calculator-design.md#modifiers--verified-scope).
- `scripts/api-security-test.js` (DAST) does not need new coverage: it only
  exercises adapter HTTP endpoints via `createMockAdapterServer()`; the
  calculator makes zero adapter calls and is structurally out of that
  suite's scope.

## Sources

- [Design](calculator-design.md)
- [Security Review](calculator-security-review.md)
- [GRC Review](calculator-grc.md)
- `https://dune.gaming.tools/_app/immutable/nodes/10.Cx5T3nNJ.js` — reference
  site's compiled crafting-calculator component (publicly served client-side
  JS), read directly 2026-07-24 to verify `_costFactor()`, ceiling rounding,
  and batch/leftover logic
- `src/adapterClient.js` — transport/presentation separation precedent
- `src/embedFormat.js` — existing formatter pattern and truncation conventions
- `test/discord-bot-test-harness.js` — existing integration-test harness pattern
</content>
