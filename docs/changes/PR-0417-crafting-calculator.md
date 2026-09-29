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
