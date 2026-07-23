# Crafting Calculator — Design

## Overview

`/dune data calculator` answers "how much do I need to gather/craft N of item
Y" for the resource-chain items players ask about most: Plastanium,
Duraluminum, Aluminum, Steel, Iron, Copper, Silicone, Stravidium, Cobalt
Paste, Spice-infused Fuel Cells, Industrial Lubricant, Small/Medium/Large
Vehicle Fuel Cells, and Low-grade Lubricant.

The bot is currently a read-only observability tool with no crafting-math
capability. Players already use a third-party site
([dune.gaming.tools/crafting-calculator](https://dune.gaming.tools/crafting-calculator))
for this. This feature reproduces the same recipe-tree math inside Discord
for the 16 named items, removing the context switch, without adding any new
adapter call, database write, or permission tier.

This is **status quo for how the bot already ships bundled reference data** —
the same category as `embedFormat.js` faction theming or `core:help` text:
versioned in this repo, reviewed like code because it is code.

## Command Shape

```
/dune data calculator item:<autocomplete> quantity:<integer, 1-10000, default 1> [station-tier:<Large|Medium|Small, default Large>]
```

| Option | Type | Required | Bounds |
|--------|------|----------|--------|
| `item` | string (autocomplete) | yes | must resolve to one of the 16 known recipe keys |
| `quantity` | integer | no (default 1) | `setMinValue(1)` / `setMaxValue(10000)` |
| `station-tier` | string choice | no (default `Large`) | `Large`, `Medium`, `Small` — only tiers with a known recipe variant for the selected item are honored |

**Why autocomplete instead of `.addChoices()`:** 16 items fits Discord's
25-choice cap today, but autocomplete resolves from the same static recipe
table used for calculation, so there is exactly one source of truth. Adding
a 17th item later does not require touching the choice list separately from
the data.

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

## Autocomplete Behavior

- Case-insensitive substring match on the 16 known item display names.
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
| `station-tier` with no known recipe variant for the selected item (e.g. `Small` for Large Vehicle Fuel Cell) | Explicit "no recipe variant at this tier" message. Never silently falls back to a different tier's numbers. |

## Explicit Non-Goals (v1)

- Landsraad contract bonuses or Deep Desert building-mode cost modifiers —
  dynamic, session-specific adjustments, not static recipe data. Legitimate
  v2 candidate if requested, not required for the 16-item scope asked for.
- Every craftable item in the game — scoped exactly to the 16 named
  resources. Weapons/armor/vehicles/placeables have much deeper, more
  volatile dependency graphs and are a separate effort if ever requested.
- Persisting user calculation history — every invocation is stateless,
  matching the bot's existing no-new-writes posture for this command class.

## Sources

- [Architecture](calculator-architecture.md)
- [Security Review](calculator-security-review.md)
- [GRC Review](calculator-grc.md)
- [Implementation Prompt](calculator-implementation-prompt.md)
- Recipe data verified against https://dune.gaming.tools/crafting-calculator, 2026-07-23
- `src/embedFormat.js` — existing formatter conventions
- `src/commands.js` — existing subcommand/dispatch pattern
</content>
