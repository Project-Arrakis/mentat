# ACP Issue Bridge — Labels

All label taxonomy data (name/color/description) lives in
`.github/scripts/issue-bridge/lib/labelDefinitions.mjs`; all label
*policy* (which labels are allowlisted to cross repos, which are
forbidden from ever being public) lives in
`.github/acp-issue-bridge.yml` (section 75: "do not scatter policy
constants through source code"). Both are bootstrapped for real via
`maintenance-bootstrap-labels.mjs` (idempotent — creates only what's
missing, never edits an existing label's color/description since a
maintainer may have deliberately customized it).

## Public taxonomy (`Project-Arrakis/sentinel-support`)

- **Type:** `type:bug` `type:feature` `type:documentation` `type:support`
  `type:compatibility` `type:performance`
- **Status:** `status:needs-triage` `status:confirmed` `status:planned`
  `status:in-progress` `status:blocked` `status:testing`
  `status:ready-for-release` `status:released`
- **Priority:** `priority:p0` `priority:p1` `priority:p2` `priority:p3`
- **Area:** `area:discord` `area:commands` `area:readiness`
  `area:metrics` `area:notifications` `area:deployment`
  `area:documentation` `area:authentication` `area:permissions`
  `area:observability` `area:webui` `area:api`

## Private taxonomy (`Project-Arrakis/sentinel`)

- **Source:** `source:public` `source:internal`
- **Visibility:** `visibility:internal` `visibility:security-sensitive`
- **Synchronization:** `sync:enabled` `sync:paused` `sync:error`
- **Status:** `status:triaged` `status:confirmed` `status:planned`
  `status:in-progress` `status:blocked` `status:testing`
  `status:ready-for-release` `status:released` `status:public-closed`
- **Priority:** same four as public
- **Type / Area:** identical to public (not enumerated in the spec's
  section 13 list, but required — see below)

### Why `type:*`/`area:*` exist on the private side too

Spec section 13's private taxonomy list does not mention `type:*`, but
section 14/15's label mapping applies these classification labels to
every private mirror. GitHub's "add labels to an issue" API does not
auto-create a missing label — it 422s. Omitting `type:*` from the
private taxonomy would therefore make every public-issue-opened label
translation fail the moment a public issue had a `type:*` label. Found
via a real, failing unit test
(`labelDefinitions.test.js`, "every config.label_mapping value exists in
the private taxonomy") before this ever reached a live repository — see
`docs/issue-bridge/testing.md`.

## Label mapping (public → private only)

`label_mapping` in `acp-issue-bridge.yml` is the **only** allowlist,
covering `type:*`, `priority:*`, and `area:*` — 1:1 identical names both
sides. `status:*` is deliberately **excluded** from `label_mapping`
entirely (`config.mjs`'s validator rejects any `status:*` key there) —
status is command-driven only (`/public-status`, `/public-resolution`),
never a side effect of someone applying a label, so a public
collaborator cannot fake a release by slapping on `status:released`.

There is no private → public label mapping direction at all (event
matrix: "Private | Label changed | Public | No action").

## Labels that must never be exposed publicly (section 15)

```
visibility:internal
visibility:security-sensitive
sync:enabled
sync:paused
sync:error
source:internal
source:public
```

This list is defined twice, deliberately: once as a hard-coded constant
in code (`config.mjs`'s `HARD_CODED_FORBIDDEN_PUBLIC_LABELS`) and once in
the config file's `never_expose_publicly` map. `validateConfig()` asserts
the config's list is a **superset** of the hard-coded one — config can
only extend the denylist, never shrink it, so an accidental edit to the
YAML file cannot silently remove this protection.

Negative tests exist for every single one of these labels individually
(`labelMap.test.js`, one parameterized test per label,
`SEC: "<label>" is never mappable from a public label and is always
forbidden`), per section 15's explicit instruction: "Write automated
negative tests for each one."
