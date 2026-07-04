# R1.x — Read-Only Maturity

Read-only maturity releases that improve operator value without changing server state.

## Release Manifest

| Version | PR | Branch | Scope |
|---------|----|--------|-------|
| v1.1.0 | [#44](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/44) | `release/v1.1.0` | Operator validation: smoke tests, validation checklist, runtime verification |
| v1.2.0 | [#45](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/45) | `release/v1.2.0` | Detail expansion: richer service detail, grouped readiness, aggregate player summary |
| v1.3.0 | [#46](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/46) | `release/v1.3.0` | Notifications: scheduled status posts, readiness/service alerts, incident digests |
| v1.4.0 | [#47](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/47) | `release/v1.4.0` | Compatibility hardening: drift detection, fixture refresh, enhanced route coverage |
| v1.5.0 | [#48](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/48) | `release/v1.5.0` | R2 readiness review: comprehensive security review, R2 entry criteria documented |

## Artifacts

| Artifact | Location |
|----------|----------|
| Release process | `docs/release-process.md` |
| Change notes | `docs/changes/PR-00{44-48}-*.md` |
| Release notes per version | `docs/releases/v{1.1..1.5}.0.md` |

## Read-Only Gates

- [ ] Every feature remains read-only by contract and test
- [ ] Scheduled output has channel allow-lists and rate limits
- [ ] Player-related output is aggregate-only (or privacy-approved)
- [ ] Discord output remains bounded and redacted
- [ ] Route compatibility tests cover new adapter assumptions
- [ ] No unresolved medium/high/critical findings

## Sequencing

v1.1.0 through v1.5.0 are sequential. Each builds on the prior release's evidence.
All R1.x releases must be complete before R2.0.0 implementation begins.
