# PR Change Summary — Goal Follow-ups, Batch 1

## Addressed Items

### 1. Delete autocomplete includes completed goals ✅ (#426)
**Problem:** `/dune goal delete`'s `id` suggestions listed only active goals, but a completed goal still counts toward the lifetime cap and deleting it is the only way to free the slot.
**Solution:** When the focused subcommand is `delete`, suggestions include completed personal goals (and completed guild goals for admins), suffixed "(done)". `on-hand` and `progress` are unchanged.

### 2. Progress autocomplete shows guild goals to non-admins ✅ (#425)
**Problem:** `executeGoalProgress` lets any guild member read a guild goal, but the autocomplete applied the admin gate to every subcommand.
**Solution:** For `progress` only, the caller's own guild's goals are suggested without the admin check. `on-hand` and `delete` keep it. Suggestions are always scoped to the caller's own `guildId`.

### 3. `goal list` signals "ingredients ready" ✅ (#427)
**Problem:** The list percentage counts only finished-item stock, so a craftable goal with a full ingredient set on hand read 0%.
**Solution:** An active craftable goal shows " — ingredients ready" when every on-hand-able leaf ingredient has zero remaining shortfall. `maxCompletable` is deliberately not used (an uncredited ingredient is unconstrained there); water is ignored because it has no game-item id and can never be recorded.

### 4. Atomic goal writes ✅ (#428)
**Solution:** `goal create` (cap checks + insert + audit), `goal on-hand` (cap check + entry + audit + completion + audit) and `goal delete` (audit + delete) each run in one IMMEDIATE `db.transaction`, so a mid-sequence failure leaves no orphan rows and cap checks cannot interleave with the write. Error messages are unchanged.

### 5. End-to-end journey tests ✅ (#429)
**Solution:** Added a craftable guild-goal journey (admin writes, non-admin read-only, audit trail survives delete) and a cross-tenant negative journey through real `executeDuneCommand` dispatch.

## Compatibility
No schema, command-definition or Discord character-budget changes. Tracking issue: `mentat`#432.
