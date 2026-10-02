# Crafting Calculator — Design

**Revision history:** This is a substantial redesign of the original v1
calculator (single-direction: quantity → total ingredients only), driven by
real operator use during this session. The original design's Command Shape,
Response Shape, Error UX, and Explicit Non-Goals sections are superseded by
this revision; the Overview, Recipe Data, Modifiers, Autocomplete, and
Sources sections below are unchanged and still authoritative. The original
design received a solo security+GRC review (`calculator-security-review.md`,
`calculator-grc.md`, both by a single reviewer, pre-implementation) — this
revision requires a full Eight-Hats Layer 1 audit (all eight hats, run as
independent dispatches) before implementation, matching the standard applied
elsewhere in this project, not a repeat of the solo-review pattern.

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

**Risk classification: LOW** (closing a Layer 1 GRC audit finding — this
was previously only implied by inheritance from the original v1 review's
"lowest risk feature category" language, never restated explicitly for
this revision). Blast radius: a bug produces a wrong number in a single
Discord response render, nothing more — no adapter call, no database
write, no persisted state, no new credential, confirmed independently by
five of eight Layer 1 audit hats (Network/Cloud Security/DBA reported zero
findings; Architect/Security confirmed zero blast radius beyond one
response). Not elevated to MEDIUM despite the real correctness findings
this audit found (target-item semantics, cross-level pooling, chain-aware
max-completable) — those are design-completeness/correctness gaps, fixed
in this same revision, not risk-surface expansions.

**Phasing note:** this feature is Phase 1 of a three-phase plan. Phase 1
(this document) is pure, stateless local math — no external calls, no
persisted state, identical risk posture to the original v1 design. Phase 2
(live stock integration — reading real on-hand quantities from a player's or
guild's actual game inventory via Core's existing storage-query routes) and
Phase 3 (persisted farming goals with progress tracking) are separate,
not-yet-designed efforts that build on Phase 1's recipe data and math but are
explicitly out of scope here — see Explicit Non-Goals below.

## Command Shape

```
/dune data calculator
  item:<autocomplete, one of 15 known recipe keys>
  quantity:<integer, 1-100000, default 1>
  [station-tier:<Large|Medium|Small, default: the item's own best available tier>]
  [crafting-contract:<boolean, default false>]
  [on-hand-1:<autocomplete, scoped to item's own recipe tree>] [on-hand-1-quantity:<integer, 0-100000>]
  [on-hand-2:<autocomplete>] [on-hand-2-quantity:<integer>]
  [on-hand-3:<autocomplete>] [on-hand-3-quantity:<integer>]
  [on-hand-4:<autocomplete>] [on-hand-4-quantity:<integer>]
  [on-hand-5:<autocomplete>] [on-hand-5-quantity:<integer>]
  [on-hand-6:<autocomplete>] [on-hand-6-quantity:<integer>]
  [station-count:<integer, 1-50, default 1>]
```

16 options total (4 base + 6 on-hand pairs + station-count), well under
Discord's 25-option-per-command cap.

| Option | Type | Required | Bounds |
|--------|------|----------|--------|
| `item` | string (autocomplete) | yes | must resolve to one of the 15 known recipe keys |
| `quantity` | integer | no (default 1) | `setMinValue(1)` / `setMaxValue(100000)` — raised from the original design's 10,000; see §Quantity Bound below for why this is safe |
| `station-tier` | string choice | no (default: the item's own best available tier, largest first — see below) | `Large`, `Medium`, `Small` — only tiers with a **confirmed real recipe variant** for the selected item are offered/honored (unchanged from v1 — see the per-item tier table below) |
| `crafting-contract` | boolean | no (default `false`) | Applies the verified -25% ingredient-quantity reduction (see §Modifiers below, unchanged from v1) |
| `on-hand-N` (1-6) | string (autocomplete) | no | must resolve to a node in the **chosen `item`'s own recipe tree** — the target item itself, any intermediate craftable in its chain, or any raw/leaf ingredient (including Water). Autocomplete options change based on which `item` is already selected (dependent/cascading autocomplete — see §Autocomplete Behavior). Each `on-hand-N` slot must name a *different* node; a duplicate is a validation error (see §Error UX). |

**Discord option description text (closing a Layer 1 UI/UX audit finding —
this was previously entirely unspecified):**
- `item`: "Which item are you calculating for?"
- `quantity`: "How many total do you need (your goal)?"
- `on-hand-1` through `on-hand-6`: **identical description text on every
  slot** — "Any ingredient you already have some of (slot order doesn't
  matter)." Making every slot's description literally the same string is
  deliberate: it's the cheapest possible way to tell a player up front that
  slot choice is arbitrary, without needing them to read this design doc.
- `on-hand-N-quantity`: "How much of that you currently have."
- `station-count`: "How many of that station type you're running at once
  (for the time estimate only — doesn't change any ingredient amount)."

**Command description (Discord shows this in the slash-command picker,
before any options are filled in) — closing the Layer 1 UI/UX audit's
"headline feature is undiscoverable" finding:** "Calculate crafting
requirements — optionally track a goal against what you already have on
hand." The word "goal" here is deliberate marketing for the feature this
whole revision exists for; a command description that only said "Crafting
calculator" (matching v1) would give a first-time user zero signal the
on-hand/shortfall capability exists at all.
| `on-hand-N-quantity` | integer | no (default 0 if `on-hand-N` is set without it) | `setMinValue(0)` / `setMaxValue(100000)` |
| `station-count` | integer | no (default 1) | `setMinValue(1)` / `setMaxValue(50)` — number of stations of the *relevant* type running in parallel, for the Duration line only (see §Duration below); has no effect on any ingredient quantity |

**Why 6 on-hand slots, not fewer:** verified exhaustively across all 15
items' full recipe trees (target item + every direct and nested ingredient,
Water included) that **Industrial-grade Lubricant has the deepest tree at 6
distinct nodes**: itself, Water, Fuel Cell, Silicone Block (nested
craftable), Spice Residue, and Flour Sand (Silicone Block's own raw
ingredient). No item in this set needs more than 6. Simpler items just leave
the extra slots unused.

**Why one unified command instead of separate forward/reverse/bottleneck
commands:** an earlier draft of this design split these into three modes.
That was wrong — it didn't answer the actual driving use case ("I want 10k
Duraluminum, here's what I already have, what's my shortfall") at all, since
none of forward-only, reverse-only, or a fixed two-ingredient bottleneck
comparison individually expresses "a goal plus partial credit across
multiple ingredients." A single command where `on-hand-N` values simply
reduce the computed requirement is strictly more general: zero `on-hand-N`
values reproduces the original v1 forward-only behavior exactly; one
`on-hand-N` value reproduces what the earlier draft called "reverse mode";
multiple values answers the real goal-tracking question without inventing a
second calculation model.

**Why autocomplete instead of `.addChoices()` (unchanged from v1):** 15
items fits Discord's 25-choice cap today, but autocomplete resolves from the
same static recipe table used for calculation, so there is exactly one
source of truth. Adding another item later does not require touching a
choice list separately from the data.

**Why only one modifier option (unchanged from v1):** the reference site
exposes three toggles ("Deep Desert Discount", "Crafting Contract",
"Refining Contract"), but only **Crafting Contract** ever affects any of
these 15 items. See §Modifiers below for the full evidence and reasoning —
this is a deliberate, verified scope decision, not an oversight.

## Quantity Bound

Raised from 10,000 to **100,000** at the operator's explicit request (real
use case: tracking a 25,000-unit Duraluminum farming goal). This is safe on
both axes the original `FINDING-CALC-1` security review checked:

- **Numeric safety:** worst case at the new cap — `100000 × 1250` (Plastanium's
  largest per-craft Water input) `≈ 1.25×10^8`, still many orders of
  magnitude below `Number.MAX_SAFE_INTEGER` (`≈9×10^15`). No overflow risk at
  100,000, or even substantially higher.
- **Embed-size safety:** a full worked example at real operator scale (25,000
  Duraluminum, Large tier) produces Water 17,500,000 *(25,000 × 500 = 12,500,000
  for the Duraluminum step, plus 25,000 × 200 = 5,000,000 for the nested
  Aluminum Ingot step; this figure was briefly changed to 15,000,000 on
  2026-09-28 based on a single in-game reading of Water ×400 for the
  Duraluminum step, then reverted the same day once a second independent
  source corroborated the original ×500 — see the revision note in
  [`calculator-implementation-prompt.md`](calculator-implementation-prompt.md)
  for the full evidence trail; ×400 remains unconfirmed)*, Jasmium
  Crystal 75,000, Aluminum Ore 100,000, plus the nested Aluminum Ingot line —
  five or six short comma-formatted lines, nowhere near Discord's 1024-char
  field or 6000-char total embed limits, even with this revision's added
  shortfall/max-completable/duration lines per node (see §Response Shape).

`FINDING-CALC-1`'s required mitigations (hard client-side bound, independent
server-side re-validation, defensive truncation) carry forward unchanged —
only the numeric bound itself changes, from 10,000 to 100,000, everywhere it
appears in this document and its siblings.

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

**Default-tier selection uses this exact table.** When `station-tier` is
omitted, the command defaults to the selected item's own best (largest)
available tier from this table — Large for the 6 Ore-Refinery items,
Medium for all 9 Chemical-Refinery items — rather than hard-defaulting to
Large and erroring for the 9 items that have never had one. An earlier
implementation pass hardcoded the "large" default without consulting this
already-documented table, so the plainest possible invocation
(`/dune data calculator item:Silicone Block`) failed immediately for 9 of
15 items despite the correct tier data already being known and recorded
here — fixed 2026-09-29 (independently re-verified live against
dune.gaming.tools' placeables listing the same day, confirming this
table's every row and the Large-Chemical-Refinery-doesn't-exist fact are
still accurate).

**Chained items (this revision's correction):** the original draft of this
revision assumed only three items chain through a nested craftable
(Steel/Duraluminum/Plastanium). Re-verified exhaustively against
`calculator-implementation-prompt.md`'s full recipe table — there are
**five**:

```
Steel Ingot                <- Iron Ingot          (all 3 tiers)
Duraluminum Ingot          <- Aluminum Ingot       (both tiers)
Plastanium Ingot           <- Stravidium Fiber     (both tiers)
Low-grade Lubricant        <- Silicone Block       (both tiers)
Industrial-grade Lubricant <- Silicone Block       (both tiers)
```

This matters directly for this revision: the shortfall/max-completable
calculation (§Shortfall & Bottleneck Calculation below) generalizes
identically to all five, not a hardcoded three — the calculation walks
whichever tree the chosen `item` actually has, so this is a data fact to get
right, not a special case in the traversal logic.

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

**Crafting Contract applies identically regardless of `on-hand-N` values.**
This revision's shortfall calculation always computes the full tree
requirement first, using exactly this same formula, then subtracts on-hand
credit afterward (see §Shortfall & Bottleneck Calculation) — there is only
ever one requirement-computation formula in this design, so there is no
separate "reverse-mode formula" that could apply the modifier inconsistently.

## Shortfall & Bottleneck Calculation

This is the core of this revision, replacing the original v1's
requirement-only output.

**Revision note (Layer 1 audit, 2026-09-28):** the first draft of this
section conflated two genuinely different kinds of on-hand credit —
"already-completed progress toward the goal" (additive) and "available
supply that gets consumed" (a constraint) — into one `min()`-based
formula, which the Architect and QA hats independently flagged as
producing a wrong answer for the target-item-itself case (5 of 25 already
done, plus enough ingredients on hand for 20 more from scratch, is 25
completable total, not `min(5, 20) = 5`). Rewritten below to resolve this
by construction, not by special-casing: target-item credit reduces the
*effective quantity* every other step operates on, so it never enters the
supply-constraint `min()` at all.

**Step 1 — resolve the effective quantity.** If `on-hand-N` names the
**target item itself** (e.g. "I already have 5,000 of my 25,000
Duraluminum goal"), subtract that from `quantity` to get
`effectiveQuantity = max(0, quantity − targetItemOnHand)`. If no
`on-hand-N` names the target item, `effectiveQuantity = quantity`
unchanged. The response always displays both the original `quantity`
(the stated goal) and `effectiveQuantity` (what's actually left to
produce) — this is not hidden, just not what the tree-walk math below
uses.

**Step 2 — compute the full tree requirement** for `effectiveQuantity` of
`item` at the chosen `station-tier` (and `crafting-contract` if set),
exactly as v1's forward-only calculation always did: walk the recipe tree
and compute the total required amount of every remaining node — the
target item's own remaining craft count, every direct ingredient, and (for
the five chained items) every ingredient of the nested craftable too.
**Pool requirements across every level of the tree into one number per
distinct resource — never track the same resource as separate per-level
figures.** This matters concretely for the five chained items: Water (and,
for the two Lubricants, Fuel Cell) appears in both the parent recipe and
its nested craftable's own recipe — these combine into one total per
resource, the same way v1's own "Total Raw Materials to Gather" section
already pooled them (see the plain worked example below, which has always
shown one combined Water figure, not two). This produces one number per
distinct ingredient/intermediate node in the tree, all against the pooled
total.

**Step 3 — apply ingredient on-hand credit.** For each remaining
`on-hand-N`/`on-hand-N-quantity` pair (i.e. every one that doesn't name the
target item, already consumed in Step 1):
- If `on-hand-N` names an **intermediate craftable** in the tree (e.g.
  Stravidium Fiber, Aluminum Ingot, Silicone Block): subtract the on-hand
  quantity from that node's own pooled requirement, floored at zero, and
  **cascade the reduction down**: fewer crafts of that intermediate needed
  means correspondingly fewer of *its own* ingredients are needed too,
  recomputed from the reduced craft count using the same per-ingredient
  ceiling-rounding formula as Step 2. This is a real recursive step, not
  just a leaf subtraction.
- If `on-hand-N` names a **raw/leaf ingredient directly — including one
  that sits underneath a nested craftable** (e.g. crediting Stravidium
  Mass directly for Plastanium, skipping the Stravidium Fiber
  intermediate; or Water, pooled per Step 2): subtract on-hand quantity
  from that leaf's own **pooled** total requirement, floored at zero. No
  cascading — it's a leaf — but the pooling from Step 2 means this
  correctly reduces demand contributed from every level at once, not just
  one.
- Any node **not** named in an `on-hand-N` slot is treated as zero on hand
  — the natural default, matching v1's behavior with no `on-hand-N` at
  all. Pure subtraction, never division or a lookup table, so there is no
  `0`-input failure mode to replicate from the reference spreadsheet this
  feature was partly inspired by (which had a live `#N/A` formula error on
  a zero input) — this design cannot reproduce that bug class.

**Step 4 — report three things, not a separate "mode":**
1. **Shortfall of every remaining node** after Step 3's credit — "what do I
   still need to gather/craft" for the stated goal.
2. **Max completable units of `item`**, combining both kinds of credit
   correctly: `maxCompletable = targetItemOnHand + min(supply-constrained
   completions from Step 3's remaining on-hand values)`, capped at the
   original `quantity` (never reported as more than what was actually
   asked for, even if on-hand supply could technically support more). The
   supply-constrained part — for each Step 3 on-hand value, divide
   available supply by that node's own per-target-unit ratio, accounting
   for chain depth exactly as Step 3's cascade does — is the same `min()`
   calculation the first draft used, just now applied only to genuine
   consumable-supply credits, never to target-item progress. If zero
   ingredient-level `on-hand-N` values are supplied (only a target-item
   value, or none at all), the supply-constrained term is treated as
   unbounded and `maxCompletable = targetItemOnHand` (or omitted entirely
   if there's no on-hand value of any kind — nothing to compute from).
3. Whichever node produced the minimum in (2) is named as the **bottleneck**
   — this subsumes the earlier draft's separate "bottleneck mode" entirely;
   comparing two on-hand quantities to find which is scarcer is just this
   same calculation with exactly two ingredient-level `on-hand-N` values
   supplied. Water is a first-class bottleneck candidate exactly like any
   other ingredient.

**Worked example — leaf-under-nested-craftable credit** (closing the Layer
1 audit's QA finding that this path had no numbers to test against):
`item: Plastanium Ingot, quantity: 25, on-hand-1: Stravidium Mass,
on-hand-1-quantity: 60`. Stravidium Mass is a leaf two levels down (under
Stravidium Fiber), never the intermediate itself. Step 2's pooled
Stravidium Mass requirement for 25 Plastanium is `25 × 3 = 75` (Stravidium
Fiber's own ratio, unchanged from the primary example). Step 3 subtracts
the 60 on hand: shortfall drops to `75 − 60 = 15` Stravidium Mass, but this
is a **leaf subtraction with no cascade** — it does *not* by itself reduce
the Stravidium Fiber or Plastanium craft counts, since having raw material
on hand isn't the same as already having it refined into the intermediate.
Max completable: `60 ÷ 3 = 20` Plastanium Ingot supportable by this
Stravidium Mass alone — naming Stravidium Mass as the bottleneck if no
other on-hand value is supplied, since 20 < 25 requested.

**Worked example — chain-aware max completable, the hardest case in this
design** (closing the Layer 1 audit's QA finding that this had zero
worked numbers anywhere): `item: Plastanium Ingot, quantity: 25,
on-hand-1: Stravidium Fiber, on-hand-1-quantity: 8, on-hand-2: Titanium
Ore, on-hand-2-quantity: 2000`. Two ingredient-level credits, one on an
intermediate (Stravidium Fiber, cascades) and one on a direct raw
ingredient (Titanium Ore, doesn't cascade — nothing sits under it). Per
node: Stravidium Fiber supports `8 ÷ 1 = 8` Plastanium Ingot (1:1 ratio at
Large tier); Titanium Ore supports `2000 ÷ 4 = 500` Plastanium Ingot.
`min(8, 500) = 8` — Stravidium Fiber is the bottleneck, `maxCompletable =
0 + 8 = 8` (no target-item credit supplied here), short 17 of the
requested 25. This demonstrates the chain-aware ratio calculation
end-to-end with an intermediate as the actual limiting node, not just the
simpler flat-ingredient case the original single example covered.

## Duration

New in this revision, still pure stateless math (no external calls). For
each *remaining* node after on-hand credit that still needs crafting,
report time-to-completion using that node's own per-craft time at the
chosen tier: `ceil(craftsRemaining / stationCount) × craftTimeSeconds`.

**Ore Refinery and Chemical Refinery times are reported separately, never
summed** — they are different physical stations that run in parallel
in-game, so a Plastanium request's Ore-Refinery time (the Plastanium craft
itself) and its nested Stravidium Fiber's Chemical-Refinery time are two
independent durations, not one combined total. `station-count` applies
per-station-type, not globally — if a future version needs independent
counts per station type, that's an additive change (more options), not
redesign.

**Single-station-type worked example** (closing a Layer 1 audit QA
finding — the only prior example, Plastanium, uses both station types and
never demonstrated the simpler common case): `item: Copper Ingot, quantity:
500` uses only Ore Refinery, no nested craft, no Chemical Refinery
involvement at all. The response shows exactly **one** Duration line —
`⏱️ Duration: Ore Refinery 1,500s (25m)` — never a second, inapplicable
`Chemical Refinery 0s` line. The rule is: only show a station-type line if
that station type has at least one node with remaining crafts > 0; a
station type with nothing to craft is omitted entirely, not shown as a
zero. This is the same "explain, don't show an unexplained number" rule
§Response Shape's shortfall section already applies, extended to Duration.

## Response Shape

One embed, following the existing `formatXEmbed()` convention in
`src/embedFormat.js`. Two full worked examples — plain (no on-hand, matches
v1 exactly) and with shortfall/max-completable (new):

**Plain request** (`item: Plastanium Ingot, quantity: 25`, no on-hand
values — reproduces v1's exact output):

```
🧮 Crafting Calculator — 25× Plastanium Ingot
Tier: Large Ore Refinery · Craft time: 500s (25 batches × 20s)

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

⏱️ Duration: Ore Refinery 500s (8m 20s) · Chemical Refinery 250s (4m 10s) — independent, run in parallel

💡 Tip: add on-hand-1 (and up to 5 more) to track a goal against what you
already have — see /dune data calculator's own description.
```

**New — discoverability footer (closing a Layer 1 UI/UX audit HIGH
finding):** the plain, zero-on-hand response always ends with the `💡 Tip`
line above. This is the single cheapest fix for "the headline feature is
undiscoverable" — a first-time user who only ever runs the plain form
still gets pointed at the goal-tracking capability directly in the
response they already see, not just in a command description they may
never read. Omitted only when at least one `on-hand-N` value was already
supplied (a user already using the feature doesn't need to be told it
exists).

**With on-hand values** (`item: Plastanium Ingot, quantity: 25`,
`on-hand-1: Titanium Ore, on-hand-1-quantity: 2000`, `on-hand-2: Stravidium
Fiber, on-hand-2-quantity: 10`):

**Corrected (final-review fix 5, 2026-09-29):** the example below previously
claimed "✅ ... all 25" and "Ore Refinery time is 0s" — both wrong against
the actual, audited behavior. Stravidium Fiber's on-hand credit is a hard
supply cap on chain-aware `maxCompletable` (see §Shortfall & Bottleneck
Calculation), not something that unlocks full completion once *some* of it
is on hand — with only 10 of the 25 needed on hand, at most 10 Plastanium
Ingot are completable, short 15. The block below is the real, rendered
output of `calculateCraftingPlan("plastanium_ingot", 25, { stationTier:
"large" })` → `applyOnHandCredit(plan, [{ node: "titanium_ore", quantity:
2000 }, { node: "stravidium_fiber", quantity: 10 }], { quantity: 25 })` →
`estimateDuration(...)` → `formatCalculatorEmbed(...)`, copied verbatim
(not hand-guessed) from a direct run against this exact scenario:

```
🧮 Crafting Calculator — 25× Plastanium Ingot (goal)
Tier: Large Ore Refinery
On hand: 2,000 Titanium Ore, 10 Stravidium Fiber

🗒️ Shortfall (after on-hand credit, pooled across every level)
• Stravidium Fiber    15 (10 on hand, 15 more needed)
• Water               32,750
• Titanium Ore        0 (2,000 on hand — fully covered)
• Stravidium Mass     45

🔧 Nested Craft: 15× Stravidium Fiber, Medium Chemical Refinery (see Shortfall above for ingredient amounts)

⚠️ You can complete at most 10 Plastanium Ingot with current Stravidium Fiber on hand — short 15.

⏱️ Duration: Ore Refinery 500s (8m 20s) · Chemical Refinery 250s (4m 10s)
```

Notes on this real output, for anyone hand-tracing the math:

- **Stravidium Fiber is the actual bottleneck, not Titanium Ore.** 2,000
  Titanium Ore fully covers the 100 needed (fully covered), but only 10 of
  the 25 Stravidium Fiber needed are on hand — `maxCompletable` reports the
  binding constraint (`limitingNode: "stravidium_fiber"`), capping
  completion at 10 even though Titanium Ore has plenty of headroom.
- **Water and Stravidium Mass carry zero on-hand credit** in this example
  (neither was supplied as an on-hand entry), so their Shortfall lines show
  the full pooled amount still needed (32,750 and 45 respectively) with no
  "on hand" qualifier.
- **The Nested Craft section shows only a header, not per-ingredient rows**
  (final-review fix 4) — its own ingredient amounts (Stravidium Mass) are
  already reported, correctly credited, in the Shortfall section above;
  repeating an uncredited/raw number here previously contradicted it.
- **Duration shows BOTH station families with real numbers**
  (final-review fix 2) — 500s at the Ore Refinery for the 25 root Plastanium
  crafts (`plan.crafts`, unaffected by how much raw material happens to be
  on hand) and 250s at the Chemical Refinery for the full 25 Stravidium
  Fiber crafts (this estimate's coarse "fully covered or not" precision,
  not a partial 15-craft reduction — see `estimateDuration()`'s own doc
  comment in `src/craftingCalculator.js`).

**Revision note (Layer 1 audit fix, historical):** the first draft of this
example showed Water as two separate, un-summed lines (31,250 in the
shortfall section, 1,500 again under the nested craft) — the Architect and
QA hats independently flagged this as ambiguous about whether on-hand
credit pools correctly across levels. Fixed at the time: every pooled
resource is shown **once**, already combined, in the top-level shortfall
section — never split by level. (The example above no longer shows a
per-ingredient nested-craft breakdown at all, per final-review fix 4 —
superseding this note's original "Stravidium Mass shown once in the nested
section" framing, which itself became stale once that section stopped
printing ingredient rows in on-hand mode.)

(A max-completable example where on-hand stock is *insufficient* to reach
the full requested quantity — e.g. `on-hand-1: Titanium Ore,
on-hand-1-quantity: 40` against `quantity: 25` — would instead report `⚠️ You
can complete at most 10 Plastanium Ingot with current Titanium Ore on hand
(40 ÷ 4 per craft) — short 15.` naming Titanium Ore as the bottleneck. See
§Shortfall & Bottleneck Calculation for the chain-aware version of this
same example, where the bottleneck is an intermediate craftable rather
than a flat ingredient, and the target-item-credit worked example showing
`maxCompletable` combining already-completed progress with remaining
supply correctly.)

Design rationale (carried forward from v1, plus new items for this
revision):

- **"Direct Inputs" / "Nested Craft" / "Total Raw Materials"** mirrors
  gaming.tools' own "Crafting Steps" + "Raw Materials" split (unchanged
  from v1).
- Quantities use thousands separators (unchanged from v1).
- Nested crafts get their own labeled sub-section (unchanged from v1).
- **New:** when any `on-hand-N` value is supplied, the embed title gains a
  `(goal)` suffix and an "On hand:" summary line, so the response is
  visually distinguishable from a plain requirement lookup at a glance.
- **New:** the shortfall section always shows the *reason* a line is zero
  (`(2,000 on hand — fully covered)`), never a bare `0` with no
  explanation — an unexplained zero reads as "this ingredient isn't
  needed," which is wrong; it needs to read as "you already have enough."
- **New:** the max-completable line is phrased as a warning (`⚠️`) only
  when it's *less* than the requested quantity, and a confirmation (`✅`)
  when on-hand stock is sufficient to reach the full goal — the emoji
  itself carries the "are you on track" signal at a glance.
- When `crafting-contract:true` is set, the embed footer must explicitly
  state `Crafting Contract active (-25% materials)` (unchanged from v1).
- **Leftover/overproduction note** (unchanged from v1): items producing
  more than 1 unit per craft (Spice-infused Fuel Cell, both Lubricants)
  show a `+N leftover (rounded up to whole crafts)` line whenever
  leftover > 0.
- **New — slot independence isn't just internal logic, it's stated to the
  user** (closing a Layer 1 UI/UX audit finding): a response never implies
  that `on-hand-2` being filled while `on-hand-1` is empty is unusual or
  incomplete — there is no "on-hand-1 required first" framing anywhere in
  the embed. Combined with every `on-hand-N` slot sharing identical
  Discord description text (§Command Shape), a player has no reason to
  believe slot order or contiguous filling matters, because nothing in
  either the command UI or the response ever suggests it does.
- **New — response density at maximum on-hand slots** (closing a Layer 1
  UI/UX audit finding): with all 6 slots filled against a 6-node tree
  (Industrial-grade Lubricant, the verified worst case), the shortfall
  section lists at most 6 lines plus the target item's own line — every
  section (shortfall, nested craft, max-completable, duration) already
  omits itself entirely when it has nothing to report (see the Duration
  single-station-type rule above, and the `✅`/`⚠️` single-line
  max-completable format), so the response scales in content, not in
  boilerplate, as more on-hand values are supplied. No additional
  truncation logic beyond `FINDING-CALC-1`'s existing defensive
  `.slice()` pattern is needed at this bound.

## Autocomplete Behavior

- Case-insensitive substring match on the 15 known item display names for
  the `item` option (unchanged from v1).
- Returns up to Discord's 25-suggestion cap, sorted by tier then name
  (unchanged from v1).
- **New — `on-hand-N` autocomplete is dependent on `item`:** once `item` is
  selected, each `on-hand-N` option's autocomplete resolves against *that
  item's own recipe tree only* (itself, its direct ingredients, and any
  nested craftable's own ingredients) — never the full 15-item+leaf-resource
  universe. Discord's autocomplete interaction payload includes
  already-filled option values, so this is a real, supported pattern, not a
  new interaction type — but it is genuinely new engineering complexity
  this feature didn't have in v1 (v1's autocomplete was static and
  independent of any other option's value). If `item` is not yet selected
  when a user tabs into an `on-hand-N` field, return an empty suggestion
  list with a placeholder-style single non-selectable entry prompting
  "select an item first" (matches how Discord bots commonly handle
  dependent autocomplete with no valid options yet).

## Error UX

| Condition | Response |
|-----------|----------|
| Unknown/free-typed item string (autocomplete bypassed) | Plain, non-embed error: `Unknown item: 'foo'. Try /dune data calculator and use the autocomplete suggestions.` — matches the existing `formatError()` catch-all convention in `commands.js`. Never fabricates a recipe. |
| `quantity` outside 1–100,000 | Rejected client-side by Discord's `setMinValue`/`setMaxValue`; never reaches the handler. Re-validated server-side regardless — see [Security Review](calculator-security-review.md) §DoS. |
| `station-tier` with no known recipe variant for the selected item | Explicit "no recipe variant at this tier — available tiers: X, Y" message. Never silently falls back to a different tier's numbers. (Unchanged from v1.) |
| `on-hand-N` names a node **not** in the selected `item`'s recipe tree (autocomplete bypassed via free-typing) | Plain error: `'X' is not an ingredient of <item>. Try /dune data calculator and use the autocomplete suggestions for on-hand items.` Never silently ignores the value or guesses which item it might belong to. |
| Two or more `on-hand-N` slots name the **same** node | Plain error: `on-hand-1 and on-hand-3 both name Water — combine them into a single value instead of splitting across slots.` Never silently sums or silently uses only the first. |
| `on-hand-N-quantity` supplied without a matching `on-hand-N` (or vice versa) | Plain error naming the incomplete pair — never silently ignored. |
| `on-hand-N-quantity` outside 0–100,000 | Rejected client-side by Discord's `setMinValue`/`setMaxValue`; re-validated server-side, same pattern as `quantity`. |

## Explicit Non-Goals (v1, still true in this revision)

- Deep Desert Discount and Refining Contract toggles — verified to be a
  no-op and non-functional (respectively) for every item in this feature's
  scope; see §Modifiers above. Not a deferred feature, a permanent scope
  exclusion for this item set. Re-evaluate only if the item scope expands to
  include placeables/buildables (a much larger, separate effort).
- Landsraad contract *bonuses* beyond the single verified Crafting Contract
  ingredient-reduction mechanic — not evidenced anywhere in the decompiled
  formula; do not add speculative additional modifiers.
- Every craftable item in the game — scoped exactly to the 15 items
  identified from the original request.

## Explicit Non-Goals (new in this revision — deferred to later phases)

- **Live on-hand auto-population from real game inventory** (Phase 2). Every
  `on-hand-N-quantity` in this design is a value the player types in by
  hand, exactly like every other option — this feature makes zero adapter
  calls, matching the original v1 risk posture. Automatically reading a
  player's or guild's actual current stock from Core's storage-query routes
  is a separate, later effort with a materially different risk profile (a
  new adapter integration, new access-control questions for guild-wide
  data) and needs its own design and audit.
- **Persisted farming goals / progress tracking over time** (Phase 3). This
  design's `quantity` + `on-hand-N` values are supplied fresh on every
  invocation and never stored — there is no "goal" that persists between
  calls, no notion of "yesterday I had X, today I have Y, here's my
  progress." Every invocation is stateless, matching the bot's existing
  no-new-writes posture for this command class (unchanged from v1's own
  non-goal on this point, restated because this revision could otherwise
  be mistaken for including it).
- **Multi-item combined planning** (e.g. "I want to craft both Plastanium
  and Duraluminum from a shared Water pool") — each invocation plans for
  exactly one target `item`; cross-item resource contention is not
  computed. Not evidenced as requested; would meaningfully complicate the
  shortfall calculation for unclear benefit.

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
- Operator's own gathering/stock-tracking spreadsheet (private, referenced
  2026-09-28 for the shortfall/bottleneck/"what should I farm" concept this
  revision generalizes into the unified command shape above)
- `src/embedFormat.js` — existing formatter conventions
- `src/commands.js` — existing subcommand/dispatch pattern
</content>
