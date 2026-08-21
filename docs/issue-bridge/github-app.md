# ACP Issue Bridge — GitHub App

## Status: requires one manual, one-time operator action

This is the **one part of the ACP Issue Bridge that could not be
completed by an automated implementation session**, and it is documented
here in full per the implementation spec's requirement to document any
blocking platform limitation with evidence, security impact, and the
safest compliant alternative.

### The limitation

GitHub Apps cannot be created headlessly. There is no `gh api` / REST /
GraphQL call that creates a new GitHub App — app registration is only
available through:

1. The GitHub web UI at `https://github.com/settings/apps/new`
   (interactive form), or
2. The [app manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest),
   which still requires an interactive browser redirect through
   `github.com` while authenticated as the account that will own the App.

Both require a human with an authenticated browser session for the
`yacketrj` account. An automated coding session has no browser and no way
to complete an interactive OAuth-style redirect, so **this step must be
performed by the operator**, once, before the bridge can mint installation
tokens.

Everything else — the App's exact permission set, the workflows that
consume its token, the secrets it needs, and the installation scope — is
fully implemented and ready the moment the App exists. Until then, the
cross-repository workflows (`issue-bridge-public-*.yml` in the public
repo, `issue-bridge-private-comments.yml` and the `check` step of
`issue-bridge-maintenance.yml` in this repo) will fail at the "Mint ACP
Issue Bridge installation token" step with a clear, visible error in the
Actions log — they do **not** silently no-op, and they do **not** fall
back to a broader-scoped credential. That is the intended fail-closed
behavior (spec section 2): a missing credential blocks synchronization
rather than working around it with something more privileged.

## Option A — manual creation (recommended, ~2 minutes)

**Historical — the App already exists.** These are the steps that were
followed once, when the App didn't exist yet, kept here as a reference in
case the App ever needs recreating from scratch. For the current
org-migration action needed today, skip to "Org migration" below.

1. Go to <https://github.com/settings/apps/new> while logged in as
   `yacketrj`.
2. Fill in:
   - **GitHub App name:** `ACP Issue Bridge`
   - **Homepage URL:** `https://github.com/yacketrj/arrakis-control-panel`
     (the repo's URL at the time this was originally done; would be
     `https://github.com/Project-Arrakis/sentinel` if redone today)
   - **Webhook:** uncheck **Active** — this App is not a webhook receiver;
     GitHub Actions' own `issues`/`issue_comment` triggers deliver events
     natively to each repo's workflows. The App exists solely to mint
     scoped installation tokens for cross-repository API calls.
   - **Repository permissions:**
     - `Metadata`: **Read-only**
     - `Issues`: **Read and write**
     - Leave every other permission at **No access** (see
       `docs/issue-bridge/security-model.md` for why — the spec is
       explicit that `Contents: Write`, `Administration: Write`,
       `Actions: Write`, `Secrets: Read`, `Deployments: Write`, and
       `Packages: Write` must not be requested without a specific,
       written, per-permission justification, and none exists here).
     - **Discussions**: leave at **No access** until/unless Discussions
       automation (spec section 54) is actually implemented — do not
       pre-grant it "just in case."
   - **Where can this GitHub App be installed?** "Only on this account."
3. Click **Create GitHub App**.
4. On the new App's settings page:
   - Note the **App ID** — this becomes the `ACP_ISSUE_BRIDGE_APP_ID`
     secret.
   - Under **Private keys**, click **Generate a private key**. This
     downloads a `.pem` file once — this becomes the
     `ACP_ISSUE_BRIDGE_PRIVATE_KEY` secret (paste the full PEM contents,
     including the `-----BEGIN/END-----` lines).
5. Click **Install App** (left sidebar) → install on the `yacketrj`
   account → **Only select repositories** → choose exactly:
   - `yacketrj/acp-discordbot`
   - `yacketrj/arrakis-control-panel`

   Do not select "All repositories."

## Option B — manifest flow (reproducible, scripted form submission)

A ready-to-use manifest is checked in at
`docs/issue-bridge/github-app-manifest.json` with the exact permission
set above pre-filled. Per GitHub's documented flow, submit it as a
same-origin POST to `https://github.com/settings/apps/new` (organization
accounts use `https://github.com/organizations/<org>/settings/apps/new`
instead) in a `manifest` form field, while authenticated as `yacketrj` —
GitHub's own manifest-flow docs describe this as a minimal HTML form with
one hidden input; save one locally and open it in an authenticated
browser tab. This still requires the same interactive browser session as
Option A, and does not remove the need for a human — it exists only so
the exact permission set is reproducible from a checked-in file rather
than retyped by hand.

## Org migration (yacketrj → Project-Arrakis): required manual action

**Status as of 2026-08-21, repos done, App still pending:**
- `arrakis-control-panel` has been transferred to `Project-Arrakis` **and
  renamed to `sentinel`** (not just moved — the repo slug itself changed).
- `acp-discordbot` has also been transferred to `Project-Arrakis` **and
  renamed to `sentinel-support`**.
- `.github/acp-issue-bridge.yml` in both repos now points at
  `Project-Arrakis/sentinel` / `Project-Arrakis/sentinel-support` (updated
  on a branch, deliberately not merged yet — see
  `Project-Arrakis/sentinel#228`). Merging before the App step below is
  done will break the live bridge, since the App has no installation to
  mint tokens against yet.
- The "ACP Issue Bridge" GitHub App has **not** been transferred/installed
  on `Project-Arrakis` yet (confirmed via `gh api
  orgs/Project-Arrakis/installations` returning zero installations as of
  this writing — re-check before assuming this is still true).

This hits the exact same platform limitation as initial App creation above
— no `gh api`/REST call can move a GitHub App's ownership or change who can
install it. A human with an authenticated `yacketrj` browser session must:

1. Go to the "ACP Issue Bridge" App's settings page → **Advanced** tab →
   **Transfer ownership** → transfer to the `Project-Arrakis` organization.
   (Preferred over loosening "Where can this GitHub App be installed?" to
   "Any account": transfer keeps the App tightly scoped to exactly the org
   that uses it, rather than making it installable by any GitHub account,
   which would be a real, avoidable widening of exposure for a private
   automation credential.)
2. On the App's **Install App** page (now under `Project-Arrakis`), install
   on the `Project-Arrakis` organization → **Only select repositories** →
   `sentinel` and `sentinel-support`.
3. Confirm whether the `ACP_ISSUE_BRIDGE_APP_ID` / `ACP_ISSUE_BRIDGE_PRIVATE_KEY`
   repository secrets survived both transfers (GitHub's docs don't
   explicitly guarantee repo secrets carry over on an org transfer) —
   re-add on either repo if not. Values are unchanged (same App, same
   keypair).
4. Merge `#228`'s config-fix branch on both repos.
5. Run the verification checklist below against the new org location, then
   the live smoke test in `docs/issue-bridge/testing.md`.

## Required secrets (both repositories)

Set these as encrypted repository secrets on **both**
`Project-Arrakis/sentinel-support` and `Project-Arrakis/sentinel` (Settings →
Secrets and variables → Actions → New repository secret):

| Secret | Value |
| --- | --- |
| `ACP_ISSUE_BRIDGE_APP_ID` | The App ID from the App's settings page |
| `ACP_ISSUE_BRIDGE_PRIVATE_KEY` | The full contents of the downloaded `.pem` private key |

Never commit these values, never echo them in a workflow `run:` step, and
never add a `- run: echo ...` step that would print them — see
`docs/issue-bridge/security-model.md` "Secret handling."

## Verification checklist (run once, after setup)

- [ ] `gh api /repos/Project-Arrakis/sentinel/installation` (as an
      org/repo admin) shows the ACP Issue Bridge installation with
      exactly `metadata: read` and `issues: write`.
- [ ] The installation's repository list is exactly the two repositories
      above — not "all repositories."
- [ ] Trigger `issue-bridge-maintenance.yml` via `workflow_dispatch` in
      both repos and confirm the "Mint ACP Issue Bridge installation
      token" step succeeds.
- [ ] Open a throwaway public issue and confirm
      `issue-bridge-public-created.yml` creates a correlated private
      mirror (see `docs/issue-bridge/testing.md` "Safe live smoke test"
      for a scripted, cleanup-included version of this check).
- [ ] Confirm `GET /repos/Project-Arrakis/sentinel/collaborators/<a
      test maintainer's username>/permission` succeeds using the App's
      minted token. **Known residual uncertainty:** GitHub's
      documentation for this endpoint does not explicitly enumerate the
      App permission it requires beyond general collaborator-read access;
      this implementation assumes `Metadata: Read` + `Issues: Read` is
      sufficient (both already granted). If this call 403s in practice,
      the documented remediation is to grant the App **Members**
      (organization) read access — the smallest addition that plausibly
      closes the gap — and re-verify, rather than widening to a broader
      permission. Record the outcome here once verified.

## Credential rotation

1. On the App's settings page, generate a new private key (this does not
   invalidate the old one immediately — GitHub allows both to work for a
   short overlap window).
2. Update the `ACP_ISSUE_BRIDGE_PRIVATE_KEY` secret in both repositories.
3. Trigger both `issue-bridge-maintenance.yml` workflows via
   `workflow_dispatch` and confirm the token-mint step still succeeds.
4. Delete the old private key from the App's settings page.
5. Record the rotation date in `docs/issue-bridge/administration.md`'s
   rotation log.

No downtime is required — installation tokens are minted just-in-time per
workflow run (section 6), so there is no long-lived credential in memory
anywhere to restart.
