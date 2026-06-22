# Change Notes Index

Change and issue note filenames start with the GitHub object type and number:

- `PR-####` for pull requests
- `IS-####` for issues
- `CM-####` for commits that predate the PR convention

Gaps in the pull request sequence are expected when the GitHub number belongs to
an issue instead of a pull request.

| ID | Type | Title | Link or commit |
| --- | --- | --- | --- |
| `CM-0000` | Commit | Initial read-only Discord bot scaffold | `077aa41` |
| `PR-0001` | PR | Add CI security scan gates | PR #1 |
| `PR-0002` | PR | Add public readiness and transparency docs | PR #2 |
| `PR-0003` | PR | Polish documentation voice | PR #3 |
| `PR-0004` | PR | Finalize roadmap and add command RBAC | PR #4 |
| `IS-0005` | Issue | Fix Dependabot dependency update configuration | Issue #5 |
| `PR-0006` | PR | Add adapter contract fixtures | PR #6 |
| `PR-0007` | PR | Fix dependency security operations | PR #7 |
| `PR-0008` | PR | Add local adapter mock | PR #8 |
| `IS-0009` | Issue | Expand PII redaction for game identity fields | Issue #9 |
| `PR-0010` | PR | Add about command | PR #10 |
| `PR-0011` | PR | Normalize change note identifiers | PR #11 |
| `PR-0012` | PR | Expand PII redaction for game identity fields | PR #12 |
| `PR-0013` | PR | Add ping command | PR #13 |
| `PR-0014` | PR | Add status summary command | PR #14 |
| `PR-0015` | PR | Add structured redacted logs | PR #15 |

Every future substantive PR should add or update its matching change note before
merge. If a security finding is tracked as an issue, record the issue in this
index and link the resolving PR from the issue.
