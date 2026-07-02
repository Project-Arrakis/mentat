# PR-0032: Update Pinned Workflow Actions

## Summary

Updates the pinned GitHub Actions SHAs for `actions/setup-python` and
`actions/upload-artifact` while preserving the immutable pinning policy added
in PR #31.

This PR supersedes Dependabot PRs #28 and #29 so the repository can keep clean
PR metadata and one durable security-maintenance evidence record.

## User Impact

Operators should see no runtime behavior change. The change affects repository
automation only.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged.
- Secret handling: unchanged.
- Data crossing Discord/bot/WebUI boundaries: unchanged.
- Network exposure: unchanged.
- Workflow supply chain: maintained through immutable full-SHA action pins.

## Least Privilege

Runtime least privilege is unchanged. Workflow permissions are unchanged.

## Tests and Evidence

- `npm run check`
- `npm audit --audit-level=moderate`
- Direct workflow search for version-tag and branch-name action references
- Durable docs/tool-reference search
- Release artifact checksum verification
- GitHub Security Gates
- Release Artifacts workflow dispatch on this branch

## Known Limitations

The release-artifact upload action is exercised through the Release Artifacts
workflow rather than ordinary CI, so that workflow should be dispatched before
merge.

## Sources

- Superseded pull request: #28
- Superseded pull request: #29
- Resolved pull request: #32
