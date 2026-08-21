# ACP Issue Bridge — Metadata Schema

All bridge metadata is `schema_version: 1`, embedded as a flat `key:
value` list inside an HTML comment:

```html
<!-- ACP-ISSUE-BRIDGE
key: value
key: value
-->
```

Built and parsed by `lib/metadata.mjs`. Three shapes exist, distinguished
by which fields are present — there is no separate `kind`-of-block
discriminator field for the first two, since their required-field sets
don't overlap:

## 1. Issue-creation metadata (embedded in a new private mirror's body)

```
schema_version: 1
sync_id: ACP-PUBLIC-52
public_repository: Project-Arrakis/sentinel-support
public_issue: 52
created_from_event: issues.opened:<workflow-run-id>
```

`extractSingleIssueMetadata()` requires ALL of `schema_version`,
`sync_id`, `public_repository`, and `public_issue` to be present to
return anything — a partial/forged block returns `null` (fails closed,
SEC-011).

## 2. Public → private comment-mirror metadata

```
schema_version: 1
direction: public-to-private
sync_id: ACP-PUBLIC-52
source_repository: Project-Arrakis/sentinel-support
source_issue: 52
source_comment: 23891827
```

## 3. Bridge-generated publication metadata (private → public)

```
schema_version: 1
origin: bridge
kind: public | resolution | public-status:<state> | internal-ack
sync_id: ACP-PUBLIC-52
private_repository: Project-Arrakis/sentinel
private_issue: 300
private_comment: <optional>
source_comment: <the private comment id that triggered this — used for idempotency>
```

`source_comment` here is what `alreadyPublished()` in
`private-comment-created.mjs` checks before publishing anything, so a
redelivered webhook or a re-run workflow step cannot double-publish
(section 43; regression test: "SEC-012/section 43: redelivering the same
/public comment twice publishes exactly once").

## Trust boundary — read this before writing any code that parses metadata

**A metadata block found inside PUBLIC-repository content (an issue body
or comment authored by an untrusted public user) is never authoritative
proof of anything.** A public user can freely type
`<!-- ACP-ISSUE-BRIDGE\norigin: bridge\n-->` themselves (SEC-011). Two
different trust mechanisms exist for two different questions, and they
must not be confused:

- **"What does this metadata block claim?"** — `extractMetadataBlocks()`
  / `extractSingleIssueMetadata()`. Pure, untrusted parsing. Safe to call
  on anything, but the result alone proves nothing.
- **"Was this content actually created by the bridge?"** —
  `loopProtection.isBridgeActor()` / `shouldIgnoreAsBridgeGenerated()`.
  Checks the GitHub event's **actor identity** (the App's bot login),
  which an external user cannot forge. This is the only authoritative
  loop-protection signal (section 41 Control 1); the metadata text is at
  best corroborating evidence for logging/debugging (Control 2), never a
  substitute (section 42).

A third, implicit trust anchor is **which repository the content lives
in**: anything inside the *private* repository (issue bodies, comments)
can only have been written by a private collaborator or the bridge
itself, because the repository is access-controlled — a public user has
no way to write there at all. `private-comment-created.mjs` relies on
this when it treats the private issue's own body metadata as trustworthy
enough to resolve the Sync ID (there is no equivalent "public user forged
this" risk for content that only privileged actors could have written in
the first place).

## Correlation (section 11) — two independent mechanisms, always both present

1. **Issue-body metadata** (shape 1 above) — the primary mechanism.
2. **A bridge-generated synchronization comment** carrying the same Sync
   ID (shape 2, specifically the "Synchronization Established" comment
   `public-issue-opened.mjs` posts immediately after creating a mirror).

`correlation.resolvePrivateMirror()` checks **both**: a candidate issue's
body first, then falls back to scanning its comments — so correlation
survives even if the body's metadata block is later edited away by
mistake. Never correlates by issue title, reporter, or timestamp alone
(section 11's explicit prohibition).
