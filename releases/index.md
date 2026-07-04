# Release Staging Index

Staging area for upstream PRs organized by release train.
Each subdirectory contains the PR artifacts for that release.

## Release Train Manifest

| Train | Version | Scope | PR | Branch | Status |
|-------|---------|-------|----|--------|--------|
| R1.0.0 | v1.0.0 | Stable read-only GA | [#43](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/43) | `release/v1.0.0` | Open |
| R1.1 | v1.1.0 | Operator validation | [#44](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/44) | `release/v1.1.0` | Open |
| R1.2 | v1.2.0 | Read-only detail expansion | [#45](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/45) | `release/v1.2.0` | Open |
| R1.3 | v1.3.0 | Read-only notifications | [#46](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/46) | `release/v1.3.0` | Open |
| R1.4 | v1.4.0 | Compatibility hardening | [#47](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/47) | `release/v1.4.0` | Open |
| R1.5 | v1.5.0 | R2 readiness review | [#48](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/48) | `release/v1.5.0` | Open |
| R2.0.0 | v2.0.0 | Write-safety foundation | [#49](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/49) | `release/v2.0.0` | Open |
| R2.1 | v2.1.0 | Maintenance metadata writes | [#57](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/57) | `release/v2.1.0` | Open |
| R2.2 | v2.2.0 | Notification config writes | [#58](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/58) | `release/v2.2.0` | Open |
| R2.3 | v2.3.0 | Scheduled-post config writes | [#59](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/59) | `release/v2.3.0` | Open |
| R2.4 | v2.4.0 | R3 readiness review | [#60](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/60) | `release/v2.4.0` | Open |
| R3.0.0 | v3.0.0 | Operational writes | [#61](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/61) | `release/v3.0.0` | Open |
| R4.0.0+ | v4.0.0 | Highest-risk ops | [#56](https://github.com/yacketrj/dune-awakening-selfhost-discordbot/pull/56) | `release/v4.0.0` | Open |

## Artifacts per PR

Each release PR folder contains:
- `PR-####.md` - PR body or summary
- Reference to `docs/changes/PR-####.md` - Durable change note
- Reference to `docs/releases/vMAJOR.MINOR.PATCH.md` - Release notes (where applicable)
- Staging checklist

## Staging Rules

1. **Read-only first**: No RW release may merge before R1.x read-only maturity is complete
2. **Upstream dependency**: R2+ releases require upstream write-adapter contract approval
3. **Gates**: All universal gates from `docs/full-release-roadmap.md` must be met
4. **Security**: Zero unresolved medium/high/critical findings
5. **Documentation**: Each PR has matching change note and (for releases) release notes
