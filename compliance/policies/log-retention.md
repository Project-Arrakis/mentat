# Log Retention Policy

**Version**: 1.0
**Date**: 2026-09-10
**Review Cycle**: Annually, or whenever the hosting/deployment layer changes

---

## Why this document exists

`compliance/controls/soc2-matrix.md`'s MD-03 row ("Log retention, 90 days") cited this file as already existing since 2026-07-19 — it did not exist until this writing (found during a 2026-09-10 comprehensive security/GRC/legal audit, `mentat#335`). This is the real policy, describing actual current behavior, not an aspirational target — the matrix's own `⚠️ Partial` status for MD-03 was accurate in spirit even though the linked evidence didn't exist.

## What this bot actually does

`src/logger.js`'s `logInfo()`/`logError()` write structured JSON log lines to `console.log`/`console.error` (stdout/stderr) — confirmed directly in the source. **The bot's own code does not write log files, does not rotate logs, and does not enforce any retention window.** Whatever retains, rotates, or expires these log lines is entirely the responsibility of the process supervisor and host the bot happens to be running under (systemd + journald on the bot VM, per this org's own infrastructure — see `~/projects/meta/Project-Arrakis/README.md`'s Live Systems section for the current deployment target).

## Redaction (Requirement 24, already real)

Before retention is even a question, `logger.js`'s existing redaction discipline (`redactSecrets()`-style patterns, applied consistently across this codebase per Requirement 24) means secrets/tokens should never reach a log line in the first place — verified as an ongoing discipline this codebase already follows, not something this policy adds.

## The actual 90-day figure

No code in this repository enforces a 90-day log retention window. If the bot VM's `journald` is configured with a 90-day retention policy (`journalctl`'s `MaxRetentionSec`/`SystemMaxUse` settings, or equivalent for whatever supervises the process in a given deployment), that is a host-level configuration choice, not something verifiable from this repository alone. **This is the honest gap**: MD-03's "90 days" figure in the SOC 2 matrix should either be verified against the real, live host configuration (and that verification recorded as evidence, e.g. `journalctl --disk-usage`/the relevant systemd-journald.conf setting, dated), or the matrix should say "host-dependent, not independently verified" rather than implying this repository's code guarantees it.

## Recommendation for whoever picks this up

1. Verify the actual `journald` (or equivalent) retention configuration on the live bot host.
2. Record that verification as dated evidence under `compliance/evidence/` (matching this org's own evidence-first DevSecOps discipline).
3. Update `soc2-matrix.md`'s MD-03 status once verified, rather than leaving it pointing at this document as if a 90-day guarantee is independently enforced here — it isn't, by design (this bot is a single process, not a log-management system).
