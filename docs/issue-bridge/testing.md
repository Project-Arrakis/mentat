# ACP Issue Bridge — Testing

## Running the tests

```bash
# from either repository's root
npm test
# or, scoped to just the bridge:
node --test .github/scripts/issue-bridge
```

Both repositories' `npm test` already includes the bridge's tests
automatically — Node's built-in test runner (`node --test`, no path
argument) recursively discovers every `*.test.js` file from the current
directory, including under `.github/`, so no changes to either repo's
existing `package.json`/`scripts/run-tests.js` were needed (verified
directly before relying on it, per this account's "never assume, always
verify" discipline).

## Current counts (as of this implementation)

| Category | Count | Notes |
| --- | --- | --- |
| Unit tests (`lib/*.test.js`) | 188 | Pure functions, no network, no fakes needed |
| Integration/orchestration tests (`*.test.js` at the script level) | 52 | Fake `GitHubClient` implementing only the methods each script calls; exercises full handler logic including multi-step flows (label rotation, idempotency, correlation) |
| **Total** | **240** | All passing at implementation time — see the completion report for the exact command/output evidence |
| Mandatory security tests (SEC-001 through SEC-016, spec section 73) | all 16 present, 34 individual assertions across them | See table below |

## SEC-001 .. SEC-016 mapping

| ID | Scenario | Test location |
| --- | --- | --- |
| SEC-001 | Default private comment → no public action | `private-comment-created.test.js` |
| SEC-002 | Explicit `/internal` → no public action | `private-comment-created.test.js`, `commandParser.test.js` |
| SEC-003 | Authorized `/public` → published | `private-comment-created.test.js`, `commandParser.test.js` |
| SEC-004 | Secret in `/public` → blocked, never echoed | `private-comment-created.test.js`, `secretScan.test.js` |
| SEC-005 | `sync:paused` → `/public` blocked | `private-comment-created.test.js`, `securityState.test.js` |
| SEC-006 | `visibility:security-sensitive` → `/public-resolution` blocked | `private-comment-created.test.js`, `securityState.test.js` |
| SEC-007 | `write`-only actor → `/public` blocked | `private-comment-created.test.js`, `auth.test.js` |
| SEC-008 | `/security` from `write` actor → security mode enabled, sync paused, nothing public | `private-comment-created.test.js`, `securityState.test.js` |
| SEC-009 | `/security-clear` from `maintain` (not admin) → blocked | `private-comment-created.test.js`, `auth.test.js` |
| SEC-010 | `/security-clear` from `admin` → security-sensitive removed, sync stays paused | `private-comment-created.test.js`, `securityState.test.js` |
| SEC-011 | Forged bridge metadata → treated as untrusted content | `metadata.test.js`, `loopProtection.test.js`, `private-comment-created.test.js` |
| SEC-012 | Duplicate delivery → one mirrored comment / one publication | `public-comment-created.test.js`, `public-issue-opened.test.js`, `private-comment-created.test.js` |
| SEC-013 | Bridge-created comment → event ignored as sync source | `loopProtection.test.js`, `public-issue-opened.test.js`, `public-comment-created.test.js`, `private-comment-created.test.js` |
| SEC-014 | Duplicate private mirror → `sync:error`, no guessing | `correlation.test.js`, `public-issue-opened.test.js`, `public-comment-created.test.js` |
| SEC-015 | Mention injection → suppressed, no unintended notification | `mentions.test.js`, `public-comment-created.test.js` |
| SEC-016 | Private attachment URL in `/public` → blocked | `secretScan.test.js`, `private-comment-created.test.js` |

## Reliability tests (section 74)

`ghApi.test.js` exercises: HTTP 429 (honors `Retry-After`), 502/503
(bounded retry then classified `TRANSIENT` failure), 403 permanent
(`AUTHORIZATION`, no retry) vs. 403 secondary-rate-limit
(`RATE_LIMIT`, retried), network-level failures, and confirms the raw
token is never present in any thrown error. `correlation.test.js` and
`public-issue-opened.test.js` cover missing/duplicate destination issues.
`config.test.js`/`configChecksum.test.js` cover malformed config.
Duplicate-event idempotency is covered per the SEC-012 table above.

## What is intentionally **not** covered by automated tests

- **A real, live GitHub Actions run end-to-end** — the test suite uses a
  fake `GitHubClient`, not a live webhook delivery through Actions. See
  "Safe live smoke test" below for how this was validated against the
  real repositories during implementation, and how to re-validate after
  any future change.
- **The GitHub App itself** — cannot be tested until it exists (see
  `github-app.md`).

## Safe live smoke test

This exact procedure was used during implementation to validate the
bridge against the real repositories using a personal access token in
place of the (not-yet-created) GitHub App token — the underlying
`ghApi.mjs`/orchestration logic is identical either way, since both are
just a Bearer token to `GitHubClient`.

1. Create a clearly labeled throwaway issue in the public repo:
   ```
   gh issue create --repo Project-Arrakis/sentinel-support \
     --title "[BRIDGE TEST] <short description>" \
     --body "Throwaway issue used to validate the ACP Issue Bridge. Safe to ignore/delete."
   ```
2. Run the relevant orchestration script directly with a real token in
   place of the Actions-minted one:
   ```
   GITHUB_REPOSITORY=Project-Arrakis/sentinel-support \
   ACP_BRIDGE_TOKEN=$(gh auth token) \
   ACP_BRIDGE_BOT_LOGIN=<n/a until the App exists> \
   ACP_BRIDGE_EVENT_JSON=<captured event payload> \
     node .github/scripts/issue-bridge/public-issue-opened.mjs
   ```
3. Verify a correlated private mirror was created with the expected
   title, labels, and metadata:
   ```
   gh issue view <private-issue-number> --repo Project-Arrakis/sentinel --json title,labels,body
   ```
4. Clean up both issues afterward — close (and, since the operator
   account has admin rights, delete via the GraphQL `deleteIssue`
   mutation if a completely clean history is preferred) both the public
   test issue and its private mirror. Never leave throwaway test issues
   open indefinitely; label them unambiguously as test artifacts if they
   must remain for any reason.

See the completion report for the actual command transcript and output
from running this procedure against the real repositories at
implementation time.
