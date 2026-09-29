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

## Phase 1 — Crafting Calculator (shipped)

A `/dune data calculator` Discord command: pure, stateless local math over a
bundled, verified recipe table for 15 craftable items. Given a goal quantity
and (optionally) what you already have on hand for any ingredient in that
item's recipe tree — including intermediate craftables and Water — it
reports the remaining shortfall, the maximum you can actually complete right
now, and which resource is the real bottleneck. No adapter calls, no
database writes, no persisted state — every value is typed in fresh each
time.

**Status:** implemented via subagent-driven-development (10 tasks, per-task
review, final whole-branch review with 2 fix rounds) — merged as
[`mentat`#417](https://github.com/Project-Arrakis/mentat/pull/417) (2026-09-29).

- [Design](calculator-design.md) — command shape, the shortfall/bottleneck/duration calculation with worked examples, response layout, error handling
- [Architecture](calculator-architecture.md) — file layout, the verified reference algorithm, the on-hand-credit traversal design
- [Security Review](calculator-security-review.md)
- [GRC Review](calculator-grc.md)
- [Implementation Prompt](calculator-implementation-prompt.md) — the prompt the implementation session was built from
- Tracking: [`mentat`#412](https://github.com/Project-Arrakis/mentat/issues/412) (Layer 1 audit findings + resolutions), [`mentat`#411](https://github.com/Project-Arrakis/mentat/pull/411) (the design PR), [`mentat`#417](https://github.com/Project-Arrakis/mentat/pull/417) (the implementation PR)

## Phase 2 — Live Stock Integration (optional future enhancement, not a Phase 3 dependency)

**Reframed (2026-09-29): no longer a prerequisite for Phase 3.** Originally
scoped as a blocking dependency ("Phase 3 depends on Phase 2's live-stock
read path existing first") — that dependency is gone now that Phase 3 ships
with manual on-hand entry (see Phase 3's Option 1 decision below). Phase 2
becomes a fully independent, optional enhancement — swap manual entry for a
live query, for personal goals, guild goals, or both — to build whenever
the bot has enough traction to justify it, with zero changes required to
Phase 1 or Phase 3's own data shape (`applyOnHandCredit()`'s `onHandEntries`
doesn't care whether a human typed the numbers or a query populated them).

Investigated directly against Core's real schema (2026-09-29, no guessing —
every claim below is a quoted query/table, not an inference):

- **Personal ("owned") scope is already fully solved by an existing query.**
  `dune.permission_actor_rank` is a real per-player-per-base table
  (`rank`: 1=Owner, 2=Co-Owner, 3=Associate — see
  `docs/console/base-permissions.md` in Core). The existing `owned` scope in
  `duneDb.js`'s `searchItemsInContainers()` filters `rank = 1` with no
  `LIMIT`/`DISTINCT` — if a player owns 3 bases, all 3 are already summed
  together. A player-scope live query needs no new cross-base logic, just an
  exact-match (not `ILIKE`), uncapped variant of this same query, behind one
  new adapter route.
- **Guild scope has a real, confirmed gap: Core has no first-class "guild
  base" concept at all.** No `guild_id`/`is_guild_base`/`shared` column
  exists anywhere in the base/placeable schema — ownership is purely
  per-player permission rows. The existing `guild` search scope works
  around this by defining "guild inventory" as the union of every base
  where *any current guild member* holds *any* permission row (owner,
  co-owner, or associate), with no way to distinguish "this member is
  sharing their base with the guild" from "this member's completely
  private base happens to exist while they're in the guild." See Phase 3
  below for how this gap was resolved for now (Option 1: sidestep it
  entirely; Option 2: give bases a real guild designation, deferred).
- The smallest plausible Core delta for the personal-scope case, whenever
  it's built: one new `duneDb.js` query (clone the existing owned/guild CTE,
  exact `template_id` match, `sum(stack_size)`, no row cap) + one new
  Discord-adapter route following the existing `PLAYERS_FIND` pattern
  (capability check, `requireLinkedPlayer`, route constant, policy
  capability, catalog entry). No recipe/crafting math lives in Core today
  (confirmed by exhaustive grep) and none would be added by this — Core's
  entire job stays "answer one exact number," all domain logic stays in
  mentat.

**Status:** investigated, not designed, not prioritized. No design doc exists
yet — this section will link to one whenever this enhancement is actually
prioritized. It is the only remaining phase, and it is optional: Phase 3
shipped without it.

## Phase 3 — Goal Setting & Progress Tracking (shipped)

Lets a player or a guild officer/leader set a persistent farming goal (e.g.
"10,000 Duraluminum"), then check progress over time. This introduces
genuinely new persisted state (goals, owned by a player or a guild) and real
permission questions (who can set a goal, or update a guild's on-hand
number, on behalf of a guild) that Phase 1 deliberately doesn't touch.

**No longer depends on Phase 2.** An earlier pass of this document scoped
Phase 3 as blocked on Phase 2's live-stock read path. That's no longer true
— see the on-hand-update decision immediately below.

**Decision (2026-09-29): guild on-hand quantities are entered manually by a
leader/officer for now (Option 1), not queried from bases (Option 2) —
revisit Option 2 once the bot has real traction.** Two options were
considered for how a guild's "current on-hand" number gets populated:

- **Option 1 (chosen):** a guild leader/officer updates an on-hand quantity
  directly (RBAC'd to leader/officer Discord roles), the same trust model as
  Phase 1's manual on-hand entry. Goal/order progress is computed against
  that self-reported number. Zero new Core code, zero base-querying, and it
  sidesteps Phase 2's confirmed guild-base ambiguity entirely (see Phase 2
  above) rather than having to resolve it — nobody has to decide whether a
  member's private base counts as "guild inventory," because there's no
  base query in the loop at all.
- **Option 2 (deferred):** give bases a real, explicit guild designation in
  Core (a new schema concept — Core currently has none, see Phase 2 above),
  so guild on-hand can be computed automatically from bases members have
  actually designated as shared, rather than inferred from membership
  alone. This is the more "correct" long-term answer, but it's real
  Core schema work (new table/column, an un-designation path for a member
  leaving the guild or revoking sharing, full Requirement 26 migration/
  rollback scrutiny against live production Postgres) — properly
  architectural-scope, not a quick addition.

Chosen because it matches this project's priority that the vast majority of
bot features and logic stay in the bot, not Core, and because it's
consistent with this document's own aggregate-only scope decision below (a
self-reported total is exactly the kind of "aggregate progress, no
per-member attribution" tracking already decided on). Nothing about Option
1 forecloses Option 2 later — a goal's "current on-hand" field doesn't care
whether a human typed it or a future query populated it.

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
toward the target (via the leader/officer's own self-reported on-hand
number, Option 1 above — not a container-diff mechanism, which would have
required Phase 2's live-query work), no per-member contribution breakdown,
no "who gets credit" split.
Per-member attribution — if ever wanted — is real future work gated on
either the game exposing better instrumentation, or an explicit
self-reported/unverified contribution-claim command (same trust model as
Phase 1's manual on-hand entry), and is explicitly out of scope for the
initial Phase 3 design rather than a silent omission.

**Status:** shipped — `/dune goal create|on-hand|list|progress|delete`, merged
as [`mentat`#430](https://github.com/Project-Arrakis/mentat/pull/430)
(2026-09-29). Built via subagent-driven-development (14 tasks plus one
inserted task, each independently reviewed, then a whole-branch review that
found and fixed one Critical bug: raw-resource items could not be created as
goals). What is implemented matches the decisions above: manual on-hand entry
(Option 1), one goal model where an order is a goal with `due-at` set, and
aggregate-only guild progress. Guild goal management is gated to admin-tier
access or Discord server ownership; reading a guild goal's progress is open
to any guild member. Any catalog item can be a goal: the 15 craftable ones
get full Phase 1 crafting math, everything else is a simple count.

- [Design spec](superpowers/specs/2026-09-29-goal-order-tracking-design.md) — Eight-Hats Layer 1 audited (`mentat`#420)
- [Implementation plan](superpowers/plans/2026-09-29-goal-order-tracking-phase3.md)
- [Change note](changes/PR-0430-goal-order-tracking.md)
- Follow-ups (none blocking): `mentat`#422 (player/server groups mix player and moderator actions), #423 (splitting `/dune` into multiple top-level commands), #424 (write subcommands missing from `/dune core help`), #425-#429 (minor goal findings)

**Constraint for any further `/dune` subcommand:** Discord's 8000-character
command-definition limit. The write-group build measures 7473/8000 (soft
target 7500, enforced by a test in `test/commands.test.js`), so the next new
subcommand needs description trims or the split in #423.

## Origin note

The shortfall/bottleneck/"what should I farm" concept across all three
phases generalizes a real pattern from the operator's own private
gathering/stock-tracking spreadsheet, referenced during design but not
itself a source of recipe data (that came independently from
dune.gaming.tools, see the Phase 1 docs' own Sources sections).
