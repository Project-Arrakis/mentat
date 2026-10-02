# PR Change Summary — Goal & Order Tracking (Phase 3)

## Addressed Items

### 1. `/dune goal create|on-hand|list|progress|delete` — persistent farming goals and orders ✅

**Problem:** Players and guilds had no way to track a farming goal over time without re-running the calculator from scratch each session, and no way to target a goal at any of the 2,558 items in the game beyond the 15 the calculator has recipes for.

**Solution:** Three new SQLite tables (`goals`, `goal_on_hand_entries`, `goal_audit_log`) back five new subcommands. Craftable-item goals reuse Phase 1's full calculation pipeline via a newly-extracted shared function (`resolveEffectiveOnHandCredit()`); any other catalog item gets simple target-minus-on-hand tracking. Guild goals are RBAC-gated to admin-tier/ownership, bound to the creating guild to prevent cross-tenant access.

**Commands:**
- `/dune goal create scope:<personal|guild> item:<...> quantity:<1-100000> [due-at] [station-tier] [crafting-contract]`
- `/dune goal on-hand id:<...> node:<...> quantity:<0-100000>`
- `/dune goal list scope:<personal|guild> [include-completed]`
- `/dune goal progress id:<...>`
- `/dune goal delete id:<...>`

**Implementation Details:**
- `src/gameItemCatalog.js`/`.data.json` — vendored, deduplicated copy of Core's real 2,551-item catalog
- `src/gameItemIdBridge.js` — standalone Map-based bridge from mentat's recipe keys to real game item ids
- `src/craftingCalculator.js`'s `resolveEffectiveOnHandCredit()` — extracted from Phase 1's `executeCalculator()`, reused by both
- `src/database.js`'s `goals`/`goal_on_hand_entries`/`goal_audit_log` schema and accessors
- Full design record and Layer 1 audit: `docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md`, tracking issue `mentat`#420
