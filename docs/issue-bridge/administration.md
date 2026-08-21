# ACP Issue Bridge — Administration

## One-time setup

1. Create the GitHub App — see `github-app.md` (the one manual step).
2. Set `ACP_ISSUE_BRIDGE_APP_ID` and `ACP_ISSUE_BRIDGE_PRIVATE_KEY` as
   encrypted secrets on **both** repositories.
3. Merge this implementation's branch on both repositories (labels are
   already bootstrapped live — see the completion report — but
   `issue-bridge-maintenance.yml` will re-verify/re-create them
   idempotently on first run regardless).
4. Manually run `issue-bridge-maintenance.yml` via `workflow_dispatch` on
   both repositories and confirm both jobs go green.
5. Run the safe live smoke test in `testing.md` before relying on the
   bridge for real issues.

**Before the App exists**, the private repo's
`issue-bridge-maintenance.yml` deliberately SKIPS its cross-repo
config-drift check (rather than failing the job) with a visible
`::warning::` annotation, so merging this implementation does not leave
`main`'s Actions in a failing state while the one-time App setup is
still pending. The public repo's maintenance workflow is unaffected — it
only ever publishes its own checksum with its own native token. Neither
skip affects the bridge's actual publication logic
(`private-comment-created.mjs`), which has its own, independent
fail-closed token check on every real event — this only concerns the
periodic drift-check diagnostic.

## Repository configuration checklist

- [ ] Both repos have `.github/acp-issue-bridge.yml` (byte-identical —
      verified by the maintenance workflow's drift check).
- [ ] Both repos have the App secrets set.
- [ ] The App is installed on exactly `Project-Arrakis/acp-discordbot` and
      `Project-Arrakis/sentinel` — not "all repositories."
- [ ] Public repo: Issue Forms exist under `.github/ISSUE_TEMPLATE/`,
      Discussions enabled (already true — verified via `gh api
      repos/Project-Arrakis/acp-discordbot --jq .has_discussions`).
- [ ] Private repo: label taxonomy present (already bootstrapped live —
      `gh label list --repo Project-Arrakis/sentinel`).

## Disabling the bridge

Outbound (private → public) sync: run `/sync-pause` on any individual
correlated issue, or, to disable globally, set `sync.public_issue_create`
etc. to `false` in `acp-issue-bridge.yml` and push — every public-side
script checks its own config flag before doing anything.

To fully disable everything (including inbound mirroring), disable the
workflow files themselves via the repository's Actions settings ("Disable
workflow") rather than deleting them — this preserves the audit trail of
what the bridge *would* have done, and it's a one-click re-enable.

## Re-enabling after a full disable

1. Re-enable the workflow(s) in the repository's Actions settings.
2. If outbound sync was paused on specific issues, each needs its own
   `/sync-resume` (or `/security-clear` + `/sync-resume` if it was
   security-paused) — there is no bulk-resume, by design (section 29:
   "do not replay historical private comments").

## Recovering from `sync:error`

`sync:error` means the bridge found more than one private issue claiming
the same Sync ID (section 44/61) and refused to guess which is canonical.
Recovery is manual:

1. `gh issue list --repo Project-Arrakis/sentinel --label sync:error`
2. For each flagged issue, inspect its `ACP-ISSUE-BRIDGE` metadata block
   and decide which one is the real mirror for that public issue.
3. Close/relabel the duplicate(s) (remove `source:public` and
   `sync:error`, add a note explaining the duplicate), leaving exactly
   one correlated mirror.
4. Remove `sync:error` from the remaining canonical issue and add
   `sync:enabled` (equivalent to running the label delta `/sync-resume`
   would apply, though `/sync-resume` itself only clears
   security-sensitive-driven pauses — this is a manual label edit for the
   correlation-error case specifically).
5. Re-run the relevant workflow (or wait for the next real event) to
   confirm sync resumes cleanly.

## Rotating GitHub App credentials

See `github-app.md`'s "Credential rotation" section.

## Testing synchronization safely

See `testing.md`'s "Safe live smoke test" — never test with a real user's
issue; always use a clearly labeled throwaway issue and clean it up
afterward.

## Rotation / change log

| Date | Action | Notes |
| --- | --- | --- |
| 2026-08-19 | Initial implementation | See the implementation report for full details. GitHub App not yet created — pending operator action per `github-app.md`. |
