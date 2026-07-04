# R4.0.0+ — Highest-Risk Operations

**Version**: v4.0.0
**Branch**: `release/v4.0.0`
**PR**: [#56](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/56)
**State**: Open (planning only)

## Scope

Player, game-state, restore, or database-adjacent operations. Only after lower-risk trains are proven.

## Candidate Areas

- Player moderation
- Player messaging
- Gameplay-affecting configuration changes
- Restore execution
- Database-backed operations

## Default Stance

- Do not implement unless upstream exposes a narrow, audited, purpose-built adapter action
- Do not expose raw database execution through Discord
- Do not start with player or restore operations

## Required Controls

- [ ] Owner-level authorization or equivalent
- [ ] Out-of-band approval where practical
- [ ] Enhanced privacy review
- [ ] Abuse-case review
- [ ] Audit retention expectation
- [ ] Rollback or recovery proof
- [ ] Incident response notes
- [ ] Operator training or runbook update

## Go/No-Go Gates

- [ ] Any uncertain privacy, abuse, restore, or data-integrity risk blocks merge
- [ ] Any ambiguous upstream side effect blocks merge
- [ ] Any unresolved medium/high/critical finding blocks merge
- [ ] No stable release without at least one RC and owner approval

## Artifacts

| Artifact | Location |
|----------|----------|
| Change note | `docs/changes/PR-0055-v4.0.0-highest-risk-ops.md` |
| Release notes | `docs/releases/v4.0.0.md` |
| Non-read-only roadmap | `docs/non-readonly-roadmap.md` |

## Entry Criteria

- [ ] R3.0.0 merged and operational writes proven
- [ ] R3.x operational maturity releases complete
- [ ] Upstream highest-risk adapter actions available
- [ ] Enhanced privacy and abuse-case reviews completed
