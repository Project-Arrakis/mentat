# Implementation Prompt — Crafting Calculator

This is a ready-to-run prompt for a future implementation session (targeting
Claude Sonnet 5 or equivalent). Paste the section below the divider directly
as the task prompt. It intentionally does not re-derive requirements — it
points at the three companion documents as the source of truth so the
implementation session cannot silently drift from the agreed design.

---

## Task

Implement `/dune data calculator` in `Arrakis-Control-Panel` exactly as
specified in these three documents, which you must read in full before
writing any code:

1. `docs/calculator-design.md` — command shape, response embed layout,
   autocomplete behavior, error UX.
2. `docs/calculator-architecture.md` — file layout, data/logic separation,
   the illustrative `craftingData.js`/`craftingCalculator.js` shapes,
   dependency-graph/recursion-depth constraint, autocomplete wiring note.
3. `docs/calculator-security-review.md` — required bounds enforcement
   (FINDING-CALC-1), required structural `source` field on every recipe
   (FINDING-CALC-3), and the cooldown-reuse requirement (FINDING-CALC-4).

Also read `docs/calculator-grc.md` for the required recipe-data attribution
comment and the `docs/changes/` note you must add.

Do not redesign the command shape, response format, or file layout described
in those documents. If you believe something in them is wrong, stop and ask
before deviating — do not silently implement something different.

## Scope Boundary (hard constraint)

This work is scoped **entirely to the `Arrakis-Control-Panel` repository**.
Do not modify, reference, or add any code, table, or route in
`dune-awakening-selfhost-docker` (Core) or `acp-landing`. This feature makes
zero adapter calls and zero database calls by design — if your implementation
needs either, stop and flag it, because that means the design has been
misunderstood.

## Recipe Data — Use Exactly These 16 Items

Transcribe the recipe table below into `src/craftingData.js` using the shape
shown in `docs/calculator-architecture.md`. Every entry must include a
`source: { url, verifiedAt }` field. All data below was verified against
https://dune.gaming.tools/crafting-calculator on 2026-07-23 — use that exact
date in `verifiedAt` unless you re-verify against the live site yourself, in
which case use your own verification date and note the re-verification in
the `docs/changes/` note you add.

| Key | Display Name | Tier | Station | Inputs (per craft) | Output Qty | Craft Time |
|---|---|---|---|---|---|---|
| `copper_ingot` | Copper Ingot | 1 | Large Ore Refinery | Copper Ore ×2 | 1 | 3s |
| `iron_ingot` | Iron Ingot | 2 | Large Ore Refinery | Water ×25, Iron Ore ×3 | 1 | 5s |
| `steel_ingot` | Steel Ingot | 3 | Large Ore Refinery | Water ×50, Carbon Ore ×2, Iron Ingot ×1 (craftable) | 1 | 3s |
| `aluminum_ingot` | Aluminum Ingot | 4 | Large Ore Refinery | Water ×200, Aluminum Ore ×4 | 1 | 20s |
| `duraluminum_ingot` | Duraluminum Ingot | 5 | Large Ore Refinery | Water ×500, Jasmium Crystal ×3, Aluminum Ingot ×1 (craftable) | 1 | 4s |
| `plastanium_ingot` | Plastanium Ingot | 6 | Large Ore Refinery | Water ×1250, Titanium Ore ×4, Stravidium Fiber ×1 (craftable) | 1 | 20s |
| `stravidium_fiber` | Stravidium Fiber | 6 | Medium Chemical Refinery | Water ×100, Stravidium Mass ×3 | 1 | 10s |
| `cobalt_paste` | Cobalt Paste | 3 | Medium Chemical Refinery | Water ×75, Erythrite Crystal ×2 | 1 | 10s |
| `silicone_block` | Silicone Block | 2 | Medium Chemical Refinery | Water ×50, Flour Sand ×3 | 1 | 10s |
| `small_fuel_cell` | Small Vehicle Fuel Cell | 1 | Medium Chemical Refinery | Fuel Cell ×20 | 1 | 10s |
| `medium_fuel_cell` | Medium Vehicle Fuel Cell | 3 | Medium Chemical Refinery | Water ×15, Fuel Cell ×40 | 1 | 15s |
| `large_fuel_cell` | Large Vehicle Fuel Cell | 4 | Medium Chemical Refinery | Water ×30, Fuel Cell ×80 | 1 | 15s |
| `spice_fuel_cell` | Spice-infused Fuel Cell | 6 | Medium Chemical Refinery | Water ×200, Fuel Cell ×30, Spice Residue ×48, Irradiated Slag ×2 | 10 | 30s |
| `low_grade_lubricant` | Low-grade Lubricant | 3 | Medium Chemical Refinery | Water ×4, Fuel Cell ×1, Silicone Block ×1 (craftable) | 5 | 15s |
| `industrial_lubricant` | Industrial-grade Lubricant | 5 | Medium Chemical Refinery | Water ×15, Fuel Cell ×6, Silicone Block ×4 (craftable), Spice Residue ×5 | 10 | 30s |

Note: `industrial_lubricant` and `low_grade_lubricant` are the "Industrial
Lubricant" and "Low-grade Lubricant" from the original request.
`small_fuel_cell`/`medium_fuel_cell`/`large_fuel_cell` are the "Small/Medium/
Large Fuel Cells." Base `Fuel Cell` and all named raw resources (Copper Ore,
Iron Ore, Carbon Ore, Aluminum Ore, Titanium Ore, Jasmium Crystal, Stravidium
Mass, Erythrite Crystal, Flour Sand, Spice Residue, Irradiated Slag, Water)
are leaf resources with no recipe of their own — model them as plain strings
in the `inputs` array (`craftable: false`), not as entries in
`CRAFTING_RECIPES`.

`Medium`/`Small` station-tier variants: only add an `alternateStations` entry
where you can independently verify a real variant exists on the reference
site (e.g. re-check the live site yourself rather than guessing). Where a
tier variant does not exist for an item (confirmed on the reference site at
verification time), `calculateCraftingPlan()` must return an explicit
"no variant at this tier" result rather than fabricating one — this is a
hard design requirement, not a suggestion.

## Files to Create

- `src/craftingData.js`
- `src/craftingCalculator.js`
- `test/craftingData.test.js`
- `test/craftingCalculator.test.js`

## Files to Modify

- `src/commands.js` — add the `data:calculator` subcommand (`SlashCommandBuilder`
  with `item` autocomplete string option, `quantity` integer option with
  `setMinValue(1)`/`setMaxValue(10000)`, optional `station-tier` choice
  option), the dispatch case, and a new autocomplete-interaction handler.
- `src/index.js` — add the missing `AutocompleteInteraction` branch to the
  `Events.InteractionCreate` handler (currently only
  `ChatInputCommandInteraction` is handled — confirm this before assuming
  the branch already exists).
- `src/embedFormat.js` — add `formatCalculatorEmbed()` following the existing
  `formatXEmbed()` pattern, including thousands-separator formatting and the
  existing `.slice(...)` truncation convention for field values.
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
2. Recursion into nested recipes (`craftable: true` inputs) must go exactly
   one level deep and must throw a typed, catchable error if it ever detects
   a second level of nesting — do not write an unbounded/naive recursive
   walk "because the current data happens to be shallow."
3. Unknown `item` key: typed, catchable error — never an unhandled exception
   or a fabricated recipe. Must match the existing `formatError()`
   convention already used in `commands.js`'s catch-all error handling.
4. `station-tier` with no known variant for the requested item: explicit
   "no recipe variant at this tier" result — never a silent fallback to a
   different tier's numbers.
5. `calculateCraftingPlan()` must return a structured plan object
   (`{ directInputs, nestedCrafts, totalRawMaterials, totalTimeSeconds }`),
   not a pre-formatted string — formatting belongs in `embedFormat.js` only,
   so the calculation function stays unit-testable without Discord.js.
6. The calculator subcommand must reuse the **existing** cooldown mechanism
   (`cooldown.js`'s `checkCooldown`/`applyCooldown`) at the same tier as
   other `data:*` read-only commands. Do not introduce a new cooldown
   namespace or a stricter limit for this command.
7. Every entry in `CRAFTING_RECIPES` must include a `source: { url,
   verifiedAt }` field. Add a data-integrity test that fails if any entry is
   missing this field.
8. Add the attribution comment specified in `docs/calculator-grc.md` at the
   top of `src/craftingData.js`.

## Test Plan (must implement all three layers)

Follow this repo's existing `node --test` convention (`scripts/run-tests.js`
runner, see `package.json`'s `test`/`check` scripts) — no new test framework.

1. **`test/craftingData.test.js`** (data-integrity layer):
   - Every recipe's `inputs` resolve to either a known leaf resource or
     another known recipe key — no dangling references.
   - No recipe has a zero or negative `quantity` anywhere.
   - No recipe recurses beyond depth 1 (assert the dependency-graph
     assumption from `docs/calculator-architecture.md`, don't just trust it).
   - Every recipe has a `source.url` and `source.verifiedAt` field.

2. **`test/craftingCalculator.test.js`** (pure-function unit layer, no
   Discord.js, no network):
   - Non-nested recipe (Copper Ingot ×5) produces the exact expected flat
     multiplication.
   - Nested recipe (Plastanium Ingot ×1) correctly separates direct inputs
     (Titanium Ore, Water, "1 Stravidium Fiber — craftable") from the nested
     craft's own inputs (Water, Stravidium Mass), and `totalRawMaterials`
     correctly sums Water contributions from both levels without
     double-counting or dropping either.
   - `quantity` boundary tests: exactly 1 and exactly 10000 succeed; 0,
     negative, 10001, non-integer, and non-numeric all reject with a typed
     error (never an unhandled `TypeError`/`NaN` propagating outward).
   - Unknown item key rejects with a typed, catchable error.
   - `stationTier` requesting a tier with no known variant for a given item
     returns the explicit "no variant" result, not a silent fallback.

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
