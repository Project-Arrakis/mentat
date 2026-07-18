# R2.x — Low-Risk Administrative Writes

Low-impact metadata and notification writes. One command family per PR.

## Release Manifest

| Version | PR | Branch | Scope |
|---------|----|--------|-------|
| v2.1.0 | [#57](https://github.com/yacketrj/Arrakis-Control-Panel/pull/57) | `release/v2.1.0` | Maintenance note set, maintenance window set |
| v2.2.0 | [#58](https://github.com/yacketrj/Arrakis-Control-Panel/pull/58) | `release/v2.2.0` | Discord notification configuration set |
| v2.3.0 | [#59](https://github.com/yacketrj/Arrakis-Control-Panel/pull/59) | `release/v2.3.0` | Bot-owned scheduled post configuration |
| v2.4.0 | [#60](https://github.com/yacketrj/Arrakis-Control-Panel/pull/60) | `release/v2.4.0` | R3 readiness review |

## Required Controls (per PR)

- [ ] One command family per PR
- [ ] Matching GitHub issue before implementation
- [ ] Dry-run or preview when upstream supports it
- [ ] Explicit confirmation with action, target, risk
- [ ] Idempotency key on execute
- [ ] Audit correlation ID
- [ ] Ephemeral Discord responses by default
- [ ] Rollback or disable instructions

## Go/No-Go Gates

- [ ] Command cannot restart services, mutate game data, or affect player state
- [ ] Adapter route cannot perform broader side effects than command label
- [ ] No sensitive data appears in preview, failure, audit, or Discord output
- [ ] Failed/retried writes cannot duplicate side effects

## Artifacts

| Artifact | Location |
|----------|----------|
| Change notes | `docs/changes/PR-00{57-60}-*.md` |
| Release notes per version | `docs/releases/v{2.1..2.4}.0.md` |
| Non-read-only roadmap | `docs/non-readonly-roadmap.md` |

## Entry Requirement

R2.0.0 must be merged before any R2.x implementation begins.
