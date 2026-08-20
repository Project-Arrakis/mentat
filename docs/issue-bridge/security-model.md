# ACP Issue Bridge — Security Model

## Defense in depth (section 68) — each control and where it lives

| # | Control | Implementation |
| --- | --- | --- |
| 1 | Fail-closed outbound publishing | `securityState.canPublishOutbound()` — every one of `/public`, `/public-status`, `/public-resolution` calls this before doing anything; default is blocked |
| 2 | Least-privilege GitHub App | `Metadata: Read` + `Issues: Read/Write` only — see `github-app.md` |
| 3 | Explicit publication commands | `commandParser.mjs` — no command, no action (SEC-001/002) |
| 4 | Actor authorization | `auth.mjs`'s permission matrix against the actor's precise `role_name` |
| 5 | Security-sensitive label | `visibility:security-sensitive` gates ALL outbound publication independent of `sync:*` state |
| 6 | Sync pause | `sync:paused` — independently gates outbound publication |
| 7 | Secret scanning | `secretScan.scanForSensitiveContent()` — 11 mandatory pattern categories + 4 configurable ones, run before every `/public`/`/public-resolution` publish |
| 8 | Metadata validation | `metadata.extractSingleIssueMetadata()` requires all 4 fields or returns null; ambiguous (>1 match) correlation fails closed |
| 9 | Loop protection | `loopProtection.isBridgeActor()` — actor-identity based, not text-based |
| 10 | Idempotency | Search-before-write on every mutation path (issue create, comment mirror, outbound publish) |
| 11 | Mention suppression | `mentions.suppressMentions()` — zero-width-space insertion, code-block-aware, applied to both mirrored public content and outbound `/public`/`/public-resolution` bodies |
| 12 | Attachment/URL policy | `secretScan.scanForSensitiveContent()`'s `privateRepoSlugs` option flags both bare private-repo URLs and `/files/`,`/blob/`,`/raw/`,`/actions/`,`/runs/` attachment-shaped paths (SEC-016) |
| 13 | Public input sanitization | `sanitize.sanitizeInboundContent()` — strips C0/C1 control chars and Unicode bidi overrides, caps size |
| 14 | Structured audit logging | `audit.emitAuditEvent()` — strict field allowlist, no raw body/secret passthrough field exists at all |

## Why the scanners are biased toward false positives

The bridge's own final principle (section 89): *"a missed public update is
acceptable; accidental private disclosure is a security incident."* Every
pattern in `secretScan.mjs` is written to over-match rather than
under-match — e.g. the generic secret-assignment pattern intentionally
matches a keyword (`token`, `secret`, …) **anywhere inside** a longer
identifier like `DUNE_DISCORD_ADAPTER_TOKEN`, not just as a whole word,
because real secrets are usually held in exactly that env-var-name shape,
and a missed real secret is the unacceptable failure mode, not an
occasional over-cautious block that a maintainer has to reword and
resubmit.

## Secret categories detected (section 45)

**Mandatory:** GitHub PATs (`ghp_`/`gho_`/`ghu_`/`ghs_`/`ghr_`), GitHub
fine-grained PATs (`github_pat_`), JWTs, PEM private keys, AWS access key
IDs, AWS secret key assignments, Bearer tokens, `Authorization:` headers,
cookie/session token assignments, credentials embedded in a URL
(`user:pass@host`), and the generic secret-assignment pattern above.

**Configurable** (on by default, can be disabled per call):
RFC1918 addresses, internal DNS-style hostnames (`.internal`/`.local`/
`.corp`/`.lan`), local filesystem paths (`/home/`, `/root/`,
`C:\Users\`), and Node.js-style internal stack traces.

**Never echoed:** `scanForSensitiveContent()` returns only a `categories`
array of names — never the matched substring. The internal blocked-
publication message (`statusTemplates.renderBlockedPublicationMessage()`)
states the category and nothing else. Regression test:
`private-comment-created.test.js` "SEC-004: a secret in /public blocks
publication and never appears in any output" — asserts the literal secret
string is absent from every created comment body **and** every captured
audit-sink line, not just the public-facing comment.

## Mention suppression detail (section 34/35)

`@name` and `@org/team` are rewritten to `@\u200Bname` (zero-width space
immediately after `@`) — invisible to a reader, but breaks GitHub's
mention-to-notification linking, which requires the `@` and the name to
be contiguous. Applied to:

- public comments mirrored into the private repo (a public commenter
  should never be able to ping a private collaborator);
- `/public` and `/public-resolution` bodies before publication (a
  maintainer's private-only shorthand `@some-internal-team` should never
  mass-notify externally, and per section 35, this implementation
  currently suppresses **all** mentions uniformly rather than
  distinguishing "policy-permitted explicit mentions" — see Known
  Limitations in the final report).

Never applied inside fenced code blocks or inline code spans
(`markdownSegments.mjs`), because GitHub doesn't linkify/notify mentions
found there anyway, and inserting an invisible character into copyable
example commands would silently corrupt them for anyone who copy-pastes.

## Metadata forgery (section 42) — see `metadata-schema.md`'s "Trust
boundary" section for the full explanation; summarized: text-based
metadata is never trusted alone, only actor identity is.

## Attachment/URL policy (section 47)

`PUBLIC attachment -> PRIVATE reference` is allowed by construction — the
bridge only ever *links* to the original public content
(`**Public Issue:**`/`**Public Comment:**` URLs in mirrored bodies), it
never re-uploads or re-hosts anything. `PRIVATE attachment -> PUBLIC` is
blocked by the same secret scanner that blocks credentials
(`private-repository-url` / `private-repository-attachment` categories),
so a `/public` comment that happens to reference a private GitHub
attachment URL is blocked exactly like a leaked token would be, with the
same "no content published" outcome.

## Configuration security

`config.mjs`'s `validateConfig()` fails closed on: unsupported schema
version, missing required fields, malformed repository slugs, command
tokens not starting with `/`, invalid permission levels, arbitrary
`status_labels` states, `label_mapping` entries that reference a
forbidden control label, `label_mapping` entries for `status:*`, and any
attempt to shrink the forbidden-label denylist below its hard-coded
floor. A config that fails any of these checks throws
`ConfigValidationError` (classified `CONFIGURATION`) and the workflow
step fails visibly rather than running with a guessed default.

## What this implementation does **not** claim

See the final implementation report's "Known Limitations" and "STRIDE
residual risks" sections — in particular, the GitHub App's exact
permission requirement for the collaborator-permission-check endpoint is
flagged as unverified against a real App installation (only verified
against a personal token with admin rights during the live smoke test),
and mention suppression is currently all-or-nothing rather than
policy-driven per section 35's "allow explicit user mentions only when
policy permits them."
