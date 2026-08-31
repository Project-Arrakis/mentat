# Environment Variable Compatibility (Sentinel/ACP → Mentat)

**Date:** 2026-08-31
**Status:** Current
**Tracking:** Project-Arrakis/meta#57 (Phase 3 design), Project-Arrakis/meta#56 (naming disambiguation)

## What this is

Part of the Sentinel → Mentat rebrand, this bot resolves several environment
variables through a compatibility layer (`src/compatEnv.js`) instead of
reading them directly, so operators on the old `ACP_*` names keep working
without any action, while `MENTAT_*` becomes the canonical name going
forward.

## Precedence

For each covered variable (e.g. `BASE_URL`):

1. `MENTAT_BASE_URL`, if set to a non-empty value, wins. If a legacy
   (`SENTINEL_BASE_URL`/`ACP_BASE_URL`) value is also present, it's ignored
   and a one-line warning names which variable was ignored — never its
   value.
2. If `MENTAT_BASE_URL` is unset (or empty), exactly one legacy alias set →
   that value is used, with one deprecation warning naming the deprecated
   variable and its canonical replacement.
3. If both `SENTINEL_BASE_URL` and `ACP_BASE_URL` are set to *different*
   values, `SENTINEL_BASE_URL` wins (it's closer in lineage to Mentat) and
   a warning names both variables.
4. If nothing is set, behavior is unchanged from before this compatibility
   layer existed.

Variables covered today: `BASE_URL`, `MULTI_TENANT`, `SETUP_PORT`,
`CONSOLE_DASHBOARD_URL`, `GRAFANA_DASHBOARD_URL`, `OAUTH_REDIRECT_URI`,
`STEAM_LINK_PORT`, `STEAM_LINK_BASE_URL`, `INSTANCE_ID`, `STATS_ENABLED`,
`SETUP_URL`.

## What's deliberately NOT covered yet

- **`DB_PATH`** — still reads `ACP_DB_PATH` only. Adding `MENTAT_DB_PATH`
  here before the `acp.db` → `mentat.db` file migration exists would let an
  operator silently point a fresh deployment at an empty, newly-created
  database, orphaning their real data. This lands together with that
  migration, not before it.
- **Credential-bearing variables** (`ACP_SECRETS_KEY`, `ACP_SECRETS_KEY_FILE`,
  `ACP_KEK_FILE`, `ACP_KEK_FILE_V<n>`, `ACP_KEK_VERSION`,
  `ACP_AGE_IDENTITY_FILE`) — read directly in `src/secretsCrypto.js` and
  `src/index.js`, untouched by this pass. These need their own dedicated,
  carefully-tested change given the real-money consequences of a mistake in
  key material resolution.
- The `ACP-PUBLIC-<n>` GitHub issue-bridge sync ID format and the
  `ACP-XXXXXX` Discord verification-code prefix — both cross-repo contracts
  blocked on the still-undecided canonical name for `sentinel-support`.

## Validation and fail-closed behavior

`resolveCompatEnv(env, suffix, { urlShaped })` optionally validates the
canonical value before granting it precedence (currently used for every
URL-shaped variable above). An invalid canonical value does not silently
win — it falls back to a working legacy value (with a loud warning) if one
exists, or resolves to `undefined` otherwise, letting the caller's own
required-value check fail closed. A caller needing a different validity
check (e.g. a future credential variable) passes `options.validate` — see
the doc comment in `src/compatEnv.js`.

Warnings are never allowed to contain a variable's actual value, only its
name — enforced by `src/logger.js`'s `logWarn()`, which routes through the
same `redactSecrets()` helper `logInfo`/`logError` already use.

## Removal

A legacy alias will only be removed in a release this CHANGELOG explicitly
marks "breaking", at least one release after its deprecation was first
announced here.
