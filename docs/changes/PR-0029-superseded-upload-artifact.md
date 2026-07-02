# PR-0029: Superseded upload-artifact Dependency Update

## Summary

Dependabot opened PR #29 to update the pinned `actions/upload-artifact`
workflow action from the reviewed `v5.0.0` commit to the reviewed `v7.0.1`
commit.

The update was not merged directly. It was superseded by a combined
security-maintenance pull request so the repository could keep one durable
change note, clean PR metadata, and the immutable action pinning policy.

## User Impact

Operators should see no runtime behavior change.

## Security Impact

- Command surface: unchanged.
- RBAC or authorization: unchanged.
- Secret handling: unchanged.
- Data crossing Discord/bot/WebUI boundaries: unchanged.
- Network exposure: unchanged.
- Workflow supply chain: maintained through full commit-SHA pinning.

## Least Privilege

Runtime least privilege is unchanged. Workflow permissions are unchanged.

## Tests and Evidence

- PR #29 CI and Security Gates passed before superseding.
- The resolving combined PR reruns local checks and GitHub Security Gates.

## Known Limitations

This change note records why PR #29 was closed without merge. The actual
workflow dependency update is applied by the resolving combined PR.

## Sources

- Superseded pull request: #29
