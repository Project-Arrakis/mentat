# R2.0.0 — Write-Safety Foundation

**Version**: v2.0.0
**Branch**: `release/v2.0.0`
**PR**: [#49](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/49)
**State**: Open (planning only)

## Scope

Write readiness foundation. No executable write commands in this release.

## Required Upstream Condition

- [ ] Upstream publishes and approves a write-capable adapter contract

## Required Foundation

- [ ] Write routes disabled by default (`DUNE_DISCORD_WRITES_ENABLED=false`)
- [ ] Write-specific feature flag
- [ ] Write-specific RBAC (observer roles do not inherit)
- [ ] Capability discovery before command rendering
- [ ] Confirmation primitives
- [ ] Idempotency key generation
- [ ] Audit event schema
- [ ] Write adapter timeout and retry rules
- [ ] Redaction tests for previews, failures, and audit output
- [ ] STRIDE and abuse-case review

## Artifacts

| Artifact | Location |
|----------|----------|
| Change note | `docs/changes/PR-0049-v2.0.0-write-foundation.md` |
| Release notes | `docs/releases/v2.0.0.md` |
| Upstream RFC | `docs/upstream-write-adapter-rfc.md` |

## Entry Criteria (not yet met)

- [ ] All R1.x releases merged and stable
- [ ] Upstream write-contract evidence recorded
- [ ] Every write path defaults disabled
- [ ] No observer role can execute writes
- [ ] Confirmation cannot be bypassed
- [ ] Idempotency tested
- [ ] Audit output structured and redacted
