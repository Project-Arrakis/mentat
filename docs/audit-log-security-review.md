# Persistent Audit Log for Destructive Commands — Security Review

**Date:** 2026-07-24
**Reviewer:** OpenCode agent
**Scope:** `Arrakis-Control-Panel` only (`src/auditLog.js`, `src/database.js`'s
new `audit_log` table, wiring changes in `writeHandler.js`/`broadcast.js`/
`commands.js`, and `src/index.js`'s unconditional SQLite startup).

## Executive Summary

This feature is lower-risk than the Steam-link feature it follows —
it adds no new network-facing surface, no new external dependency, and no
new write-capable adapter route. Its risk surface is almost entirely
about **what gets written into the new table, and who can read it back
out** — i.e. data classification and access control on an audit trail
that, by its own nature, will contain Discord user IDs, usernames, and
command parameters for every destructive action taken through this bot.

No HIGH or MEDIUM findings block this design. Two LOW/INFORMATIONAL
findings are noted below, both already addressed in the implementation,
called out here so a future reviewer doesn't have to rediscover the
reasoning.

## STRIDE Summary

| STRIDE Category | Applicability | Notes |
|---|---|---|
| Spoofing | Not applicable | `recordAuditEvent()`'s actor fields are read directly from the Discord interaction object the bot's own gateway connection already authenticated — no new identity-claiming surface is introduced. |
| Tampering | **Applicable — FINDING-AUDIT-2** | Nothing in this feature prevents a row from being altered after the fact by anyone with direct SQLite file access (i.e. host-level access, not through this bot's own interfaces) — this is an accepted limitation, not a gap this feature claims to close. |
| Repudiation | **This feature's entire purpose** | Closes the exact gap FINDING-STEAM-3/FINDING-LINK-6 flagged as open (no structured audit event for the bot's own player-link dispatch). |
| Information disclosure | **Applicable — FINDING-AUDIT-1** | `detail` fields could carry sensitive values (Steam IDs, real names) if a caller passed them in without going through redaction. |
| Denial of service | **Applicable — FINDING-AUDIT-4** | Unbounded table growth if pruning ever silently stops working. |
| Elevation of privilege | **Applicable — FINDING-AUDIT-5** | The new `/dune admin audit` read command must be gated at least as strictly as the existing `admin:doctor`/`admin:cooldowns` commands it sits alongside. |

## Detailed Findings

### FINDING-AUDIT-1: `detail` fields must be redacted before persistence, not after (MEDIUM — addressed in implementation)

- **Location:** `src/auditLog.js`'s `recordAuditEvent()`.
- **Risk:** Every call site in this feature (`writeHandler.js`,
  `broadcast.js`, `commands.js`) passes arbitrary command parameters into
  `detail` (e.g. a maintenance note's text, a broadcast message, a
  character name). If any of these ever contained a Steam ID, email, or
  other sensitive value, persisting it unredacted would create a
  permanent record of data this bot already treats as sensitive
  everywhere else (`src/format.js`'s `LABELED_STEAM_ID_PATTERN`,
  `EMAIL_PATTERN`, real-name key-suffix matching).
- **Mitigation implemented:** `recordAuditEvent()` calls
  `redactSecrets(detail)` (the exact same function every other command's
  Discord-facing payload already passes through) **before** calling
  `insertAuditLog()` — redaction happens at write-time, not read-time, so
  a sensitive value is never written to disk in the first place, not just
  hidden when displayed later. This is stricter than the read-side
  redaction `/dune admin audit` also applies to its output (see
  FINDING-AUDIT-5) — that's redaction-in-depth, not the only layer.
- **Verification:** `test/auditLog.test.js`'s "recordAuditEvent redacts
  sensitive detail fields before persisting" test asserts a
  `steamId`-keyed detail field is not present in its original form in the
  persisted row, while an unrelated `note` field passes through
  unchanged.

### FINDING-AUDIT-2: No tamper-evidence beyond SQLite's own row-level guarantees (LOW, accepted limitation)

- **Location:** `audit_log` table generally.
- **Risk:** Nothing prevents a row from being altered or deleted by
  anyone with direct file-level access to the SQLite database file
  itself (host access, not through any of this bot's own command
  interfaces — `insertAuditLog()` is genuinely append-only in that no
  function in this codebase updates or deletes an individual row by ID;
  only `pruneAuditLog()`'s age-based bulk delete exists).
- **Recommendation:** Accepted as-is for v1 — this is an operational
  accountability log (who ran what, per this bot's own record), not a
  forensic/legal chain-of-custody artifact. Hash-chaining, signing, or
  write-once filesystem permissions are explicitly out of scope (see
  Design doc's Non-Goals) and would be a disproportionate addition for
  this feature's actual purpose.

### FINDING-AUDIT-3: Audit-write failure must never block or fail the primary command (MEDIUM — addressed in implementation)

- **Location:** `src/auditLog.js`'s `recordAuditEvent()` and
  `runAuditLogPruning()`.
- **Risk:** If `insertAuditLog()` ever throws (a locked database file, a
  disk-full condition, a future schema-migration edge case) and that
  exception were allowed to propagate, every destructive command would
  start failing for an unrelated, secondary reason — the audit log
  becoming a single point of failure for the very actions it's supposed
  to be observing would be a worse outcome than an occasional missed
  audit row.
- **Mitigation implemented:** both `recordAuditEvent()` and
  `runAuditLogPruning()` wrap their database calls in `try`/`catch` and
  log via `logError()` on failure rather than propagating. Verified
  directly with a test double (a `db` object whose `.prepare()` always
  throws) in `test/auditLog.test.js`'s "does not throw when the
  underlying insert fails" / "does not throw if the underlying prune call
  fails" tests, not by inspection alone.

### FINDING-AUDIT-4: Retention enforcement depends on a background timer actually running (LOW, accepted limitation)

- **Location:** `src/index.js`'s pruning `setInterval`.
- **Risk:** If the bot process is restarted frequently enough (faster
  than the 24-hour prune interval) in an environment where restarts
  somehow always land before the *initial* `pruneAuditLogNow()` call at
  startup completes, retention could theoretically lag. In practice this
  is not a realistic failure mode — `pruneAuditLogNow()` runs
  synchronously (relative to the event loop) at module load time, before
  the Discord client even logs in, so it always gets at least one chance
  to run per process lifetime.
- **Recommendation:** Accepted as-is. No cron-like external scheduler
  dependency was introduced for this — matching every other periodic
  task in this codebase (`statsPusher.js`, the alert-check timers in
  `index.js`), which all rely on the same in-process `setInterval`
  pattern with no external watchdog.

### FINDING-AUDIT-5: `/dune admin audit` must be at least as strictly gated as other admin-tier read commands (MEDIUM — addressed in implementation)

- **Location:** `src/commands.js`'s `admin:audit` dispatch case.
- **Risk:** An audit log is itself sensitive — it aggregates Discord user
  IDs, usernames, and command details across every tracked destructive
  action in a guild. If this read command were reachable by a
  lower-privileged role than the write actions it describes, it would
  leak more information than any single one of those actions would on
  its own.
- **Mitigation implemented:** gated via the exact same `isAdminActor()`
  check `admin:doctor`/`admin:cooldowns` already use — no new,
  independently-reviewed authorization path was introduced. Additionally,
  `test/fixtures/mockConfig.js`'s `commandRoleIds` map was found to be
  **missing** an `admin:audit` entry during this feature's own test
  writing (a real, caught defect — without it, `isCommandAllowed()`'s
  RBAC check would have fallen through to the broader
  observer-or-admin allow-set in this specific mock config, rather than
  being correctly admin-only) — fixed as part of this change.
- **Verification:** `test/discord-bot-test-harness.js`'s "admin:audit
  returns persisted entries to an admin" and "admin:audit is denied to a
  non-admin observer" tests, both passing against the corrected mock
  config.

## Informational Finding: `result` CHECK Constraint's Own Default Value Initially Violated Its Constraint

Found via a genuine `node --test` failure while writing
`test/database.test.js`, not by inspection: the first draft of the
`audit_log` schema had `result TEXT NOT NULL DEFAULT 'unknown'
CHECK(result IN ('success', 'denied', 'failed', 'pending'))` — the
column's own default value (`'unknown'`) was not itself in the allowed
set, meaning any insert relying on that default (rather than specifying
`result` explicitly) would fail with a CHECK constraint violation. Fixed
by adding `'unknown'` to the allowed set. No production data was ever
affected — this was caught before any real deployment had run the
feature (confirmed via a repo-wide search for `*.db` files, finding
none), so no migration was needed beyond fixing the `CREATE TABLE`
statement itself.

## Recommended Remediation Order

All findings requiring code changes (FINDING-AUDIT-1, -3, -5) were
addressed in the same change that introduced this feature — there is no
deferred remediation list, unlike the Steam-link feature's
multi-finding rollout.

## Evidence Artifacts

- `npm run check` — full test suite (see PR for exact pass count)
- `test/database.test.js`, `test/auditLog.test.js` — new, feature-specific
- `test/discord-bot-test-harness.js` — extended "Audit Logging" describe block
- Semgrep, Gitleaks, `npm audit` — standard verification, see PR description

## Sources

- [Design](audit-log-design.md)
- [Architecture](audit-log-architecture.md)
- [GRC Review](audit-log-grc.md)
- `src/format.js` — `redactSecrets()`, the redaction function this feature applies at write-time
- `docs/steam-link-security-review.md` — FINDING-STEAM-3, the prior finding whose "no structured audit event" limitation this feature closes for the bot's own dispatch layer
