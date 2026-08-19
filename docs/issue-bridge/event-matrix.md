# ACP Issue Bridge — Event Matrix (as implemented)

| Source | Event | Destination | Implemented behavior | Script |
| --- | --- | --- | --- | --- |
| Public | `issues.opened` | Private | Sanitize, dedupe via Sync ID search, create mirror + `source:public`/`visibility:internal`/`sync:enabled` + allowlisted labels, embed metadata in body **and** a sync comment (2 correlation mechanisms) | `public-issue-opened.mjs` |
| Public | `issues.edited` | Private | Append `### Public Issue Updated` sync comment with sanitized latest body; **never rewrites the mirror body** | `public-issue-state.mjs` |
| Public | `issues.labeled` / `issues.unlabeled` | Private | Translate only allowlisted labels (`label_mapping`); everything else silently ignored | `public-label-sync.mjs` |
| Public | `issue_comment.created` | Private | Mirror as `### Public Comment` blockquote with metadata; mention-suppressed; idempotent on `source_comment` | `public-comment-created.mjs` |
| Public | `issues.closed` | Private | Apply `status:public-closed`; append sync comment; **engineering issue stays open** | `public-issue-state.mjs` |
| Public | `issues.reopened` | Private | Remove `status:public-closed`; append sync comment | `public-issue-state.mjs` |
| Private | Normal comment (no command) | Public | **No action** — this is the default-safe path (SEC-001) | `private-comment-created.mjs` |
| Private | `/internal` | Public | No action (never even checks authorization — see "Why `/internal` needs no auth check" below) | `private-comment-created.mjs` |
| Private | `/public` | Public | Gate check → secret scan → mention suppression → publish `### ACP Engineering Update`; idempotent per source comment | `private-comment-created.mjs` |
| Private | `/public-status <state>` | Public | Validate state → rotate `status:*` labels (public + private) → publish fixed template (never includes comment body) | `private-comment-created.mjs` |
| Private | `/public-resolution` | Public | Gate + scan → publish `### ACP Resolution` → set `status:released` → **close** the public issue | `private-comment-created.mjs` |
| Private | `/security` | Public | No publication. Adds `visibility:security-sensitive` + `sync:paused`, removes `sync:enabled` | `private-comment-created.mjs` |
| Private | `/security-clear` | Public | Admin-only. Removes `visibility:security-sensitive` **only** — sync stays paused | `private-comment-created.mjs` |
| Private | `/sync-pause` | Public | Adds `sync:paused`, removes `sync:enabled` | `private-comment-created.mjs` |
| Private | `/sync-resume` | Public | Blocked while `visibility:security-sensitive` present; otherwise removes `sync:paused`+`sync:error`, adds `sync:enabled` | `private-comment-created.mjs` |
| Private | Unrecognized `/whatever` | Public | No action; distinguished internally from "no command" for future UX, but **never** publishes | `private-comment-created.mjs` |
| Private | Issue closed/reopened | Public | No action (not implemented as an outbound trigger — spec section 40 confirms "No action") | — |
| Private | Label changed | Public | No action, except the explicit status-label rotation that is *part of* the `/public-status` and `/public-resolution` command flows themselves, not a generic label-change listener | `private-comment-created.mjs` |
| Bridge | Bridge-generated comment/issue (either repo) | — | Ignored via actor-identity check (`loopProtection.mjs`), **not** via the embedded metadata text (section 42) | all scripts |

## Why `/internal` needs no authorization check

`/internal` performs no privileged action under any circumstance — it is
a pure no-op by design (section 18). `auth.mjs`'s
`checkCommandAuthorization()` special-cases `internal`, `unrecognized`,
and `null` (no command) to `requiresAuth: false` rather than mapping them
to a permission level, because gating a command that can never do
anything adds no security value and would only create a confusing "why
was my harmless `/internal` comment blocked?" support case.

## Idempotency guarantees (section 43) — implemented mechanism per row

- **Public issue mirroring:** search-before-create using the Sync ID
  (`correlation.mjs`); `none` → create, `single` → reuse (no-op,
  `PUBLIC_ISSUE_DUPLICATE_IGNORED`), `ambiguous` → `sync:error` on every
  match, no guessing (SEC-014).
- **Public comment mirroring:** search the private issue's existing
  comments for one already carrying `source_comment: <this id>` before
  mirroring.
- **Outbound publication (`/public`, `/public-status`, `/public-
  resolution`):** search the *public* issue's existing comments for a
  bridge comment whose metadata already carries the triggering private
  `source_comment` id + matching `kind` before publishing again — this
  was a gap in the original design (per-command handlers did not
  originally check this) found and closed during implementation via a
  redelivery test (`private-comment-created.test.js`, "SEC-012/section
  43: redelivering the same /public comment twice publishes exactly
  once").

## Deviation from the spec's literal workflow-file list

Section 55 lists `issue-bridge-private-security.yml` as a separate
private-repo workflow. This implementation does not create that file —
see `architecture.md` "Workflow consolidation decision" for the
rationale. `/security` is fully implemented as a branch inside
`issue-bridge-private-comments.yml` / `private-comment-created.mjs`,
with its own dedicated test coverage (SEC-008).
