# ACP Issue Bridge — Troubleshooting

## "Mint ACP Issue Bridge installation token" step fails

**Cause:** the GitHub App doesn't exist yet, the secrets aren't set, or
the App isn't installed on the repository the workflow is running in.

**Fix:** complete `github-app.md`'s setup steps. This is the expected,
intentional failure mode when the App isn't configured yet — the bridge
fails closed rather than falling back to a broader credential.

## A public issue was opened but no private mirror appeared

1. Check the `issue-bridge-public-created.yml` run in the public repo's
   Actions tab for the actual error.
2. Common causes: App token mint failed (see above); `sync.
   public_issue_create: false` in config; the issue was actually a pull
   request (PRs fire the same `issues` webhook shape and are
   intentionally skipped).
3. If the run succeeded but reported `{"action":"blocked","reason":
   "ambiguous-correlation", ...}`, see "Recovering from sync:error" in
   `administration.md`.

## A `/public` (or `/public-status`/`/public-resolution`) comment did nothing

This is very often **correct behavior**, not a bug:

- No public action is the default for any comment that isn't recognized
  as a command (SEC-001) — check the exact command spelling and that it
  is the very first line of the comment, with no leading `>` or code
  fence.
- Check for an internal-only acknowledgement comment the bridge may have
  posted explaining why: unauthorized (wrong permission level),
  publication blocked (`sync:paused`/`sync:error`/
  `visibility:security-sensitive` present), or a secret-scanner block
  ("Detection category: ...").
- If nothing was posted at all, check the workflow run itself for a
  `CONFIGURATION`/`CORRELATION`/`UNKNOWN`-classified failure.

## Publication was blocked with "Detection category: ..."

The secret scanner found something that looked like a credential,
private URL, or similar sensitive pattern (`security-model.md` has the
full list). Review your text, remove the sensitive value, and resubmit a
new `/public` (or `/public-status`/`/public-resolution`) comment — the
bridge never echoes what it detected, by design, so you'll need to
re-read your own comment to find it.

If you believe this is a false positive (e.g. a placeholder value that
happens to look secret-shaped), rewrite it more explicitly as a
placeholder (the scanner already exempts common placeholder tokens like
`CHANGEME`/`example`/`<...>`/`${...}`) rather than requesting a scanner
change for a one-off case.

## Config drift check failed

`issue-bridge-maintenance.yml`'s `check` step reported `drift: true`, or
failed because the public repo hasn't published a checksum yet.

1. Confirm both repos' `.github/acp-issue-bridge.yml` are actually
   identical: `diff <(gh api repos/Project-Arrakis/sentinel-support/contents/.github/acp-issue-bridge.yml --jq '.content' | base64 -d) <(gh api repos/Project-Arrakis/sentinel/contents/.github/acp-issue-bridge.yml --jq '.content' | base64 -d)`
2. If they differ, decide which is correct, copy it to the other repo,
   commit, and push — this triggers `issue-bridge-maintenance.yml`'s
   `push` trigger on the config file path automatically.
3. If the public repo simply hasn't run its `publish` step yet, manually
   trigger `issue-bridge-maintenance.yml` there via `workflow_dispatch`.

## Labels are missing on a newly mirrored issue

`maintenance-bootstrap-labels.mjs` only *creates* labels that don't
exist — it never renames or recolors an existing one. If a label was
deleted from the repository after being bootstrapped, re-run the
maintenance workflow (`workflow_dispatch`) to recreate it.

## An actor with the right Discord/GitHub role still gets "unauthorized"

Authorization here is a **GitHub repository role** (`write`/`maintain`/
`admin` on `Project-Arrakis/sentinel`), not a Discord role — the
two are unrelated permission systems. Grant the actor the appropriate
GitHub collaborator role on the private repository, not a Discord role.

## GitGuardian PR check flags `secretScan.test.js`'s own fixtures

`secretScan.test.js` deliberately contains fake JWT and generic-high-
entropy-shaped strings to verify the scanner detects these patterns (see
`testing.md`). Gitleaks and Semgrep are configured (via
`.gitleaks.toml`/`.semgrepignore`) to ignore this file; GitGuardian's
GitHub PR check is a separate, dashboard-backed integration and requires
a different remediation: mark the specific incident IDs as `Ignored`
(reason: `false_positive`) via the GitGuardian dashboard or API
(`POST /v1/incidents/secrets/{id}/ignore`), rather than via a repo-local
config file — `.gitguardian.yaml`'s `ignored_matches` governs the local
`ggshield` CLI/pre-commit hook only, it does not affect the hosted
GitHub PR check, which evaluates the full commit history of the PR
against GitGuardian's own incident database regardless of local config.
**The PR check's cached status does not automatically refresh** just
because the underlying incident was marked ignored via the API/dashboard
— a new commit (or closing/reopening the PR) is needed to trigger a
fresh GitGuardian scan that reflects the current ignored state.

## Where to look for evidence

Every decision emits a structured, single-line JSON audit event
(`audit.mjs`) to the workflow's own log output — search the relevant
workflow run's log for `event_type` values matching what you're
investigating (see `security-model.md`'s control table for which module
emits which). Never expect to find a raw comment body or secret value in
these logs — they're deliberately excluded from the audit schema.
