# Crafting & Resource Planning — Overview

This is the entry point for a three-phase effort to give players and guild
leadership real crafting-math and resource-planning tools inside Discord,
replacing an operator's own manual spreadsheet-based tracking. Each phase is
independently designed, audited, and shipped — read this document first,
then follow the links into whichever phase's detail you need.

## Why this exists

Players already use a third-party site
([dune.gaming.tools/crafting-calculator](https://dune.gaming.tools/crafting-calculator))
for crafting math, and the operator separately tracked gathering/stock
planning in a private spreadsheet. The driving goal across all three phases
is the same question, asked at increasing levels of automation: **"I want N
of item X — what do I still need, and am I actually on track?"**

## Phase 1 — Crafting Calculator (designed, audited, not yet implemented)

A `/dune data calculator` Discord command: pure, stateless local math over a
bundled, verified recipe table for 15 craftable items. Given a goal quantity
and (optionally) what you already have on hand for any ingredient in that
item's recipe tree — including intermediate craftables and Water — it
reports the remaining shortfall, the maximum you can actually complete right
now, and which resource is the real bottleneck. No adapter calls, no
database writes, no persisted state — every value is typed in fresh each
time.

**Status:** design complete, revised twice against a full Eight-Hats Layer 1
audit (two rounds of real findings, all resolved — see the audit trail
below). Not yet implemented.

- [Design](calculator-design.md) — command shape, the shortfall/bottleneck/duration calculation with worked examples, response layout, error handling
- [Architecture](calculator-architecture.md) — file layout, the verified reference algorithm, the on-hand-credit traversal design
- [Security Review](calculator-security-review.md)
- [GRC Review](calculator-grc.md)
- [Implementation Prompt](calculator-implementation-prompt.md) — ready to hand to an implementation session once the design is approved
- Tracking: [`mentat`#412](https://github.com/Project-Arrakis/mentat/issues/412) (Layer 1 audit findings + resolutions), [`mentat`#411](https://github.com/Project-Arrakis/mentat/pull/411) (the design PR)

## Phase 2 — Live Stock Integration (not yet designed)

Wires Phase 1's "on hand" quantities to real game data instead of manual
entry, for both individual players and guilds — using Core's existing
container/storage-query routes (`GUILD_FIND`/`GUILD_STORAGE` and their
personal-scope equivalents), which already return per-container item
quantities and just need a proper server-side aggregation rather than
mentat summing up to 200 raw rows itself. This is a real, new Core-side
change (not just a mentat-side one), with materially different
access-control questions (a player's own stock vs. a guild's shared,
multi-base holdings) — it gets its own full design pass before any code.

**Status:** scoped only, in conversation — no design doc exists yet. This
section will link to one once brainstorming for this phase begins.

## Phase 3 — Goal Setting & Progress Tracking (not yet designed)

Lets a player or a guild officer/leader set a persistent farming goal (e.g.
"10,000 Duraluminum"), then check progress over time against Phase 2's live
stock data without re-entering on-hand quantities by hand each time. This
introduces genuinely new persisted state (goals, owned by a player or a
guild) and real permission questions (who can set a goal on behalf of a
guild) that Phase 1 and 2 deliberately don't touch.

**One goal model, not two.** A guild "order" (e.g. "need 10,000 Plastanium
for next week's Deep Desert base") is the same object as an open-ended goal,
distinguished only by an optional `dueAt` — `null` for a standing goal,
set for a time-boxed order. Same progress tracking, same code path either
way; no separate order subsystem.

**Scope decision (2026-09-29): guild goals/orders track aggregate progress
only, not per-member contribution — deferred to a later phase.** Personal
goals get full attribution for free, since ownership and contribution are
the same thing for a single player (there's only one person who could have
made progress on it). Guild goals are different: investigated directly
against a live game server (`dune-prod2`, 2026-09-29) whether *who
deposited what* into a shared guild storage container could be tracked
automatically, and found it currently cannot be, at the engine level, not
as a Core or mentat gap:
- `dune.item_audit_log` (the real, already-used-elsewhere Postgres table
  that logs every inventory item INSERT/DELETE/UPDATE) carries no
  player/actor column on its own rows — the only attribution path is
  `inventory_id → dune.inventories.actor_id`, which for a personal
  inventory is the player (clean), but for a shared guild container
  resolves to the container/base itself (confirmed via `guildStorageQuery()`'s
  own join pattern), not to whichever member actually walked up and
  deposited items.
- A live 6-hour stdout log sample from `dune-server-survival-1` was checked
  directly for any per-player container-interaction line — none exists.
  `LogInventorySystem` (869 lines in the window) is entirely a benign
  stat-rehydration warning with no player/container identity; no other log
  category carries item-transaction-with-actor granularity either.

So Phase 3 ships guild goals/orders as **aggregate-only**: total progress
toward the target (via the same container-diff mechanism Phase 2 already
needs), no per-member contribution breakdown, no "who gets credit" split.
Per-member attribution — if ever wanted — is real future work gated on
either the game exposing better instrumentation, or an explicit
self-reported/unverified contribution-claim command (same trust model as
Phase 1's manual on-hand entry), and is explicitly out of scope for the
initial Phase 3 design rather than a silent omission.

**Status:** scoped only, in conversation — no design doc exists yet. This
section will link to one once brainstorming for this phase begins, after
Phase 2 is designed (Phase 3 depends on Phase 2's live-stock read path
existing first).

## Origin note

The shortfall/bottleneck/"what should I farm" concept across all three
phases generalizes a real pattern from the operator's own private
gathering/stock-tracking spreadsheet, referenced during design but not
itself a source of recipe data (that came independently from
dune.gaming.tools, see the Phase 1 docs' own Sources sections).
