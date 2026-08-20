# ACP Issue Bridge — Private Comment Commands

Commands are recognized **only** when they occur at the very beginning of
a private issue comment, after optional leading whitespace
(`commandParser.mjs`). A command wrapped in a quoted block (`> /public`)
or a fenced code block (`` ```\n/public\n``` ``) is never recognized —
not through special-case detection, but because the parser only ever
checks whether the comment's first line, after trimming, is *exactly*
equal to the command token; a line starting with `>` or a backtick fence
can never equal `/public`.

## Command reference

| Command | Syntax | Body used? | Effect |
| --- | --- | --- | --- |
| `/internal` | `/internal` | No | No public action, ever. |
| `/public` | `/public` + free text | Yes (scanned + mention-suppressed) | Publishes `### ACP Engineering Update` with your text. |
| `/public-status` | `/public-status <state>` | **No** — only the state argument is used | Publishes a fixed template for the given state; any text after the state on later lines is ignored for publication. |
| `/public-resolution` | `/public-resolution` + free text | Yes (scanned + mention-suppressed) | Publishes `### ACP Resolution` with your text, sets `status:released`, **closes** the public issue. |
| `/security` | `/security` + free text (internal only) | No (never published) | Immediately locks down outbound sync — see below. |
| `/security-clear` | `/security-clear` | No | Admin-only. Removes the security-sensitive flag; sync stays paused. |
| `/sync-pause` | `/sync-pause` | No | Stops outbound sync; inbound sync continues. |
| `/sync-resume` | `/sync-resume` | No | Resumes outbound sync — blocked while security-sensitive. |

## `/public-status` allowed states

Exactly these seven — anything else is rejected (`argumentValid: false`,
no label/comment change, an internal-only note is posted explaining valid
states):

`confirmed`, `planned`, `in-progress`, `blocked`, `testing`,
`ready-for-release`, `released`

## Why `/public-status`'s body is never published

If a maintainer writes:

```
/public-status blocked
Blocked on the vendor's rate-limited API — can't say that publicly.
```

only the word `Blocked` and the fixed "Work is currently blocked by an
outstanding dependency or prerequisite." template are ever published.
`statusTemplates.renderStatusMessage(state)` takes **only** a validated
state string — it has no parameter for a body, so there is no code path
by which the explanatory text after the command could leak into the
public template even by mistake. This is the concrete implementation of
section 22's "do not expose the internal blocker."

## Documented interpretation: `/public-resolution`'s worked example

The spec's section 24 example shows an input body of `Fixed in v1.5.1.`
producing an output of `Fixed in `v1.5.1`.` (backtick-wrapped). This
implementation treats that as illustrative formatting in the prompt, not
a literal requirement: automatically detecting "version-shaped"
substrings in arbitrary maintainer-authored text and backtick-wrapping
them is a fragible heuristic that could mangle unrelated text (e.g. IP
addresses, decimal numbers, or already-formatted Markdown), and no other
section of the spec describes such a transform. `renderResolutionMessage()`
reproduces the sanitized body verbatim under a fixed `### ACP Resolution`
header, identically to how `/public` is handled. See
`lib/statusTemplates.mjs`'s module doc comment for the same note in code.

## Permission matrix (section 30/31), as enforced by `auth.mjs`

| Command | write | maintain | admin |
| --- | :-: | :-: | :-: |
| `/internal` | n/a (no check) | n/a | n/a |
| `/security` | ✅ | ✅ | ✅ |
| `/public` | ❌ | ✅ | ✅ |
| `/public-status` | ❌ | ✅ | ✅ |
| `/public-resolution` | ❌ | ✅ | ✅ |
| `/sync-pause` | ❌ | ✅ | ✅ |
| `/sync-resume` | ❌ | ✅ | ✅ |
| `/security-clear` | ❌ | ❌ | ✅ |

Enforced against the actor's precise `role_name` (not the legacy
`permission` field, which silently collapses `maintain`→`write` and
`triage`→`read` — see `auth.mjs`'s module doc comment; getting this wrong
would have meant every `maintain`-gated command was actually
enforcing only `write`, a real privilege-boundary bug that a superficial
reading of GitHub's own collaborator-permission endpoint response would
miss). Full matrix is exercised as a single parameterized test in
`lib/auth.test.js`.

An actor whose role cannot be determined, or who has any role this
bridge doesn't recognize (a future custom GitHub role, for example),
fails closed to "insufficient" rather than being treated as privileged.

## Two-step security recovery (section 27)

```
/security          (write+)   -> visibility:security-sensitive + sync:paused
      ↓
/security-clear     (admin)   -> removes visibility:security-sensitive ONLY
      ↓
/sync-resume        (maintain+) -> only now does sync:enabled return
```

No single command can go from "security-sensitive" to "publishing again"
— this is enforced by `securityState.applySecurityClear()` never touching
`sync:paused`, and `securityState.applySyncResume()` refusing to act at
all while `visibility:security-sensitive` is still present. Regression
test: `securityState.test.js` "a single /security-clear command cannot,
by itself, immediately republish content."
