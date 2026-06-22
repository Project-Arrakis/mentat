# Change Note: Change Note Identifiers

## Summary

PR #11 normalized durable change and issue note filenames to use explicit GitHub
object prefixes: `PR-####`, `IS-####`, and `CM-####`.

## Security Impact

- Improved auditability for security and change-management evidence.
- Added retrospective notes for the initial scaffold and PRs #1-#3.
- Added issue evidence notes for issue #5 and issue #9.
- Did not change runtime behavior, command surface, RBAC, network exposure, or
  adapter data handling.

## Evidence

- Pull request: #11
- Merge commit: `345101d`
- Primary files: `docs/changes/`, `docs/pr-transparency-template.md`

## Notes

This note was added in the next PR because the PR number was assigned only after
the branch was opened.
