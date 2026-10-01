# PR Change Summary — Write Subcommands Visible in `/dune core help` (mentat#424)

## Addressed Items

### 1. 28 registered write subcommands were missing from `/dune core help` ✅

**Problem:** `helpPayload()` listed only the legacy generic `write:*` entries. Every subcommand generated from `WRITE_ACTIONS` (groups `base`, `map`, `carepackage`, `guild`, `operations`, `bot`, plus the write subcommands merged into `player` and `server`) was registered and dispatchable but invisible in help. (The issue cites 32; `WRITE_ACTIONS` actually holds 28.)

**Solution:** help entries are now derived mechanically from `WRITE_ACTIONS` (`WRITE_ACTION_HELP_ENTRIES`), only when writes are enabled, deduplicated by name. "Available" means the caller may actually run it: the generic RBAC gate (`isCommandAllowed`, as `executeDuneCommand` applies first) AND the write gate (`canWrite(..., action.tier)`, or the configured bot-operator identity for `bot:self-update`) must both pass, otherwise the entry is locked. The same rule now applies to the legacy `write:*` entries and `admin:broadcast`, which previously checked only the write gate. The help embed splits oversized groups into continuation fields instead of truncating at 1024 chars.

**Deliberately unchanged:** `getCommandRegistry()` (public, unauthenticated landing-page feed) still excludes all write groups (#203); the exclusion is now documented in code and enforced by test. No Discord command definition changed (character budget unaffected).

**Tests:** `test/helpWriteVisibility.test.js` (every `WRITE_ACTIONS` entry in help, help mirrors registered tree with writes on, locked/available gating, embed size worst case, no public-registry leak, action count pinned).

**Docs reviewed:** `docs/user-guide.md` (one line updated for `/dune core help`).
