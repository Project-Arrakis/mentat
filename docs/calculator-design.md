# Crafting Calculator — Design

## Overview

`/dune data calculator` answers "how much do I need to gather/craft N of item
Y" for the resource-chain items players ask about most: Plastanium,
Duraluminum, Aluminum, Steel, Iron, Copper, Silicone, Stravidium Fiber, Cobalt
Paste, Spice-infused Fuel Cells, Industrial Lubricant, Small/Medium/Large
Vehicle Fuel Cells, and Low-grade Lubricant — **15 distinct craftable items**
(the base "Fuel Cell" itself is a gathered leaf resource, not a 16th craft
recipe, despite appearing in the original 16-name request as an ingredient
of several fuel-cell items).

The bot is currently a read-only observability tool with no crafting-math
capability. Players already use a third-party site
([dune.gaming.tools/crafting-calculator](https://dune.gaming.tools/crafting-calculator))
for this. This feature reproduces the same recipe-tree math inside Discord
for these 15 items, removing the context switch, without adding any new
adapter call, database write, or permission tier.

This is **status quo for how the bot already ships bundled reference data** —
the same category as `embedFormat.js` faction theming or `core:help` text:
versioned in this repo, reviewed like code because it is code.

**Data provenance note:** all recipe values in this document were verified
directly against live item pages on the reference site, and the calculation
formula itself (rounding rule, modifier scope, batch/leftover logic) was
verified by decompiling the reference site's own client-side application
bundle (`app.DwUuazv4.js`), not guessed from UI copy. See
[Architecture §Verified Reference Algorithm](calculator-architecture.md#verified-reference-algorithm)
for the exact decompiled source and citation.

## Command Shape

```
/dune data calculator item:<autocomplete> quantity:<integer, 1-10000, default 1> [station-tier:<Large|Medium|Small, default Large>] [crafting-contract:<boolean, default false>]
```

| Option | Type | Required | Bounds |
|--------|------|----------|--------|
| `item` | string (autocomplete) | yes | must resolve to one of the 15 known recipe keys |
| `quantity` | integer | no (default 1) | `setMinValue(1)` / `setMaxValue(10000)` |
| `station-tier` | string choice | no (default `Large`) | `Large`, `Medium`, `Small` — only tiers with a **confirmed real recipe variant** for the selected item are offered/honored (see the per-item tier table below; most items do **not** have all three) |
| `crafting-contract` | boolean | no (default `false`) | Applies the verified -25% ingredient-quantity reduction (see §Modifiers below) |

**Why autocomplete instead of `.addChoices()`:** 15 items fits Discord's
25-choice cap today, but autocomplete resolves from the same static recipe
table used for calculation, so there is exactly one source of truth. Adding
another item later does not require touching a choice list separately from
the data.

**Why only one modifier option:** the reference site exposes three toggles
("Deep Desert Discount", "Crafting Contract", "Refining Contract"), but only
**Crafting Contract** ever affects any of these 15 items. See §Modifiers
below for the full evidence and reasoning — this is a deliberate, verified
scope decision, not an oversight.

## Recipe Data — Verified Tier Availability

All figures below were confirmed directly against individual item pages on
the reference site. "✅" means a real recipe variant exists at that station
size; a blank cell means **no such variant exists in the game** — this is
not a data-collection gap, it was independently confirmed by an absence of
a "Large Chemical Refinery" placeable tier anywhere in the reference site's
own structured item database (Chemical Refinery has only Small/Medium tiers
in-game; Ore Refinery has all three).

| Item | Tier | Small | Medium | Large | Output/Craft |
|---|---|:-:|:-:|:-:|:-:|
| Copper Ingot | 1 | ✅ | ✅ | ✅ | 1 |
| Iron Ingot | 2 | ✅ | ✅ | ✅ | 1 |
| Steel Ingot | 3 | ✅ | ✅ | ✅ | 1 |
| Aluminum Ingot | 4 | — | ✅ | ✅ | 1 |
| Duraluminum Ingot | 5 | — | ✅ | ✅ | 1 |
| Plastanium Ingot | 6 | — | ✅ | ✅ | 1 |
| Stravidium Fiber | 6 | — | ✅ | — | 1 |
| Cobalt Paste | 3 | ✅ | ✅ | — | 1 |
| Silicone Block | 2 | ✅ | ✅ | — | 1 |
| Small Vehicle Fuel Cell | 1 | ✅ | ✅ | — | 1 |
| Medium Vehicle Fuel Cell | 3 | ✅ | ✅ | — | 1 |
| Large Vehicle Fuel Cell | 4 | — | ✅ | — | 1 |
| Spice-infused Fuel Cell | 6 | — | ✅ | — | 10 |
| Low-grade Lubricant | 3 | ✅ | ✅ | — | 5 |
| Industrial-grade Lubricant | 5 | ✅ | ✅ | — | 10 |

Notes:
- Ore-refined items (Copper/Iron/Steel/Aluminum/Duraluminum/Plastanium) use
  **Ore Refinery** stations. All others use **Chemical Refinery** stations.
- No item in this set has a "Large Chemical Refinery" variant because that
  placeable does not exist in the game (confirmed structurally, not just by
  absence on item pages — see Architecture doc).
- Spice-infused Fuel Cell, Low-grade Lubricant, and Industrial-grade
  Lubricant produce **more than 1 unit per craft** (10, 5, and 10
  respectively) — the calculator must account for this when computing
  batch counts (`crafts = ceil(requiredQuantity / outputPerCraft)`), not
  assume 1:1.

Full exact ingredient quantities per tier are in the
[Implementation Prompt](calculator-implementation-prompt.md)'s recipe table
— this document intentionally shows only tier *availability*, not every
number, to stay a design reference rather than a data dump.

## Modifiers — Verified Scope

The reference site exposes three toggles under its "Options" panel. Their
**actual behavior**, confirmed by reading the decompiled `_costFactor()`
function in the site's own compiled JS:

```js
_costFactor(item) {
  return this.deepDesert && (item.mainCategoryId === "placeables" || item.mainCategoryId === "buildables")
    ? 0.5
    : this.craftingContractActive && item.mainCategoryId === "items"
    ? 0.75
    : 1;
}
```

| Modifier | UI label | Real effect | In scope for this feature? |
|---|---|---|---|
| Deep Desert Discount | "-50% Materials" | Only applies to `placeables`/`buildables` (building/deployable construction costs) | **No** — all 15 items here are `items`-category refined resources; this modifier is structurally a no-op for every recipe in scope |
| Crafting Contract | "-25% Materials" | Applies to `items`-category ingredients: `Math.ceil(quantity * 0.75)` per ingredient, per craft | **Yes** — the only modifier that ever changes a number for these 15 items |
| Refining Contract | "-33% Time" | Tracked in application state but **never read by any calculation function** on the reference site itself — its own checkbox is rendered `disabled` in the live UI | **No** — non-functional even on the source it's copied from; including it here would be actively misleading |

**Decision: expose only `crafting-contract` as a boolean option.** Do not
add Deep Desert Discount or Refining Contract toggles — the first cannot
affect any of these 15 recipes by the reference site's own logic, and the
second does nothing anywhere, including in the tool it's copied from.

**Rounding rule (verified):** `Math.ceil(ingredientQuantity * factor)`,
applied **per ingredient, per single craft**, before multiplying by the
batch count. This is ceiling rounding, not floor or round-half-even — e.g.
Duraluminum's Jasmium Crystal at Large tier (3 per craft) under Crafting
Contract becomes `ceil(3 * 0.75) = ceil(2.25) = 3`, i.e. **no visible
reduction** for that specific ingredient at that specific quantity, even
though the modifier is active. This must be represented exactly, including
cases where the modifier appears to do nothing due to rounding — do not
"smooth" it into a fractional or floor-rounded number to make the UI look
more responsive to the toggle.

## Response Shape

One embed, following the existing `formatXEmbed()` convention in
`src/embedFormat.js`:

```
🧮 Crafting Calculator — 25× Plastanium Ingot
Station: Large Ore Refinery (Tier 6) · Craft time: 500s (25 batches × 20s)

📦 Direct Inputs (per this craft)
• Water              31,250
• Titanium Ore          100
• Stravidium Fiber       25   (craftable — see below)

🔧 Nested Craft: 25× Stravidium Fiber
Station: Medium Chemical Refinery (Tier 6) · Craft time: 250s
• Water               2,500
• Stravidium Mass        75

🗒️ Total Raw Materials to Gather
• Water              33,750
• Titanium Ore          100
• Stravidium Mass        75

⏱️ Total Craft Time: 750s (12m 30s) — assumes one refinery of each type, no parallelization
```

This exact example (Plastanium ×25, Large tier, no Crafting Contract) was
verified against the reference algorithm directly: 25 crafts × (1250 Water,
4 Titanium Ore, 1 Stravidium Fiber) = 31,250 / 100 / 25; nested Stravidium
Fiber ×25 = 25 crafts × (100 Water, 3 Stravidium Mass) = 2,500 / 75; combined
raw water = 33,750. All figures above are exact, not illustrative.

**With Crafting Contract active**, the same request recalculates to (per the
verified formula): Water 1250×0.75=937.5→ceil 938 per craft ×25 = 23,450
direct; Titanium Ore 4×0.75=3 exact ×25 = 75; nested Stravidium Fiber Water
100×0.75=75 exact ×25=1,875; combined raw water = 25,325. This is included
here specifically because it's a case where two different ingredients round
differently (one moves off its unrounded value, one doesn't) — the
implementation's test suite must cover this exact scenario.

Design rationale:

- **"Direct Inputs" / "Nested Craft" / "Total Raw Materials"** mirrors
  gaming.tools' own "Crafting Steps" + "Raw Materials" split. Reusing a UX
  pattern the community already recognizes reduces cognitive load — the goal
  is not to invent a new mental model for a problem already standardized on.
- Craft time is shown per-station **and** as a stated-assumption grand
  total ("assumes no parallelization") rather than omitted or silently
  guessed — an unstated assumption here reads as a bug report waiting to
  happen ("the time is wrong") the first time someone runs two refineries at
  once.
- Quantities use thousands separators (`31,250`, not `31250`) — Tier 6
  quantities routinely reach 5 figures, and separators are meaningfully
  easier to scan in a Discord embed.
- Nested crafts get their **own labeled sub-section**, not a flattened total.
  A player who already has 50 Stravidium Fiber in storage needs to see that
  intermediate line item to know they can skip that step.
- When `crafting-contract:true` is set, the embed footer must explicitly
  state `Crafting Contract active (-25% materials)` — silently changing
  numbers without restating the active modifier is a support-ticket
  generator waiting to happen.
- **Leftover/overproduction note:** because several items (Spice-infused
  Fuel Cell, both Lubricants) produce more than 1 unit per craft, a
  requested quantity that doesn't divide evenly into the output-per-craft
  produces **leftover units**. The reference algorithm itself surfaces this
  as a distinct "Leftovers" panel; the embed should show a
  `+N leftover (rounded up to whole crafts)` line whenever leftover > 0,
  rather than silently rounding the displayed total-output number.

## Autocomplete Behavior

- Case-insensitive substring match on the 15 known item display names.
- Returns up to Discord's 25-suggestion cap, sorted by tier then name.
- Typing `fuel` surfaces all three Vehicle Fuel Cells plus Spice-infused Fuel
  Cell; typing `lub` surfaces both lubricants — this directly serves the
  ambiguous-naming problem in the original request ("fuel cells" as one
  conceptual group of several distinct items).

## Error UX

| Condition | Response |
|-----------|----------|
| Unknown/free-typed item string (autocomplete bypassed) | Plain, non-embed error: `Unknown item: 'foo'. Try /dune data calculator and use the autocomplete suggestions.` — matches the existing `formatError()` catch-all convention in `commands.js`. Never fabricates a recipe. |
| `quantity` outside 1–10,000 | Rejected client-side by Discord's `setMinValue`/`setMaxValue`; never reaches the handler. Re-validated server-side regardless — see [Security Review](calculator-security-review.md) §DoS. |
| `station-tier` with no known recipe variant for the selected item (e.g. `Small` for Plastanium, or any tier for the several single-variant items) | Explicit "no recipe variant at this tier — available tiers: X, Y" message. Never silently falls back to a different tier's numbers. |

## Explicit Non-Goals (v1)

- Deep Desert Discount and Refining Contract toggles — verified to be a
  no-op and non-functional (respectively) for every item in this feature's
  scope; see §Modifiers above. Not a deferred feature, a permanent scope
  exclusion for this item set. Re-evaluate only if the item scope expands to
  include placeables/buildables (a much larger, separate effort).
- Landsraad contract *bonuses* beyond the single verified Crafting Contract
  ingredient-reduction mechanic (e.g. any Landsraad-specific discount tied
  to house standing) — not evidenced anywhere in the decompiled formula;
  do not add speculative additional modifiers.
- Every craftable item in the game — scoped exactly to the 15 items
  identified from the original request. Weapons/armor/vehicles/placeables
  have much deeper, more volatile dependency graphs and are a separate
  effort if ever requested.
- Persisting user calculation history — every invocation is stateless,
  matching the bot's existing no-new-writes posture for this command class.

## Sources

- [Architecture](calculator-architecture.md)
- [Security Review](calculator-security-review.md)
- [GRC Review](calculator-grc.md)
- [Implementation Prompt](calculator-implementation-prompt.md)
- Recipe data verified against individual item pages on
  https://dune.gaming.tools (crafting-calculator and per-item pages),
  2026-07-23 through 2026-07-24
- Modifier formula verified by decompiling
  `https://dune.gaming.tools/_app/immutable/nodes/10.Cx5T3nNJ.js` (the
  crafting-calculator route's compiled Svelte component), 2026-07-24
- `src/embedFormat.js` — existing formatter conventions
- `src/commands.js` — existing subcommand/dispatch pattern
</content>
