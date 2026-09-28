# Crafting Calculator — Architecture

**Revision history:** extended alongside `calculator-design.md`'s revision
(shortfall/max-completable/duration calculation, 6 on-hand slots, 100,000
quantity bound). §Verified Reference Algorithm, §Recipe Data Model,
§Dependency Graph, and §Station Placeable Reference are unchanged from v1
and still authoritative. §Traversal Design is extended, not replaced — the
original forward-only traversal remains step 1 of the new calculation.

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

**Revision note:** no new files beyond v1's original two — the
shortfall/on-hand-credit/max-completable/duration logic (§Shortfall
Traversal Design below) lives in the same `craftingCalculator.js`, as
additional exported functions alongside the original `calculateCraftingPlan()`,
not a separate module. The on-hand-scoped autocomplete (§Autocomplete Wiring)
reuses the same `CRAFTING_RECIPES` data via a new small helper
(`recipeTreeNodes(itemKey)`, returning every on-hand-able node for a given
item) rather than a new data file.

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

## Shortfall Traversal Design

Extends `calculateCraftingPlan()`'s output rather than replacing it. New
function, same file:

**Revision note (Layer 1 audit, 2026-09-28):** this pseudocode originally
folded target-item-itself credit into the same `min()`-based
`maxCompletable` formula as ingredient credit, which the Architect and QA
hats independently showed produces a wrong answer (additive
already-completed progress isn't a consumable supply constraint). Fixed
below by resolving target-item credit into `effectiveQuantity` in a
separate, earlier step — `calculateCraftingPlan()` itself receives
`effectiveQuantity`, not the raw requested `quantity`, so `plan`'s own
tree requirements are already correct for whatever's actually left to
produce, and `applyOnHandCredit()` only ever has to handle genuine
ingredient-level supply constraints. This also closes the audit's node-key
prototype-pollution finding (S-2) and the bound-revalidation finding (S-1)
explicitly, as their own numbered steps below.

```js
// src/craftingCalculator.js (illustrative shape)

// Step A — resolve effective quantity BEFORE calling calculateCraftingPlan().
// Lives in the command handler (commands.js), not craftingCalculator.js,
// since it only touches the single target-item on-hand value, not the
// tree-walk itself:
//   const targetItemOnHand = onHandEntries.find(e => e.node === itemKey)?.quantity ?? 0;
//   const effectiveQuantity = Math.max(0, quantity - targetItemOnHand);
//   const plan = calculateCraftingPlan(itemKey, effectiveQuantity, options);
// plan's own tree requirements (directInputs, nestedCrafts,
// totalRawMaterials) are therefore already computed against what's
// actually left to produce. The response still displays the original
// `quantity` (the stated goal) alongside `effectiveQuantity` — this is a
// presentation-layer concern for formatCalculatorEmbed(), not something
// applyOnHandCredit() needs to know about.

export function applyOnHandCredit(plan, onHandEntries, { quantity, targetItemOnHand } = {}) {
  // plan: calculateCraftingPlan()'s output, computed against
  //   effectiveQuantity per Step A above — NOT the raw requested quantity.
  // onHandEntries: [{ node: "titanium_ore", quantity: 2000 }, ...] — up to
  //   6 entries, MINUS whichever one (if any) named the target item itself
  //   (already consumed in Step A) — this function only ever sees
  //   ingredient-level entries.
  //
  // [SECURITY, closing Layer 1 audit finding S-2] Every node-keyed
  // structure this function builds or reads — the flat requirement map,
  // `plan.nestedCrafts`, the returned `shortfall` map — MUST be a `Map`,
  // never a plain object literal. `onHandEntries[].node` values that
  // reach this function may originate from a free-typed Discord option
  // that bypassed autocomplete (see the design doc's §Error UX validation
  // requirement, which happens before this function is ever called, but
  // defense-in-depth applies here too): a plain-object lookup like
  // `map[node]` or `node in map` resolves `"__proto__"`/`"constructor"`/
  // `"prototype"` to real inherited properties instead of `undefined`,
  // and this bot is a long-running process — a successful pollution here
  // would corrupt shared `Object.prototype` state for every subsequent
  // invocation by every user, not just the caller's own. `Map.get()`/
  // `Map.has()` have no such inherited-property ambiguity. This is a
  // required implementation constraint, not a style preference.
  //
  // [SECURITY, closing Layer 1 audit finding S-1] Re-validate
  // `onHandEntries[].quantity` is an integer in [0, 100000] HERE,
  // explicitly, as this function's own first step — do not rely on the
  // Discord option bound or the command handler's own check alone, for
  // the identical reason `calculateCraftingPlan()` independently
  // re-validates `quantity` rather than trusting the option constraint.
  // A malformed/out-of-range value here throws the same typed,
  // catchable error `calculateCraftingPlan()` uses for its own bound
  // violation — do not introduce a second error shape.
  //
  // 1. Build a Map of every node in `plan`'s tree to its own computed,
  //    ALREADY-POOLED requirement — a resource appearing at multiple tree
  //    levels (Water for every chained item; Fuel Cell for both
  //    Lubricants) must be combined into ONE entry before this step, not
  //    tracked per-level. This is just plan's existing directInputs +
  //    nestedCrafts + totalRawMaterials, deduplicated by resource key —
  //    no new computation, purely reading and combining what
  //    calculateCraftingPlan() already produced (it already pools these
  //    for its own "Total Raw Materials" output — reuse that, don't
  //    re-derive it).
  // 2. For each onHandEntries pair, subtract from that node's pooled
  //    requirement, floored at 0. If the node is an intermediate
  //    craftable (a key in plan.nestedCrafts), recompute that nested
  //    craft's own crafts count downward too (crafts = ceil(newRequirement
  //    / outputPerCraft)), and re-derive ITS OWN ingredients' requirements
  //    from the reduced crafts count, merging the result back into the
  //    same pooled map from step 1 — a raw leaf under that nested craft
  //    (e.g. Stravidium Mass under Stravidium Fiber) gets its pooled
  //    total reduced by this cascade even though it wasn't itself named
  //    in onHandEntries. Reuse the exact same per-ingredient
  //    ceiling-rounding formula calculateCraftingPlan() already uses; do
  //    not introduce a second, parallel rounding implementation.
  // 3. Compute the supply-constrained part of maxCompletable: for each
  //    onHandEntries node, divide its on-hand quantity by its own
  //    per-target-unit ratio (derived from plan's tree — e.g. for a direct
  //    ingredient, ratio = original per-craft quantity / outputPerCraft;
  //    for a nested craftable's own ingredient, the ratio must account for
  //    the chain: on-hand raw material -> max nested crafts -> max parent
  //    crafts). The minimum across all onHandEntries is the
  //    supply-constrained value; track which node produced the minimum as
  //    the named bottleneck. If onHandEntries is empty, this term is
  //    unbounded (Infinity, not undefined — see step 4's combination with
  //    targetItemOnHand).
  // 4. Final maxCompletable = Math.min(quantity, targetItemOnHand +
  //    supplyConstrainedValue-from-step-3) — combining already-completed
  //    progress (additive) with remaining supply (a cap), never applying
  //    Math.min() to targetItemOnHand directly the way the original
  //    (wrong) draft did. If BOTH targetItemOnHand is 0 and
  //    onHandEntries is empty, maxCompletable is undefined (the response
  //    omits this line entirely, per the design doc) rather than a
  //    computed 0.
  // 5. Return { ...plan, quantity, effectiveQuantity: plan's own quantity,
  //    shortfall: <pooled Map, post-subtraction>, maxCompletable: { units,
  //    limitingNode } | undefined }. Never mutate the input `plan` object
  //    — callers (formatCalculatorEmbed()) need both the original full
  //    requirement AND the post-credit shortfall to render the
  //    "(2,000 on hand — fully covered)"-style explanatory text the
  //    design doc requires, plus both `quantity` and `effectiveQuantity`
  //    to show the goal vs. what's actually left to produce.
}
```

**Cascade correctness is the one genuinely new hard part here**, and it only
matters for the five chained items (Steel/Duraluminum/Plastanium/both
Lubricants — see the design doc's corrected §Recipe Data note). For every
flat item (the other ten), on-hand credit is a single subtraction with no
cascade at all — `applyOnHandCredit()` must not apply cascade logic
unconditionally; it should check whether the credited node is a key in
`plan.nestedCrafts` first, and only cascade in that case.

**Required test coverage (expanded per the Layer 1 audit's QA findings —
the original note here only required one credit shape per chained item;
that was insufficient):** for each of the five chained items, the
data-integrity test suite must cover all three distinct credit shapes,
since each exercises genuinely different code:
1. **Crediting a flat ingredient directly** (e.g. Titanium Ore for
   Plastanium) — subtraction only, no cascade, already covered by the
   design doc's primary worked example.
2. **Crediting the intermediate craftable itself** (e.g. Stravidium Fiber
   for Plastanium) — cascades down, reducing the intermediate's own
   ingredient needs. Already covered by the design doc's primary example.
3. **Crediting a leaf resource underneath the intermediate** (e.g.
   Stravidium Mass directly, skipping Stravidium Fiber) — a pure leaf
   subtraction against the *pooled* total, explicitly NOT cascading
   upward into the intermediate's own craft count. This shape was entirely
   untested by the original design and is now covered by the design doc's
   new "leaf-under-nested-craftable credit" worked example — it is the
   easiest of the three to implement wrong (a naive implementation might
   incorrectly try to cascade this one too, or double-count it against
   both the pooled total and the intermediate's own requirement).

Additionally, at least one test must cover **chain-aware `maxCompletable`**
specifically — crediting an intermediate craftable (not just a flat leaf)
and confirming the supply-constrained ratio correctly walks the chain (see
the design doc's new "chain-aware max completable" worked example, 8
Stravidium Fiber on hand → 8 Plastanium Ingot completable, naming
Stravidium Fiber as the bottleneck over a much larger Titanium Ore supply).
This was the single highest-risk untested path per the Layer 1 QA
finding — the original design had zero worked numbers for it at all.

Finally, at least one test must cover **target-item-itself credit
combined with an insufficient ingredient supply**, confirming step 4's
`Math.min(quantity, targetItemOnHand + supplyConstrainedValue)` formula
— not the earlier (wrong) design's plain `min()` over all credits
including the target item.

**Duration** (`craftTimeSeconds` per remaining node, station-type-independent
—  see the design doc's §Duration) is a straightforward derived field from
the same post-credit shortfall map, added as a third function
(`estimateDuration(shortfall, stationCounts)`) rather than folded into
`applyOnHandCredit()` — keeps each function doing exactly one thing,
matching this file's own existing data/logic-separation philosophy.

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
  // 2. Validate quantity is an integer in [1, 100000] — defense-in-depth,
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

**Revision note — dependent autocomplete for `on-hand-N`:** the
`AutocompleteInteraction` payload includes every option value already
filled in on the same in-progress command (`interaction.options.getFocused()`
plus `interaction.options.get("item")` for the already-chosen value) — this
is standard discord.js API, not a new capability. The `on-hand-N` handler
reads the already-selected `item`, calls the new `recipeTreeNodes(itemKey)`
helper (§New Files above) to get that item's own on-hand-able node list
(target item + direct ingredients + nested craftable's own ingredients,
6 max per §Recipe Data's verified worst case), and filters/returns from that
list only — never the full 15-item-plus-every-leaf-resource universe. If
`item` isn't filled in yet, return a single non-selectable placeholder entry
("Select an item first") rather than an empty list (an empty autocomplete
response can read as "broken" rather than "nothing to show yet").

## Data/Logic Separation Summary

| Concern | Owner | Rationale |
|---------|-------|-----------|
| Recipe values, tiers, stations, sources | `craftingData.js` | Changes on game balance patches; no logic risk |
| Traversal, rounding, modifier application, cycle guard, bounds enforcement | `craftingCalculator.js` | Pure functions, no Discord.js, no network |
| Embed rendering, truncation, thousands separators, leftover display | `embedFormat.js` | Matches every other `data:*` formatter |
| Command registration, dispatch, autocomplete resolution | `commands.js` / `index.js` | Matches existing subcommand pattern |

## Explicitly Out of Scope

- No new adapter route, no new database table, no new environment variable
  — this holds even after this revision's shortfall/on-hand/duration
  additions, since every `on-hand-N-quantity` is operator-typed, not read
  from any live system. Reading real inventory data live is Phase 2, a
  separate, not-yet-designed effort (see `calculator-design.md`'s
  Phasing note).
- No new npm dependency — expressible entirely in existing `discord.js` +
  plain JS.
- Deep Desert Discount and Refining Contract modifiers — verified
  structurally not applicable / non-functional; see
  [Design §Modifiers](calculator-design.md#modifiers--verified-scope).
- `scripts/api-security-test.js` (DAST) does not need new coverage: it only
  exercises adapter HTTP endpoints via `createMockAdapterServer()`; the
  calculator makes zero adapter calls and is structurally out of that
  suite's scope — unchanged by this revision, since it's still zero adapter
  calls.
- Persisted goals/progress tracking (Phase 3) — every `on-hand-N` value is
  supplied fresh per invocation and never stored.

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
