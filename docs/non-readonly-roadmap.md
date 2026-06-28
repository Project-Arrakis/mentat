# Non-Read-Only Roadmap

## Status

This roadmap is planning only. The bot remains read-only. No write command
should be implemented until upstream publishes a write-capable adapter contract
and the controls in this document are designed, tested, and reviewed.

Write access changes the risk profile. Treat every write-capable command as an
administrative action against a self-hosted game server, not as a convenience
shortcut.

## Non-Negotiable Preconditions

Before any write command ships:

- Upstream must expose an explicit write-capable adapter contract.
- The write adapter must be disabled by default.
- Write routes must be separate from read-only routes.
- Every write route must document method, path, payload schema, response schema,
  authorization tier, side effects, idempotency, and rollback expectation.
- The bot must keep read-only commands usable without enabling write routes.
- CI must still pass every existing security gate.
- A STRIDE review must be recorded for the command family.
- A GitHub issue must track the write command family before implementation.

## Required Controls

Each write command family needs:

- restricted-by-default command RBAC
- separate write-admin role allow-list, not inherited from observer roles
- optional explicit user allow-list for break-glass use
- confirmation flow that shows the action, target, and risk before execution
- dry-run or preview mode when upstream can support it
- structured audit log entry with actor, command, target, result, correlation
  ID, timestamp, and adapter route
- redaction for secrets, emails, SteamIDs, FuncomIDs, and explicit real-name
  fields in prompts, responses, and logs
- rate limits and concurrency limits
- timeout and retry rules that avoid duplicate writes
- rollback or recovery instructions in documentation
- tests for authorized, unauthorized, malformed, failed, and redacted outcomes

Do not add write commands to public channels by default. Write command responses
should remain ephemeral unless a command-specific review justifies otherwise.

## Adapter Contract Requirements

Write adapter requests should include:

- Discord actor context
- requested action
- target identifier
- confirmation token or nonce
- idempotency key for repeat protection
- optional dry-run flag

Write adapter responses should include:

- `ok`
- operation name
- side effect summary
- audit/correlation ID
- dry-run status
- rollback hint when applicable
- redacted error details

The bot should reject write operations when upstream does not advertise
`writesEnabled: true` for the relevant route.

## STRIDE Checklist

| Category | Minimum review questions |
| --- | --- |
| Spoofing | How is the Discord actor authenticated and bound to the write request? |
| Tampering | How are target IDs, payloads, confirmation nonces, and idempotency keys validated? |
| Repudiation | What audit evidence proves who requested, confirmed, and executed the action? |
| Information disclosure | What sensitive data can appear in previews, failures, audit logs, and Discord output? |
| Denial of service | What rate limits, concurrency limits, and timeout behavior prevent operational disruption? |
| Elevation of privilege | Which roles can run the command, and how is observer access prevented from inheriting writes? |

## Candidate Phases

### Phase 0: Write Safety Foundation

No user-facing write commands.

- Add write-disabled config defaults.
- Add write-specific RBAC variables.
- Add confirmation primitives.
- Add idempotency key generation.
- Add audit log schema and redaction tests.
- Add adapter write capability discovery tests.

### Phase 1: Low-Risk Administrative Writes

Only if upstream supports safe write routes with clear side effects.

- maintenance note or maintenance-window metadata
- Discord-only notification configuration
- bot-owned scheduled post configuration

These should not restart services, mutate game data, or affect player state.

### Phase 2: Operational Writes

Higher scrutiny. One command family per PR.

- service restart
- update trigger
- backup creation
- cache clear or safe maintenance operation

Require dry-run support where possible, explicit confirmation, audit logs, and
rollback documentation.

### Phase 3: Player or Game-State Writes

Highest scrutiny. Do not start here.

- player moderation
- player messaging
- configuration changes that affect gameplay
- database-backed operations
- restore operations

These need additional privacy review, abuse-case review, stronger audit
retention expectations, and operator approval outside Discord when practical.

## PR Requirements

Each write-capable PR must include:

- matching GitHub issue reference
- durable `docs/changes/PR-####` note
- STRIDE table
- RBAC matrix
- adapter contract evidence
- tests for allow, deny, confirmation, adapter failure, timeout, redaction, and
  audit output
- full local gates and GitHub Actions evidence
- clear rollback or disable instructions

Do not batch unrelated write command families in one PR.

## Go/No-Go Criteria

Do not merge a write command if any of these are true:

- upstream contract is missing or ambiguous
- route can perform more than the documented action
- command can run without a write-specific role or user principal
- confirmation can be bypassed
- audit logs can leak secrets or PII
- retry behavior can duplicate side effects
- rollback or disable path is unclear
- any medium, high, or critical security finding is unresolved

## First Recommended Slice

The first non-read-only PR should not add a write command. It should add only
write-readiness scaffolding:

- write-disabled configuration defaults
- write-specific RBAC parsing
- confirmation helper tests
- audit event schema tests
- documentation and STRIDE evidence

That keeps the first step reversible and lets the security model mature before
the bot can change server state.
