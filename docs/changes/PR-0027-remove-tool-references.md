# PR-0027: Remove Tool-Specific PR and Documentation References

## Summary

Reviews GitHub pull request titles, bodies, review comments, and issue comments
for tool or provider references. Editable PR metadata did not contain matching
references. The only remaining matches were historical source-branch names
stored by GitHub on merged pull requests.

Updates durable repository documentation to avoid workspace-specific local paths
that exposed the tooling folder name, and adds a unit guard for documentation
and PR templates.

## User Impact

Operators should see no runtime behavior change. Documentation now uses a
portable sibling-path reference for the upstream source clone.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged.
- Secret handling: unchanged.
- Data crossing Discord/bot/WebUI boundaries: unchanged.
- Network exposure: unchanged.

## Least Privilege

Runtime least privilege is unchanged. The change only affects documentation and
test coverage for durable documentation.

## Tests and Evidence

- `npm run check`
- Repository content search for tool and provider references
- GitHub pull request metadata/comment review for open and closed PRs

## Known Limitations

GitHub preserves historical source-branch names on merged pull requests. Those
references are not editable PR title, body, comment, or review text and were not
rewritten.

## Sources

- GitHub pull request API metadata for this repository
- Existing upstream source documentation: `docs/upstream-source.md`
- Existing adapter contract documentation: `docs/adapter-contract.md`
