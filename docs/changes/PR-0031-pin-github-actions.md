# PR-0031: Pin GitHub Actions to Immutable Commit SHAs

## Summary

Pins all GitHub Actions workflow `uses:` references to full 40-character commit
SHAs and keeps the reviewed release tag as an inline comment. Adds a unit guard
that fails if future workflow edits use mutable action tags or branch names.

This resolves the Semgrep finding tracked in issue #30.

## User Impact

Operators should see no runtime behavior change. The change only affects
repository automation.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged.
- Secret handling: unchanged.
- Data crossing Discord/bot/WebUI boundaries: unchanged.
- Network exposure: unchanged.
- Workflow supply chain: improved by removing mutable action references.

## Least Privilege

Runtime least privilege is unchanged. Workflow permissions are unchanged.

## Tests and Evidence

- `npm run check`
- `npm audit --audit-level=moderate`
- Direct workflow search for version-tag and branch-name action references
- GitHub Security Gates
- Release artifact checksum verification

## Known Limitations

Pinned action SHAs need routine review when action release tags are
intentionally upgraded. The inline comments record the reviewed release tag for
maintainability.

## Sources

- Semgrep finding run:
  https://github.com/yacketrj/Arrakis-Control-Panel/actions/runs/28610395001
- Tracking issue: #30
- Resolved pull request: #31
