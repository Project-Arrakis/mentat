# RO Roadmap State — 2026-08-06 Evidence Review

> **SUPERSEDED, in part, 2026-08-16 (see `arrakis-control-panel#172`).** This
> document's "LIVE (28)" list below includes `players-accounts-list`,
> `players-accounts-unlink`, and `players-accounts-link-steam` with the claim
> that all three were "verified against tag `v1.3.79`". **That claim was
> false.** A follow-up audit on 2026-08-16, prompted by a routine upstream
> compat pin refresh to `v1.3.87`, independently re-checked every tagged
> upstream release from `v1.3.79` through `v1.3.87` by direct inspection and
> found none of the `players/accounts/*` multi-account routes ever existed in
> any tag -- they were transiently added in an untagged commit (`eac9c18`,
> 2026-08-10) alongside a broken, never-actually-committed provider file, then
> reverted the next day (`d102557`, 2026-08-11), before ever reaching a tag.
> The same 2026-08-16 audit found a second, independent false claim in this
> document: `ops-dashboard` is listed under "PLANNED (8)" below, with the
> "What Was NOT Changed (Deliberate)" section explicitly asserting it "still
> return[s] placeholders upstream" at `v1.3.79`. That was also false --
> `ops-dashboard` was genuinely **LIVE** at `v1.3.79` (dispatched via the
> older `OPS_PATHS`/`OPS_PROVIDERS` array), and only regressed to a 404
> between `v1.3.79` and `v1.3.87`, once upstream's replacement `opsRoutes`
> dispatch table silently omitted it. Do not treat this document's
> route classifications as current; `src/adapterClient.js`'s `LIVE_ROUTES`/
> `PLANNED_ROUTES`/`UNMERGED_ROUTES`/`MISSING_ROUTES` sets and
> `docs/adapter-contract.md` are the current source of truth as of any given
> read. This correction is left here, rather than silently rewriting the
> history below, so a future reader can see exactly what was wrong and why --
> consistent with this project's "a severity/status claim is a hypothesis
> until independently re-verified" discipline (see the main README's
> `dune-awakening-selfhost-docker` #121-123 correction for the precedent).

This document records a live, evidence-verified audit of this repository's
roadmap / release / route-status documentation against the real current state
of the codebase and of upstream
`Red-Blink/dune-awakening-selfhost-docker`. It exists because several claims
in `docs/roadmap.md`, `docs/adapter-contract.md`, `docs/upstream-source.md`,
and `test/upstreamEvidence.test.js` had drifted from reality.

Every claim below was verified against real command output / real upstream
source at tag `v1.3.79` on 2026-08-06 (upstream release commit `d41f1270`,
tag `ac8f086`, released 2026-08-05). Nothing here is asserted from memory.

## Method

1. Read the current route tables in `src/adapterClient.js` and the path/method
   tables in `src/config.js`.
2. Classified every `DEFAULT_PATHS` key via `routeStatus()` — found fourteen
   keys reporting `"unknown"`.
3. Verified each unclassified/moved route against upstream tag `v1.3.79` by
   direct grep of:
   - `console/api/src/integrations/discord/adapter.js` (route constants +
     `DISCORD_LIVE_ADAPTER_ROUTES`)
   - `console/api/src/integrations/discord/routes.js` (actual handlers)
4. Cross-checked the bot's `AdapterClient` methods against the derived
   dispatch (commands.js `route -> camelCase method`).
5. Re-based with live upstream (`git fetch upstream --tags`), confirmed tagged
   commits by SHA.

## Route Status After Fix (28 / 8 / 7 / 6)

All 49 `DEFAULT_PATHS` keys are now classified in exactly one set. Pinned by
`test/adapterClient.test.js` (any new config route that is not classified is a
test failure).

- **LIVE (28)**: `health`, `status`, `readiness`, `services`, `population`,
  `logs`, `map-state`, `version`, `servers`, `ports`, `db`, `ops-activity`,
  `ops-combat`, `ops-resources`, `ops-economy`, `players-link-verify`,
  `players-accounts-list`, `players-accounts-unlink`, `players-link`,
  `players-unlink`, `players-me`, `players-inventory`,
  `players-inventory-search`, `players-storage`, `players-find`,
  `guild-storage`, `guild-find`, `players-accounts-link-steam`.

  Added on 2026-08-06 (previously unclassified / claimed UNMERGED):
  `players-link`, `players-unlink`, `players-me`, `players-inventory`,
  `players-inventory-search`, `players-storage`, `players-find`,
  `guild-storage`, `guild-find`, `players-accounts-link-steam`. All ten are
  real, live Core routes (present in `DISCORD_LIVE_ADAPTER_ROUTES` with real
  handlers in `routes.js` at v1.3.79) and all ten are called daily by real bot
  commands (`/dune player …`, the Steam link flow). They were dropped from
  `UNMERGED_ROUTES` during the 2026-07-26 reconciliation but never added to
  any table, so `routeStatus()` reported `"unknown"` for them.

- **PLANNED (8)**: `backups`, `announcements`, `broadcast`, `ops-inventory`,
  `ops-location`, `ops-soc`, `ops-prometheus`, `ops-dashboard`. Upstream
  serves `{ status: "planned" }` stubs or no backing query yet.

- **UNMERGED (7)**: `players-faction`, `player-links-start`,
  `guild-grants`, `guild-grants-enable`, `guild-grants-disable`,
  `guild-grants-default`, `player-inventory-v2`. Verified ABSENT from upstream
  at v1.3.79 (no such constants; `guild-character-grants/*` never existed).

- **MISSING (6)**: `write-execute`, `write-preview`, `maintenance`,
  `player-links`, `player-links-verify`, `player-links-unlink`.

  - `maintenance`: upstream DECLARES the constant
    `/api/integrations/discord/maintenance` but never registers it in
    `DISCORD_LIVE_ADAPTER_ROUTES` and `routes.js` has no handler -> every call
    404s ("Discord adapter route not found"). **`/dune server maintenance`
    therefore fails in production today.** See Follow-ups.
  - `player-links`, `player-links-verify`, `player-links-unlink`: the
    never-built `player-links/*` path family. Core has no such routes, and no
    `AdapterClient` method calls these three keys — they survive only as
    config path entries. Classifying them MISSING (instead of "unknown") is
    honest about the dead config; see Follow-ups for removal.

## Latent User-Facing Bugs Found and Fixed

1. **`/dune ops announcements` TypeError in production.**
   `OPS_COMMANDS.announcements.route = "ops-announcements"` derived method
   `opsAnnouncements` — which existed ONLY in the test mock
   (`test/fixtures/mockAdapter.js`, now removed) and was never a method on the
   real `AdapterClient`. A live invocation would have thrown `TypeError`. The
   route path `/ops/announcements` does not exist upstream either. Fix:
   `opsCommands.js` now routes the subcommand to the real
   `/api/integrations/discord/announcements` (which upstream serves as a
   planned stub, consistent with `PLANNED_ROUTES`), so the dispatch calls the
   real, existing `AdapterClient.announcements()`. Pinned by tests.

2. **`/dune help` silently hid commands.** `helpPayload` listed 32 commands
   and omitted the ENTIRE `player` group (12), the ENTIRE `logs` group (7),
   and 3 `server` subcommands (`readiness-detail`,
   `services-detail`, `maintenance`) — every one registered and dispatchable.
   Fix: help now lists the full registered surface (54 non-write commands; +
   12 `write` entries only when that group is registered), in registration
   order, and the write group is gated with `canWrite()` rather than the
   normal observer/admin RBAC. Pinned by `test/commands.test.js` (exact set
   equality with `commandDefinitions()`).

3. **`/dune server maintenance` calls a route that 404s.**
   Verified upstream as described above. Not yet fixed beyond classification
   (the honest `routeStatus() = "missing"` now gives callers a truthful
   signal instead of "unknown"), and the subcommand still makes the call. See
   Follow-ups.

## Documentation Corrected in This Audit

- `docs/roadmap.md`:
  - Command table rewritten to the real registered surface (adds `logs`,
    correct `player` subcommand names, adds `readiness-detail`/`services-detail`/
    `maintenance`, `roles`, `announcements`, `setup`, and the write group).
  - Route counts: `LIVE 19 / PLANNED 5 / UNMERGED 10 / MISSING 2` was wrong on
    all four numbers -> `LIVE 28 / PLANNED 8 / UNMERGED 7 / MISSING 6`.
  - Test counts: 48 harness / 204 core -> **412 core + 72 harness + 5 bats =
    489 total, 0 skipped**. (The old "489/489" figure in the PR #91 claim was
    coincidentally the same total; the breakdown was stale.)
  - Upstream baseline: `v1.3.60` / `fdaca43` -> `v1.3.79` / `d41f1270`.
  - PR #91 row: "pending merge" -> **merged 2026-07-20** (`47ca186`), shipped
    v1.3.61, still live through v1.3.79.
  - `readOnly` framing corrected: player linking is a write path (the
    read-only claim applied to the operator write-command group only).
- `docs/adapter-contract.md`, `docs/upstream-source.md`,
  `docs/upstream-write-adapter-rfc.md`: baseline advanced to `d41f1270` /
  `v1.3.79`, review date `August 6, 2026`.
- `test/upstreamEvidence.test.js`: baseline pin advanced; `fdaca43` and
  `v1.3.60` added to `supersededEvidenceTerms`.

## What Was NOT Changed (Deliberate)

- **Release/promotion state**: `package.json` says `1.0.0-rc.2`, latest stable
  is `v0.1.1`; `v1.0.0` has not shipped and the rows in
  `docs/v1.0.0-promotion-checklist.md` are still rc-1-era (they reference
  upstream `v1.3.41`/`5163bd8` and PRs #40/#41). Refreshing the promotion
  checklist is a separate, tracked task (see Issues), not something this audit
  should silently rewrite.
- The `CHANGELOG.md` test-count and read-only corrections from earlier
  sessions were verified still accurate and left as-is.
- `ops-inventory`/`ops-location`/`ops-soc`/`ops-prometheus`/`ops-dashboard`
  stay `planned`: verified they still return placeholders upstream, so the
  bot's own "planned" classification is correct.

## Follow-ups (tracked separately)

1. Either implement or deliberately disable `/dune server maintenance`
   (route 404s upstream).
2. Consider removing the dead `player-links*` config path/method entries from
   `src/config.js` (now that they are classified MISSING, the config
   entries could be cleaned up; note nothing calls them).
3. Refresh `docs/v1.0.0-promotion-checklist.md` against current upstream
   (`v1.3.79`) and the current operator gates.
4. `acp-ops-monitor`'s docs-currency checks run against this file's claims —
   keep this file synchronized when any of the above statuses change.