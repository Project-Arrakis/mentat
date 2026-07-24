# Implementation Prompt — Crafting Calculator

This is a ready-to-run prompt for a future implementation session (targeting
Claude Sonnet 5 or equivalent). Paste the section below the divider directly
as the task prompt. It intentionally does not re-derive requirements — it
points at the three companion documents as the source of truth so the
implementation session cannot silently drift from the agreed design.

**Revision note:** this prompt supersedes an earlier draft that (a)
undercounted the item set as 16 instead of 15 craftable items, (b) modeled
each item with a single flat recipe instead of per-tier `variants`, and (c)
proposed two crafting-modifier options (Deep Desert Discount, Refining
Contract) that were later proven — by directly reading the reference site's
own compiled application code — to either never apply to this item category
or be non-functional even on the reference site itself. This revision
reflects the fully re-verified dataset and formula. Do not reintroduce the
dropped modifiers without new evidence.

---

## Task

Implement `/dune data calculator` in `Arrakis-Control-Panel` exactly as
specified in these three documents, which you must read in full before
writing any code:

1. `docs/calculator-design.md` — command shape, response embed layout,
   autocomplete behavior, error UX, modifier scope decision.
2. `docs/calculator-architecture.md` — file layout, data/logic separation,
   the verified reference algorithm (ceiling rounding, cost-factor scoping,
   batch/leftover logic), per-tier `variants` data shape, cycle-guard
   requirement, autocomplete wiring note.
3. `docs/calculator-security-review.md` — required bounds enforcement
   (FINDING-CALC-1), required structural `source` field on every recipe
   variant (FINDING-CALC-3), cooldown-reuse requirement (FINDING-CALC-4).

Also read `docs/calculator-grc.md` for the required recipe-data attribution
comment and the `docs/changes/` note you must add.

Do not redesign the command shape, response format, file layout, or
modifier scope described in those documents. If you believe something in
them is wrong, stop and ask before deviating — do not silently implement
something different.

## Scope Boundary (hard constraint)

This work is scoped **entirely to the `Arrakis-Control-Panel` repository**.
Do not modify, reference, or add any code, table, or route in
`dune-awakening-selfhost-docker` (Core) or `acp-landing`. This feature makes
zero adapter calls and zero database calls by design — if your implementation
needs either, stop and flag it, because that means the design has been
misunderstood.

## Recipe Data — Use Exactly These 15 Items

Transcribe the recipe table below into `src/craftingData.js` using the
per-tier `variants` shape shown in `docs/calculator-architecture.md`. Every
**variant** (not just every item) must include a `source: { url,
verifiedAt }` field. All data below was verified directly against
individual item pages on https://dune.gaming.tools on 2026-07-24 — use that
exact date in `verifiedAt` unless you re-verify against the live site
yourself, in which case use your own verification date and note the
re-verification in the `docs/changes/` note you add.

**Important:** some items have 3 tiers, some have 2, some have only 1. Do
**not** fabricate a missing tier by guessing or interpolating — an item with
only a `medium` variant must have no `small` or `large` key at all, and the
calculator must return an explicit "no variant at this tier" error if a
user requests one. This was independently confirmed against the reference
site's own structured placeable data: **Chemical Refinery has no Large tier
in this game at all** (only Small/Medium exist), which is why several items
below have no `large` row.

### `copper_ingot` — Copper Ingot (Tier 1)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/copperbar

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `large` | Large Ore Refinery | 3s | Copper Ore ×2 |
| `medium` | Medium Ore Refinery | 4s | Copper Ore ×3 |
| `small` | Small Ore Refinery | 5s | Copper Ore ×4 |

### `iron_ingot` — Iron Ingot (Tier 2)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/ironbar

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `large` | Large Ore Refinery | 5s | Water ×25, Iron Ore ×3 |
| `medium` | Medium Ore Refinery | 7s | Water ×25, Iron Ore ×4 |
| `small` | Small Ore Refinery | 10s | Water ×25, Iron Ore ×5 |

### `steel_ingot` — Steel Ingot (Tier 3)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/steelbar

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `large` | Large Ore Refinery | 3s | Water ×50, Carbon Ore ×2, Iron Ingot ×1 *(craftable → `iron_ingot`)* |
| `medium` | Medium Ore Refinery | 4s | Water ×50, Carbon Ore ×3, Iron Ingot ×1 *(craftable → `iron_ingot`)* |
| `small` | Small Ore Refinery | 5s | Water ×50, Carbon Ore ×4, Iron Ingot ×1 *(craftable → `iron_ingot`)* |

### `aluminum_ingot` — Aluminum Ingot (Tier 4)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/aluminiumbar
**No `small` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `large` | Large Ore Refinery | 20s | Water ×200, Aluminum Ore ×4 |
| `medium` | Medium Ore Refinery | 30s | Water ×200, Aluminum Ore ×7 |

### `duraluminum_ingot` — Duraluminum Ingot (Tier 5)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/duraluminumrod
**No `small` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `large` | Large Ore Refinery | 4s | Water ×500, Jasmium Crystal ×3, Aluminum Ingot ×1 *(craftable → `aluminum_ingot`)* |
| `medium` | Medium Ore Refinery | 5s | Water ×500, Jasmium Crystal ×4, Aluminum Ingot ×1 *(craftable → `aluminum_ingot`)* |

### `plastanium_ingot` — Plastanium Ingot (Tier 6)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/t6refinedresourcea
**No `small` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `large` | Large Ore Refinery | 20s | Water ×1250, Titanium Ore ×4, Stravidium Fiber ×1 *(craftable → `stravidium_fiber`)* |
| `medium` | Medium Ore Refinery | 30s | Water ×1250, Titanium Ore ×6, Stravidium Fiber ×1 *(craftable → `stravidium_fiber`)* |

### `stravidium_fiber` — Stravidium Fiber (Tier 6)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/t6refinedresourceb
**Only `medium` variant exists — no `small`, no `large` (Chemical Refinery has no Large tier in-game).**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 10s | Water ×100, Stravidium Mass ×3 |

### `cobalt_paste` — Cobalt Paste (Tier 3)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/cobaltbar
**No `large` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 10s | Water ×75, Erythrite Crystal ×2 |
| `small` | Small Chemical Refinery | 15s | Water ×75, Erythrite Crystal ×3 |

### `silicone_block` — Silicone Block (Tier 2)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/silicone
**No `large` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 10s | Water ×50, Flour Sand ×3 |
| `small` | Small Chemical Refinery | 15s | Water ×50, Flour Sand ×5 |

### `small_fuel_cell` — Small Vehicle Fuel Cell (Tier 1)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/fuelcanister
**No `large` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 10s | Fuel Cell ×20 |
| `small` | Small Chemical Refinery | 15s | Fuel Cell ×25 |

### `medium_fuel_cell` — Medium Vehicle Fuel Cell (Tier 3)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/fuelcanister_medium
**No `large` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 15s | Water ×15, Fuel Cell ×40 |
| `small` | Small Chemical Refinery | 20s | Water ×15, Fuel Cell ×45 |

### `large_fuel_cell` — Large Vehicle Fuel Cell (Tier 4)

**Output per craft:** 1
**Source:** https://dune.gaming.tools/items/fuelcanister_large
**Only `medium` variant exists — no `small`, no `large`.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 15s | Water ×30, Fuel Cell ×80 |

### `spice_fuel_cell` — Spice-infused Fuel Cell (Tier 6)

**Output per craft:** 10 *(not 1 — this item batches; `crafts = ceil(requested / 10)`)*
**Source:** https://dune.gaming.tools/items/spicedfuelcell
**Only `medium` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 30s | Water ×200, Fuel Cell ×30, Spice Residue ×48, Irradiated Slag ×2 |

### `low_grade_lubricant` — Low-grade Lubricant (Tier 3)

**Output per craft:** 5 *(not 1)*
**Source:** https://dune.gaming.tools/items/windturbinelubricant1
**No `large` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 15s | Water ×4, Fuel Cell ×1, Silicone Block ×1 *(craftable → `silicone_block`)* |
| `small` | Small Chemical Refinery | 20s | Water ×4, Fuel Cell ×2, Silicone Block ×1 *(craftable → `silicone_block`)* |

### `industrial_lubricant` — Industrial-grade Lubricant (Tier 5)

**Output per craft:** 10 *(not 1)*
**Source:** https://dune.gaming.tools/items/windturbinelubricant2
**No `large` variant exists.**

| Tier key | Station | Time | Inputs |
|---|---|---|---|
| `medium` | Medium Chemical Refinery | 30s | Water ×15, Fuel Cell ×6, Silicone Block ×4 *(craftable → `silicone_block`)*, Spice Residue ×5 |
| `small` | Small Chemical Refinery | 40s | Water ×15, Fuel Cell ×8, Silicone Block ×4 *(craftable → `silicone_block`)*, Spice Residue ×5 |

### Leaf resources (no recipe — gathered, model as plain strings with `craftable: false`)

Copper Ore, Iron Ore, Carbon Ore, Aluminum Ore, Titanium Ore, Jasmium
Crystal, Stravidium Mass, Erythrite Crystal, Flour Sand, Spice Residue,
Irradiated Slag, Water, and base **Fuel Cell** (an input to five different
downstream items above — model it once as a leaf, referenced by key from
each of those five recipes' `inputs`, not duplicated).

## Verified Calculation Formula (do not re-derive — port exactly)

This is not an original design — it is a direct, cited port of the
reference site's own algorithm (see `docs/calculator-architecture.md`
§Verified Reference Algorithm for the full decompiled source and citation).
Implement `craftingCalculator.js` to match this exactly:

```js
// Cost factor: ONLY the Crafting Contract modifier ever applies to this
// item set (Deep Desert Discount only affects placeables/buildables, which
// none of these 15 items are; Refining Contract is non-functional even on
// the reference site). Do not implement Deep Desert Discount or Refining
// Contract logic — see docs/calculator-design.md §Modifiers for the full
// evidence trail behind this decision.
function costFactor(craftingContractActive) {
  return craftingContractActive ? 0.75 : 1;
}

// Ceiling rounding, per ingredient, per SINGLE craft — applied BEFORE
// multiplying by the batch count.
function ingredientPerCraft(rawQuantity, craftingContractActive) {
  return Math.ceil(rawQuantity * costFactor(craftingContractActive));
}

// Batch count: always rounds UP. This can produce leftover units for the
// three items with outputPerCraft > 1 (spice_fuel_cell: 10,
// low_grade_lubricant: 5, industrial_lubricant: 10).
function craftsNeeded(requiredQuantity, outputPerCraft) {
  return Math.ceil(requiredQuantity / outputPerCraft);
}
```

**Worked example to validate your implementation against (must produce
exactly these numbers):**

`calculateCraftingPlan('plastanium_ingot', 25, { stationTier: 'large', craftingContract: false })` must produce:
- 25 crafts, direct inputs: Water 31,250; Titanium Ore 100; Stravidium Fiber 25 (craftable)
- Nested Stravidium Fiber ×25 (medium tier, its only variant): 25 crafts, Water 2,500; Stravidium Mass 75
- Total raw materials: Water 33,750; Titanium Ore 100; Stravidium Mass 75
- Total time: 25×20 + 25×10 = 750s

`calculateCraftingPlan('plastanium_ingot', 25, { stationTier: 'large', craftingContract: true })` must produce:
- Direct inputs: Water `ceil(1250*0.75)=938` × 25 = 23,450; Titanium Ore `ceil(4*0.75)=3` × 25 = 75; Stravidium Fiber 25 (craftable — the fiber's own *count* isn't cost-factored, only its *ingredients* are, since Crafting Contract discounts ingredient quantities, not intermediate-item counts)
- Nested Stravidium Fiber ×25: Water `ceil(100*0.75)=75` × 25 = 1,875; Stravidium Mass `ceil(3*0.75)=3` (unchanged due to ceiling — 3*0.75=2.25→ceil=3) × 25 = 75
- Total raw water: 23,450 + 1,875 = 25,325

`calculateCraftingPlan('low_grade_lubricant', 12, {})` (output ×5/craft) must produce:
- `crafts = ceil(12/5) = 3`, `totalOut = 15`, `leftover = 3`

If your implementation does not reproduce these exact numbers, it does not
match the verified formula — do not adjust the expected numbers to match a
different implementation; find and fix the implementation bug instead.

## Files to Create

- `src/craftingData.js`
- `src/craftingCalculator.js`
- `test/craftingData.test.js`
- `test/craftingCalculator.test.js`

## Files to Modify

- `src/commands.js` — add the `data:calculator` subcommand (`SlashCommandBuilder`
  with `item` autocomplete string option, `quantity` integer option with
  `setMinValue(1)`/`setMaxValue(10000)`, optional `station-tier` choice
  option restricted per-item at validation time — not all items support all
  three tiers, see the per-item table above — and optional
  `crafting-contract` boolean option), the dispatch case, and a new
  autocomplete-interaction handler.
- `src/index.js` — add the missing `AutocompleteInteraction` branch to the
  `Events.InteractionCreate` handler (currently only
  `ChatInputCommandInteraction` is handled — confirm this before assuming
  the branch already exists).
- `src/embedFormat.js` — add `formatCalculatorEmbed()` following the existing
  `formatXEmbed()` pattern, including thousands-separator formatting, the
  existing `.slice(...)` truncation convention for field values, an explicit
  "Crafting Contract active (-25% materials)" footer line when the modifier
  is set, and a leftover-units line when applicable.
- `docs/user-guide.md` — document the new command under the existing `data`
  command group section.
- `docs/changes/PR-####-crafting-calculator.md` — new change note following
  the structure in `docs/changes/PR-0091-upstream-feedback-resolution.md`
  (`# PR Change Summary — <Title>` → `## Addressed Items` →
  `### N. <subsection> ✅` blocks with Problem/Solution/Commands/Implementation
  Details). Use the actual PR number once opened; also add a row to
  `docs/changes/README.md`'s index table.

## Required Behavior (do not skip any of these)

1. `quantity` bound (1–10,000) enforced both by the Discord option
   (`setMinValue`/`setMaxValue`) **and** independently inside
   `calculateCraftingPlan()` — do not rely on Discord's client-side
   enforcement alone. This is FINDING-CALC-1 from the security review and is
   required, not optional.
2. Recursion into nested recipes (`craftable: true` inputs) must use a
   cycle-safe visited-set walk (see `docs/calculator-architecture.md`
   §Traversal Design) — throw a typed, catchable "circular dependency
   detected" error if a cycle is ever encountered. Do not hardcode a
   "max depth 1" limit; the guard must be general, even though no cycle
   exists in today's 15-item dataset.
3. Unknown `item` key: typed, catchable error — never an unhandled exception
   or a fabricated recipe. Must match the existing `formatError()`
   convention already used in `commands.js`'s catch-all error handling.
4. `station-tier` with no known variant for the requested item (per the
   per-item availability table above): explicit "no recipe variant at this
   tier — available tiers: X, Y" result — never a silent fallback to a
   different tier's numbers.
5. `calculateCraftingPlan()` must return a structured plan object
   (`{ directInputs, nestedCrafts, totalRawMaterials, totalTimeSeconds,
   leftover }`), not a pre-formatted string — formatting belongs in
   `embedFormat.js` only, so the calculation function stays unit-testable
   without Discord.js.
6. The calculator subcommand must reuse the **existing** cooldown mechanism
   (`cooldown.js`'s `checkCooldown`/`applyCooldown`) at the same tier as
   other `data:*` read-only commands. Do not introduce a new cooldown
   namespace or a stricter limit for this command.
7. Every recipe **variant** in `CRAFTING_RECIPES` must include a `source: {
   url, verifiedAt }` field. Add a data-integrity test that fails if any
   variant is missing this field.
8. Do **not** implement Deep Desert Discount or Refining Contract as
   options anywhere — they are a verified permanent scope exclusion, not a
   deferred feature. If you find yourself tempted to add them "for
   completeness," stop and re-read `docs/calculator-design.md` §Modifiers.
9. Add the attribution comment specified in `docs/calculator-grc.md` at the
   top of `src/craftingData.js`.

## Test Plan (must implement all three layers)

Follow this repo's existing `node --test` convention (`scripts/run-tests.js`
runner, see `package.json`'s `test`/`check` scripts) — no new test framework.

1. **`test/craftingData.test.js`** (data-integrity layer):
   - Every recipe's `inputs` (across every variant) resolve to either a
     known leaf resource or another known recipe key — no dangling
     references.
   - No recipe has a zero or negative `quantity` anywhere.
   - No recipe recurses in a cycle (assert the dependency-graph assumption
     from `docs/calculator-architecture.md` — don't just trust it).
   - Every variant has a `source.url` and `source.verifiedAt` field.
   - Every item's declared `variants` keys are a subset of `{small, medium,
     large}` and match the per-item availability table above exactly (e.g.
     `aluminum_ingot` must have exactly `{medium, large}`, never `small`).

2. **`test/craftingCalculator.test.js`** (pure-function unit layer, no
   Discord.js, no network):
   - Non-nested recipe (Copper Ingot ×5, large tier) produces the exact
     expected flat multiplication: 5 crafts, Copper Ore ×10.
   - Nested recipe (Plastanium Ingot ×25, large tier, no contract) matches
     the worked example above **exactly**: Water 33,750 total, Titanium Ore
     100, Stravidium Mass 75, time 750s.
   - Same recipe **with** `craftingContract: true` matches the second
     worked example exactly: total raw water 25,325 — this specifically
     tests that ceiling rounding is applied per-ingredient-per-craft, not
     to the final total, and that one ingredient (Stravidium Mass) is
     unaffected by the modifier due to rounding while another (Water) is
     visibly reduced.
   - Multi-output recipe (Low-grade Lubricant ×12, output ×5/craft)
     produces `crafts=3, totalOut=15, leftover=3` exactly, per the worked
     example.
   - `quantity` boundary tests: exactly 1 and exactly 10000 succeed; 0,
     negative, 10001, non-integer, and non-numeric all reject with a typed
     error (never an unhandled `TypeError`/`NaN` propagating outward).
   - Unknown item key rejects with a typed, catchable error.
   - `stationTier` requesting a tier with no known variant for a given item
     (e.g. `small` for `plastanium_ingot`, or `large` for any Chemical
     Refinery item) returns the explicit "no variant" result, not a silent
     fallback.
   - A synthetic circular-dependency fixture (constructed only within the
     test file, not added to real `craftingData.js`) confirms the cycle
     guard throws rather than hanging or stack-overflowing.

3. **Integration test** — extend `test/discord-bot-test-harness.js`'s
   existing "Command Execution" suite (same pattern already used for other
   `data:*` subcommands) to exercise the full `commands.js` dispatch path
   with a mocked interaction, asserting the embed is built and sent, without
   requiring a live Discord gateway connection.

**Do not add calculator coverage to `scripts/api-security-test.js`** — that
suite exercises adapter HTTP endpoints only via `createMockAdapterServer()`;
this feature makes zero adapter calls and is out of that suite's scope by
design (confirmed in `docs/calculator-architecture.md`).

## Verification Before Opening a PR

Run, and confirm all pass, before committing:

```bash
npm run check
npm audit --audit-level=moderate
semgrep scan --config p/default --config p/secrets --error --severity ERROR --severity WARNING --exclude node_modules --exclude .git --exclude package-lock.json .
```

If pre-commit is installed locally, `pre-commit run --all-files` should also
pass cleanly (`gitleaks`, `ggshield`, `semgrep`, lint, test-suite, build —
see `docs/security-gates.md`).

## PR Requirements

- Open the PR against `main` from a new feature branch (this repo is not a
  fork — there is no upstream remote, so `yacketrj/Arrakis-Control-Panel:main`
  is the only valid target).
- Use `.github/PULL_REQUEST_TEMPLATE.md` for the PR body.
- Include the new `docs/changes/PR-####-crafting-calculator.md` note (use the
  real PR number once GitHub assigns it) and its `docs/changes/README.md`
  index row.
- Reference `docs/calculator-design.md`, `docs/calculator-architecture.md`,
  `docs/calculator-security-review.md`, and `docs/calculator-grc.md` in the
  PR description as the design record this implementation follows.

## Sources

- `docs/calculator-design.md`
- `docs/calculator-architecture.md`
- `docs/calculator-security-review.md`
- `docs/calculator-grc.md`
- `docs/changes/PR-0091-upstream-feedback-resolution.md` — change-note format
  precedent
- `docs/security-gates.md` — CI gate policy
</content>
