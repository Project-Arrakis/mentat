# Data Retention Policy

**Version**: 1.0
**Date**: 2026-09-10
**Review Cycle**: Annually, or on any material change to `database.js`'s schema/session stores

---

## Why this document exists

`compliance/controls/soc2-matrix.md`'s PR-02 row cited this file as already existing and marked `✅ Implemented` since 2026-07-19 — it did not exist until this writing (found during a 2026-09-10 comprehensive security/GRC/legal audit, `mentat#335`). This is the real policy, describing actual current code behavior, not an aspirational target.

## Scope

This bot (multi-tenant mode) persists data in two places: `guilds.sqlite` (durable, on-disk, survives restarts) and several in-memory Maps (process-lifetime only, lost on restart or deploy). This policy covers both.

## Durable data (`database.js`, on-disk SQLite)

| Data | Table | Retention | Deletion path |
|---|---|---|---|
| Console URL, adapter token (encrypted at rest if `ACP_SECRETS_KEY`/`ACP_KEK_FILE` is configured — see `secretsCrypto.js`), registration status | `guilds` | Indefinite, until explicitly removed | Guild owner disconnects via the console's own "Disable" flow, or an operator directly deletes the row |
| Discord role → tier mappings | `guild_roles` | Indefinite, tied to the owning guild row | Removed via the role-picker UI (per-mapping) or cascades when the guild row is deleted |
| Per-guild settings (RBAC mode, ephemeral defaults, stats-sharing) | `guild_settings` | Indefinite, tied to the owning guild row | Same as above |
| Discord-user-to-character-name links | (character link cache table) | Until the user unlinks, or the underlying console-side link is removed | User-initiated unlink command |
| Command-usage audit records (`writeAuditEvent`) | audit log table/file | Indefinite today — **no automated pruning exists**; this is a known gap, not a designed retention period | None (manual only) |

**Known gap, tracked:** audit records have no automated expiry. A future session should either add a pruning job or explicitly document "retained indefinitely" as the deliberate policy — currently it's simply unaddressed, which is the honest status this document should carry rather than implying a designed retention window that doesn't exist.

## In-memory, process-lifetime data (never written to disk)

These are all capacity-capped, TTL-bound `Map`s — see `database.js` for `oauthSessions`, and `mentat#844`'s design work for `autoInviteSessions`/`pendingOwnerConfirmations` (not yet implemented as of this writing). None of these are "retained" in the durable-storage sense; they exist only as long as the process does, and each entry additionally expires on its own TTL well before that:

| Store | TTL | Holds |
|---|---|---|
| `oauthSessions` | 30 minutes (capacity-capped at 1000 entries, lazy-swept) | Discord OAuth access token (transiently, deleted on consume), state |
| `autoInviteSessions` (design, not yet shipped) | 2 minutes | `consoleUrl`, `adapterToken` (plaintext, in-memory only) |
| `pendingOwnerConfirmations` (design, not yet shipped) | ~15 minutes | Pending registration awaiting Discord owner Confirm/Deny |

A process restart or redeploy clears all of these immediately and completely — this is an accepted, documented trade-off (see the hosted-bot auto-invite design's own §4.5), not a gap.

## Deletion on request

A guild owner (or, per Discord ToS's 13+ requirement, anyone acting on behalf of an underage user who should not have been using the bot) can request deletion via the project's Discord community (see `docs/privacy-policy.md`'s pointer to the operative privacy policy). Deletion means: removing the `guilds` row and its associated `guild_roles`/`guild_settings`/character-link rows. In-memory session data, being TTL-bound and non-durable, requires no separate deletion action.

## Backups

See `compliance/runbooks/backup-recovery.md` for how the durable SQLite file is backed up and how long backups themselves are retained — this document covers live-data retention, not backup-copy retention, which may legitimately outlive a user's deletion request for a bounded recovery window.
