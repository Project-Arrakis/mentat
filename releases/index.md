# Release Staging Index

Staging area for **future** upstream PRs. **No upstream PRs are open.**
All feature work is implemented on local branches, tested, and staged.
When a train is validated, use `pr-body.md` with `gh pr create --body-file`.

## Version History Note

This project's version numbering restarted at `v1.0.0-rc.1` when the repo
was renamed from `dune-awakening-selfhost-discordbot` to
`arrakis-control-panel` (commit `a15d4a8`, 2026-07-20). An earlier numbering
line reached `v1.5.0` in `package.json` before that rename, but **no
`v1.1.0`&ndash;`v1.5.0` git tag or GitHub Release was ever created** — that
work landed on `main` under the old name and its features are still present
in the codebase, but the version *number* itself was abandoned, not the code.
The `Release Train Manifest` below is kept as a historical record of what was
implemented under the old numbering; see `## Current Implementation State`
for the real, current version.

## Current Implementation State — main (v1.0.0-rc.2)

| Feature | Status | Source |
|---------|--------|--------|
| 7 read-only commands (original R1.0.0 scope) | Implemented | `src/commands.js` |
| Population command | Implemented | `src/commands.js`, `src/adapterClient.js` |
| Backup list command | Implemented | `src/commands.js`, `src/adapterClient.js` |
| Operator validation | Implemented | `scripts/validate-operator.js`, `test/operatorValidation.test.js` |
| Notification scheduler | Implemented | `src/scheduler.js`, `src/notifications.js` |
| Adapter compatibility check | Implemented | `scripts/check-compatibility.js` |
| Command cooldowns | Implemented | `src/cooldown.js` |
| Write-safety foundation | Implemented (never executes) | `src/writes.js`, `src/writeHandler.js` |
| Write confirmation UI | Implemented (never executes) | `src/writeConfirmation.js` |
| Write command stubs (unused, dead code) | Present but not imported by `commands.js` | `src/writeCommands.js` |
| Health-state permissions | Implemented | `src/healthState.js` |
| Multi-tenant architecture, OAuth2 setup portal | Implemented | `src/setupServer.js`, `src/database.js` |
| Status cards, faction theming | Implemented | `src/statusCard.js`, `src/embedFormat.js` |
| Dependabot cooldown | Implemented | `.github/dependabot.yml` |
| Gitleaks allowlist | Implemented | `.gitleaksignore` |

## Strict Gates — main (v1.0.0-rc.2)

Re-run and record actual numbers before relying on this table; the values
below are a point-in-time snapshot and will drift as tests are added.

| Gate | Result (as of 2026-07-22) |
|------|--------|
| `npm run check` | 328/328 tests pass (268 via `node --test`, 60 via `discord-bot-test-harness.js`) |
| Release metadata | OK for v1.0.0-rc.2 |
| `npm audit --audit-level=moderate` | Re-run before relying on this |
| Semgrep / Gitleaks / Trivy | Re-run before relying on this |
| Addon package | Zero-permission, checksum verified |
| SBOM | Generated |

## Release Train Manifest (Historical — Old Numbering, Never Tagged)

The trains below describe real feature work that landed on `main`, using a
version-number scheme that was later abandoned. None of these versions were
ever tagged or released; do not treat this table as current release status.

| Train | Old Version Label | Scope | Status |
|-------|---------|-------|--------|
| R1.0.0 | v1.0.0 (old label) | Stable read-only GA | Superseded — real target is now `v1.0.0-rc.2` → `v1.0.0` |
| R1.1 | v1.1.0 (old label) | Operator validation | Feature work merged to main; version number abandoned |
| R1.2 | v1.2.0 (old label) | Population command | Feature work merged to main; version number abandoned |
| R1.3 | v1.3.0 (old label) | Notification scheduler | Feature work merged to main; version number abandoned |
| R1.4 | v1.4.0 (old label) | Compatibility check | Feature work merged to main; version number abandoned |
| R1.5 | v1.5.0 (old label) | R2 readiness review | Feature work merged to main; version number abandoned |
| — | v1.5.0 (old label) | Command cooldowns | Feature work merged to main; version number abandoned |
| — | v1.5.0 (old label) | Backup list | Feature work merged to main; version number abandoned |
| R2.0.0+ | v2.0.0 (old label) | Write foundation + 12 command families | Feature work merged to main (`src/writes.js`, `src/writeHandler.js`); still disabled by default, execution not wired |

## R2/Write-Capable Status

Write commands are scaffolded (`src/writeHandler.js`, `src/writeConfirmation.js`)
but disabled by default and never call `adapterClient.writeExecute()`/
`writePreview()` — no upstream write-adapter contract exists yet. See
`docs/upstream-write-adapter-rfc.md` and `docs/r1-r2-release-roadmap.md`.

## Staging Rules

1. **Read-only first**: R1.x read-only features are implemented on `main`.
2. **Upstream dependency**: R2+ releases require upstream write-adapter contract approval.
3. **Gates**: All universal gates from `docs/full-release-roadmap.md` are met on main.
4. **Security**: Zero unresolved medium/high/critical security findings.
5. **No upstream PRs created**: All work is local, staged in `releases/<train>/pr-body.md`.
6. **Version continuity**: Before creating any new version-bump PR, confirm the
   target version follows from `package.json`'s actual current value
   (`1.0.0-rc.2` as of this writing), not from any value in this file's
   historical manifest above.

## Next Steps

1. Decide whether to promote `v1.0.0-rc.2` to stable `v1.0.0`, or cut another
   release candidate first.
2. Implement remaining additional features from `docs/additional-features-roadmap.md`
   (note: that document also needs its version/branch references corrected
   to match the current `v1.0.0-rc.2` baseline — do not follow its old
   `v1.1.0`&ndash;`v1.5.0` branch names literally).
3. Merge into main; re-run strict gates and update the snapshot above.
4. Only when all gates pass and upstream write contract is approved,
   open PRs using the staged `gh-create.sh` scripts.
