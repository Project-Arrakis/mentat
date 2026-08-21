# ACP Issue Bridge — Architecture

## Core security invariant

```
PUBLIC  -> PRIVATE = automatic
PRIVATE -> PUBLIC  = explicit authorization required, fail-closed
```

Everything below exists to enforce that invariant, not merely to
synchronize two issue trackers.

## Selected design: GitHub Actions + a narrowly-scoped GitHub App

No always-on external service. Every synchronization step runs as a
GitHub Actions job, triggered by GitHub's own native `issues`/
`issue_comment` webhook events on each repository, and uses a
short-lived, just-in-time GitHub App installation token for the one
cross-repository call it needs to make. This satisfies section 4's
requirement to justify anything beyond GitHub Actions: nothing here needs
long-running state, a persistent listener, or infrastructure beyond what
GitHub already runs for every repository.

```
Project-Arrakis/sentinel-support (PUBLIC)          Project-Arrakis/sentinel (PRIVATE)
┌────────────────────────────┐            ┌──────────────────────────────────┐
│ issues: opened              │──Actions──▶│ (creates private mirror issue)   │
│ issue_comment: created       │──Actions──▶│ (mirrors comment)                │
│ issues: edited/closed/reopened│─Actions──▶│ (sync comment, status:public-   │
│ issues: labeled/unlabeled    │──Actions──▶│  closed, allowlisted labels)     │
└────────────────────────────┘            │                                   │
        ▲                                  │ issue_comment: created            │
        │ (App token, cross-repo)          │  -> command parser -> auth ->     │
        └──────────────────────────────────┤     security gate -> secret scan  │
                                            │     -> publish (only /public,     │
                                            │        /public-status,            │
                                            │        /public-resolution)        │
                                            └──────────────────────────────────┘
```

## Why the GitHub App exists (and why it isn't a webhook receiver)

The App is used **only** as a scoped credential source. Each workflow
mints a short-lived installation token via `actions/create-github-app-
token` (pinned to a commit SHA) just before it needs to call the *other*
repository's API — the default `GITHUB_TOKEN` every Actions workflow
already gets is scoped only to the repository the workflow runs in and
cannot reach the other repo at all. The App's own webhook delivery is
left inactive; GitHub Actions' native triggers already deliver every
event this bridge needs.

## Shared library (`​.github/scripts/issue-bridge/lib/`)

Identical, byte-for-byte, in both repositories (verified by
`issue-bridge-maintenance.yml`'s config-drift check plus manual `diff -r`
at implementation time — see "Configuration parsing" below for why the
config file specifically has an automated drift check and the rest of
`lib/` does not). Pure, side-effect-free modules, each independently unit
tested:

| Module | Responsibility |
| --- | --- |
| `miniYaml.mjs` / `config.mjs` | Deterministic config parsing/validation |
| `syncId.mjs` | Canonical `ACP-PUBLIC-<n>` correlation ID |
| `metadata.mjs` | Build/parse `<!-- ACP-ISSUE-BRIDGE -->` blocks |
| `loopProtection.mjs` | Bridge-actor identity check (loop prevention) |
| `sanitize.mjs` | Strip control/bidi chars, cap size |
| `mentions.mjs` / `markdownSegments.mjs` | Non-notifying mention rewriting, code-block-aware |
| `labelMap.mjs` | Allowlisted public↔private label translation |
| `commandParser.mjs` | Anchored `/command` recognition |
| `auth.mjs` | Permission matrix (write/maintain/admin) |
| `secretScan.mjs` | Outbound sensitive-content detection |
| `securityState.mjs` | sync/security label state machine |
| `statusTemplates.mjs` | Fixed public-facing message templates |
| `correlation.mjs` | Single/none/ambiguous private-mirror resolution |
| `idempotency.mjs` / `queries.mjs` | Dedup keys, search query construction |
| `ghApi.mjs` | Dependency-free GitHub REST client, retry/backoff |
| `errors.mjs` | Error classification (section 63) |
| `audit.mjs` | Structured audit events (section 64/65) |
| `labelDefinitions.mjs` / `configChecksum.mjs` | Label taxonomy data, config drift detection |

### Why `lib/` is duplicated verbatim rather than trimmed per repository

The public repository's workflows only ever need a subset of these
modules (they never parse commands or scan secrets, since they never
publish anything). Two designs were considered:

1. **Trim `lib/` in the public repo to only what its workflows call.**
   Smaller footprint, but now there are two *different* subsets to keep
   mentally reconciled, and a future contributor adding a public-side
   feature has to first work out whether the module they need has been
   copied over yet.
2. **Copy `lib/` verbatim, unused modules included** (chosen). The public
   repo's automation surface is trivially auditable as "identical library
   code, a strict subset of orchestration scripts" — `diff -r` between
   the two `lib/` directories is the whole review. The unused modules
   (`commandParser.mjs`, `auth.mjs`, `secretScan.mjs`,
   `securityState.mjs`, `statusTemplates.mjs`) are pure functions with no
   network access and no secrets; shipping them where they're never
   invoked carries no security cost.

Either way, no workflow ever fetches code from the *other* repository at
run time — each repository's Actions runner only ever executes files
checked out from its own repository. A compromised public-repo workflow
cannot pull and execute code from the private repo, and vice versa.

### Configuration parsing

`.github/acp-issue-bridge.yml` is parsed by a small, hand-written,
YAML-*subset* parser (`miniYaml.mjs`) instead of a third-party YAML
dependency. It supports only nested block mappings of scalars — no flow
style, no sequences, no anchors — and **rejects** (rather than
guesses at) anything outside that subset. This mirrors the bridge's
fail-closed posture at the configuration layer, not just the publication
layer, and avoids adding a dependency for a handful of nested maps
(section 84, "minimal dependencies"). See `config.mjs` for the additional
schema validation layer (required fields, permission-level enums, the
hard-coded forbidden-label floor that config alone cannot shrink).

Because the two repositories cannot share a filesystem, they cannot
literally read one file — each carries its own copy, and
`issue-bridge-maintenance.yml`'s `check` step verifies the two copies are
byte-identical using a SHA-256 checksum exchanged through a well-known
bookkeeping issue in each repo (see
`docs/issue-bridge/synchronization-policy.md` "Config drift detection"),
rather than granting the App `contents:read` on both repositories just to
diff one file.

## Workflow consolidation decision

The spec's section 55/60 workflow list suggests a separate
`issue-bridge-private-security.yml`. This implementation deliberately
consolidates `/security` handling into the same
`issue-bridge-private-comments.yml` workflow as every other command,
because:

- `/security` is one branch of the same command-parsing state machine
  (`private-comment-created.mjs`) as `/public`, `/public-status`, etc. —
  splitting it out would mean a second workflow independently re-parsing
  the same comment just to decide "is this the security case?"
- Two workflows reacting to the same `issue_comment.created` event
  introduces an ordering/race question (which one runs first? does the
  other need to know the first one already acted?) with no actual
  separation-of-concerns benefit, since the command parser already keeps
  each command's logic in its own function.

This is exactly the flexibility spec section 55 grants: "If repository
conventions favor fewer workflows, consolidation is acceptable provided
responsibilities remain clearly separated" — and they are, at the
function level within `private-comment-created.mjs`.

## Orchestration scripts

Each workflow step runs a single, focused Node script
(`.github/scripts/issue-bridge/*.mjs`) that reads the GitHub Actions
event payload from disk, constructs a `GitHubClient` whose token is
supplied via environment variable (populated by the App-token-minting
step), and calls into `lib/`. Every orchestration script exports its
core handler function separately from its `main()` bootstrap specifically
so it can be exercised in unit/integration tests with a fake client —
see `docs/issue-bridge/testing.md`.
