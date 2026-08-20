# ACP Issue Bridge — Synchronization Policy

## Sync state model

`sync:enabled` / `sync:paused` / `sync:error` are mutually exclusive —
exactly one is present on a correlated private issue at a time. This
mirrors the public `status:*` one-state model (section 23) and is the
only model consistent with `/sync-resume`'s spec-mandated behavior
("remove `sync:paused`+`sync:error`, then add `sync:enabled`" — section
29). `visibility:security-sensitive` is an **orthogonal** flag layered on
top: it independently fails closed every outbound publication attempt
regardless of the current `sync:*` state (`securityState.mjs`'s
`canPublishOutbound()` checks it first, before even looking at
`sync:*`).

| Command | `sync:enabled` | `sync:paused` | `sync:error` | `visibility:security-sensitive` |
| --- | --- | --- | --- | --- |
| `/security` | remove | **add** | untouched | **add** |
| `/security-clear` (admin) | untouched | untouched | untouched | **remove** |
| `/sync-pause` | remove | **add** | untouched | untouched |
| `/sync-resume` (blocked if security-sensitive present) | **add** | **remove** | **remove** | untouched |

`/sync-pause` deliberately does not touch `sync:error` — recovering from
an error state is `/sync-resume`'s job specifically, so that "I paused
this on purpose" and "the bridge hit an unresolved error" remain
distinguishable states an operator can tell apart at a glance.

## Public issue closure independence (sections 37-39)

Closing the public issue **never** closes the private engineering issue.
Closing the private issue **never** closes the public issue
(`private_close_closes_public: false` in the config, and there is no
code path anywhere that reads a private `issues.closed` event and acts on
it — see the event matrix). The only way the public issue closes is
`/public-resolution`, an explicit, authorized, human-triggered
publication.

## Status label rotation (section 23)

Before applying a new `status:*` label (public or private), every
existing label whose name starts with `status:` is removed first — this
intentionally includes the initial `status:needs-triage` label that issue
forms apply automatically, not just the seven command-driven states, so
"exactly one `status:*` label at a time" holds from issue creation
onward. Implemented in `private-comment-created.mjs`'s `/public-status`
and `/public-resolution` branches (`removeStatusLabels()` on the private
side, an inline sweep on the public side since it requires reading the
public issue's current labels via the API first).

Status labels are **only** ever changed by these two commands — never by
a generic label-sync listener — so a public collaborator adding a
`status:released` label by hand has no effect on the actual release
workflow (see `labelMap.mjs`/`config.mjs`'s rejection of any
`status:*` entry in `label_mapping`).

## Config drift detection

`.github/acp-issue-bridge.yml` must be byte-for-byte identical in both
repositories (enforced by convention + the check below, not by any
runtime cross-repo read of the file — see `architecture.md`
"Configuration parsing"). Detecting drift without granting the App
`contents:read` on either repository works like this:

1. Each repository's own `issue-bridge-maintenance.yml` (`publish` step)
   hashes its **local** config file with SHA-256 and upserts a single,
   well-known bookkeeping issue in **its own** repository — using that
   repository's native, same-repo `GITHUB_TOKEN`, which every Actions
   workflow already has for its own repo without any App involved.
2. The private repository's maintenance workflow (`check` step) then
   reads the **public** repository's bookkeeping issue using the App's
   already-justified `issues:read` scope, and compares the two hashes.
3. A mismatch, or the public checksum issue not existing yet, fails the
   workflow run visibly (`CONFIGURATION`-class error) rather than
   silently assuming the files match.

See `lib/configChecksum.mjs` and `maintenance-config-drift.mjs`.

## What "automatic" means for public → private sync

"Automatic" means no human authorization step is required for the four
public → private flows (issue create, comment mirror, state sync, label
sync) — it does **not** mean unconditional. Every one of them still:

- verifies it is running in the expected repository
  (`assertExpectedRepository`);
- ignores events authored by the bridge's own bot identity (loop
  protection);
- ignores pull-request-shaped `issues`/`issue_comment` events (GitHub
  fires both from the same webhook types);
- respects its own `sync.*` config toggle
  (`public_issue_create`/`public_issue_edit`/`public_comment_create`/
  `public_close`/`public_reopen`/`public_labels`), so any one direction
  can be disabled centrally without touching workflow files;
- sanitizes and mention-suppresses untrusted content before it ever
  reaches the private repository.
