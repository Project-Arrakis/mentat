# Crafting Calculator — Architecture

## Overview

The calculator is pure local arithmetic over a versioned, static recipe
table. It makes **zero external calls** — no adapter request, no database
query, no file I/O beyond the bundled data module. This is deliberately the
lowest-risk architecture available for this feature: recipe data changes are
data-only commits, not logic changes, and the calculation logic is fully
unit-testable without Discord.js or a network connection.

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

## Why `craftingData.js` Is Separate From `craftingCalculator.js`

This mirrors an existing convention already in this codebase:
`adapterClient.js` (transport) is separate from `embedFormat.js`
(presentation) and `commands.js` (orchestration). Recipe *data* changing
(a game balance patch) should never require touching *traversal logic*, and
a traversal-logic bug fix should never require re-verifying every recipe
number. Applying the same separation one layer deeper:

```js
// src/craftingData.js (illustrative shape — not final code)
export const CRAFTING_RECIPES = Object.freeze({
  plastanium: {
    displayName: "Plastanium Ingot",
    tier: 6,
    station: "Large Ore Refinery",
    craftTimeSeconds: 20,
    outputQuantity: 1,
    inputs: [
      { resource: "water", quantity: 1250, craftable: false },
      { resource: "titanium_ore", quantity: 4, craftable: false },
      { resource: "stravidium_fiber", quantity: 1, craftable: true }, // nests
    ],
    source: {
      url: "https://dune.gaming.tools/items/t6refinedresourcea",
      verifiedAt: "2026-07-23",
    },
  },
  // ...15 more entries, one block each, same shape
});
```

```js
// src/craftingCalculator.js (illustrative shape)
export function calculateCraftingPlan(itemKey, quantity, { stationTier = "Large" } = {}) {
  // 1. Validate itemKey exists in CRAFTING_RECIPES — throw a typed, catchable
  //    error if not. This is the one user-input validation point; everything
  //    downstream trusts it.
  // 2. Validate quantity is an integer in [1, 10000] — defense-in-depth,
  //    re-checked here even though the Discord option already enforces it.
  //    See calculator-security-review.md.
  // 3. Walk the recipe's `inputs`, recursing exactly once into any
  //    `craftable: true` input's own recipe. Actively refuse recursion
  //    beyond depth 1 (throw, do not silently truncate) — see the
  //    dependency-graph note below.
  // 4. Return a structured plan object: { directInputs, nestedCrafts,
  //    totalRawMaterials, totalTimeSeconds } — NOT a pre-formatted string.
  //    Formatting is embedFormat.js's job, keeping this function
  //    unit-testable without touching Discord.js at all.
}
```

## Dependency Graph

Recipes that nest (an output that is itself an input to another recipe):

```
Steel Ingot             <- Iron Ingot
Duraluminum Ingot       <- Aluminum Ingot
Plastanium Ingot        <- Stravidium Fiber
Low-grade Lubricant     <- Silicone Block
Industrial Lubricant    <- Silicone Block
```

None of the 16 requested items nest more than **one level deep** — no item
here requires an input that itself requires another crafted item beyond
that. This bounds the traversal problem to a fixed recursion depth of 1.

This assumption is asserted by `craftingData.test.js`, not just documented:
if a future recipe addition introduces depth-2 nesting without updating
`calculateCraftingPlan()`'s traversal logic, the data-integrity test must
fail loudly rather than silently producing wrong totals. `calculateCraftingPlan()`
must actively refuse (throw) if it detects recursion beyond depth 1, rather
than assuming the shallow case holds indefinitely.

The six base ores/materials that have no recipe of their own (Copper Ore,
Iron Ore, Carbon Ore, Aluminum Ore, Titanium Ore, Jasmium Crystal, Stravidium
Mass, Erythrite Crystal, Flour Sand, Spice Residue, Irradiated Slag, base
Fuel Cell) are leaf nodes — reported as "gather N × [item]", never as a
fabricated craft recipe.

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
| Traversal, validation, bounds enforcement | `craftingCalculator.js` | Pure functions, no Discord.js, no network |
| Embed rendering, truncation, thousands separators | `embedFormat.js` | Matches every other `data:*` formatter |
| Command registration, dispatch, autocomplete resolution | `commands.js` / `index.js` | Matches existing subcommand pattern |

## Explicitly Out of Scope

- No new adapter route, no new database table, no new environment variable.
- No new npm dependency — expressible entirely in existing `discord.js` +
  plain JS.
- `scripts/api-security-test.js` (DAST) does not need new coverage: it only
  exercises adapter HTTP endpoints via `createMockAdapterServer()`; the
  calculator makes zero adapter calls and is structurally out of that
  suite's scope.

## Sources

- [Design](calculator-design.md)
- [Security Review](calculator-security-review.md)
- [GRC Review](calculator-grc.md)
- `src/adapterClient.js` — transport/presentation separation precedent
- `src/embedFormat.js` — existing formatter pattern and truncation conventions
- `test/discord-bot-test-harness.js` — existing integration-test harness pattern
</content>
