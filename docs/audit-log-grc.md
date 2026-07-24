# Persistent Audit Log for Destructive Commands — GRC Review

## Status

Compliance review for the `audit_log` table and its associated read
command (`/dune admin audit`). Does not assert any certification claim —
see [Arrakis-Control-Panel's SOC 2 Alignment Notes](soc2-alignment.md) for
the ecosystem-wide compliance posture this feature's evidence feeds into.

## Data Classification

| Category | Present? | Notes |
|---|---|---|
| Discord user ID, username | Yes | Same classification as every existing command-execution record this bot already handles (RBAC checks, cooldown tracking) — no new category, just a new durable record of it. |
| Command name, action, capability, idempotency key | Yes | Operational metadata, not personal data. |
| Command-specific `detail` (e.g. a maintenance note's text, a broadcast message, a character name) | Yes, redacted at write-time | Passed through `redactSecrets()` (the same function every other command's Discord-facing output already uses) before ever reaching the database — see Security Review FINDING-AUDIT-1. |
| Steam IDs, real names, emails | No, by construction | If any of the above `detail` fields ever happened to contain one, `redactSecrets()` would strip it before persistence — this feature does not knowingly collect any of these categories, and actively guards against accidentally retaining them if a caller's `detail` payload ever included one. |
| OAuth tokens | No | This feature has no relationship to the Steam-link OAuth flow's token handling — `player:link`'s Steam-connections branch only records that a button was *offered*, never anything about the OAuth exchange itself (see Architecture doc's explanation of why that branch records its own separate event). |

## Retention

**14 days**, age-based, automatically enforced (`pruneAuditLog()`, run at
startup and every 24 hours thereafter — see Design doc's Retention
section). This is the first concrete retention figure for any of this
bot's own logs (as opposed to CI logs) — begins narrowing
`compliance/controls/soc2-matrix.md`'s MD-03 ("Log retention (90 days)",
currently `⚠️ Partial`) gap, though 14 days is this one table's own
retention, not the full 90-day figure that control describes for logs
generally.

**Found while writing this section, unrelated to this feature's own
code:** MD-03's own row in `soc2-matrix.md` links to
`policies/log-retention.md`, which does not exist anywhere in this
repository (`compliance/policies/` has `access-review.md`,
`data-classification.md`, `threat-model.md` — no `log-retention.md`).
This is a pre-existing broken link, not something this feature
introduced or is scoped to fix — flagged here rather than silently
worked around, since a future reader following that link from MD-03
would otherwise hit a dead end with no explanation.

## Third-Party Data Handling

None. This feature introduces no new third-party API call, no new OAuth
scope, and no new external service dependency — it is a purely internal
persistence-and-read-command addition to functionality (the `write`/
`admin:broadcast`/`player:*` command families) that already existed and
was already reachable by the same set of Discord users.

## Dependency and Supply-Chain Review

**No new npm package required.** `better-sqlite3` is already a
`package.json` dependency (used by every other table in `database.js`);
this feature's table and query functions use the exact same driver and
connection object every other table already shares — no new connection
pool, no new driver version constraint.

## Required Evidence for the Implementation PR

Per this repo's existing conventions
(`docs/soc2-alignment.md`'s Required Evidence Discipline):

- PR body using `.github/PULL_REQUEST_TEMPLATE.md`.
- A durable change note under `docs/changes/` per this repo's existing
  convention (see `docs/changes/README.md`'s index table format).
- Passing tests: `npm run check` (full suite) plus the two new
  feature-specific files (`test/database.test.js`, `test/auditLog.test.js`)
  and the extended `test/discord-bot-test-harness.js` "Audit Logging"
  suite.
- Passing security gates: Semgrep, Gitleaks, `npm audit` — no new
  findings expected given zero new dependencies.
- Explicit confirmation that the full test suite still passes with
  SQLite now opened unconditionally (verifying no regression to
  single-tenant-mode behavior for the *other* tables that db object
  serves) — not just that the new `audit_log`-specific tests pass in
  isolation.

## Non-Goals / Explicit Scope Boundary

- **Not a claim of forensic-grade tamper-evidence** — see Security Review
  FINDING-AUDIT-2. This is an operational accountability log for "who ran
  what destructive command, when, with what outcome," useful for a guild
  admin reviewing recent activity — it is not designed or claimed to
  withstand adversarial tampering by someone with direct database file
  access.
- **Does not change this bot's Privacy Policy** in any way requiring a
  policy-text update — no new data category is collected beyond what
  `compliance/policies/data-classification.md`'s existing language
  ("Discord actor context," command parameters) already covers; this
  feature only adds a new *durable record* of data this bot's commands
  already processed transiently on every prior invocation.
- **Does not extend to Core-side audit events** for whatever happens once
  the upstream write-adapter contract actually lands and `write:*`
  commands begin executing for real — that's `docs/rw-adapter-contract.md`'s
  "Audit Events (Console-Side)" concern, a different (Core-side, not
  bot-side) audit trail this feature does not attempt to unify with or
  supersede.

## Sources

- [Design](audit-log-design.md)
- [Architecture](audit-log-architecture.md)
- [Security Review](audit-log-security-review.md)
- [SOC 2 Alignment Notes](soc2-alignment.md)
- `compliance/controls/soc2-matrix.md` — MD-03, the control this feature's retention policy begins to address (note: this control's own `policies/log-retention.md` link is broken — see Retention section above)
- `compliance/policies/data-classification.md` — existing policy doc this feature's data categories are already covered by
