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
| `PR-0016` | PR | Add Docker healthcheck | PR #16 |
| `PR-0017` | PR | Package zero-permission addon releases | PR #17 |
| `PR-0018` | PR | Add SBOM and dependency review gates | PR #18 |
| `PR-0019` | PR | Record read-only security review | PR #19 |
| `PR-0020` | PR | Add non-read-only roadmap | PR #20 |
| `PR-0021` | PR | Add release practices | PR #21 |
| `PR-0022` | PR | Add release candidate roadmap | PR #22 |
| `PR-0023` | PR | Prepare v0.1.1-rc.1 | PR #23 |
| `PR-0024` | PR | Promote v0.1.1 | PR #24 |
| `PR-0025` | PR | Add upstream write adapter RFC | PR #25 |
| `IS-0026` | Issue | Moved: WSL2 native Docker vehicle rubber-banding investigation | Issue #26 |
| `PR-0027` | PR | Remove tool-specific PR and documentation references | PR #27 |
| `PR-0028` | PR | Superseded setup-python dependency update | PR #28 |
| `PR-0029` | PR | Superseded upload-artifact dependency update | PR #29 |
| `IS-0030` | Issue | Pin GitHub Actions to immutable commit SHAs | Issue #30 |
| `PR-0031` | PR | Pin GitHub Actions to immutable commit SHAs | PR #31 |
| `PR-0032` | PR | Update pinned workflow actions | PR #32 |
| `PR-0033` | PR | Refresh upstream v1.3.40 compatibility evidence | PR #33 |
| `PR-0034` | PR | Add R1.0.0 production release plan | PR #34 |
| `PR-0035` | PR | Add full release roadmap with gates | PR #35 |
| `PR-0036` | PR | Refresh upstream v1.3.41 compatibility evidence | PR #36 |
| `PR-0037` | PR | Add R1.x to R2.x release roadmap | PR #37 |
| `PR-0038` | PR | Add R1.1 operator validation smoke path | PR #38 |

Every future substantive PR should add or update its matching change note before
merge. If a security finding is tracked as an issue, record the issue in this
index and link the resolving PR from the issue.
