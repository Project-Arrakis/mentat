# Discord Adapter Contract

## Source of Truth

The bot follows the Discord adapter in
[Red-Blink/dune-awakening-selfhost-docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker).

Evidence checked on August 16, 2026 (re-verified; previous evidence August 6, 2026):

| Source | Value |
| --- | --- |
| Upstream reference clone | Clean local clone of upstream `main`, kept outside this repository. Recommended sibling path: `../dune-awakening-selfhost-docker-upstream-main` |
| Upstream commit | `b4f8fe4c5a36e2ac2f81deb4c9fddde087c77d06` |
| Upstream file | `console/api/src/integrations/discord/adapter.js` and `routes.js` |
| Latest published upstream release | `v1.3.87` |
| Latest upstream release candidate observed | None newer than `v1.3.87` |

The adapter contract is included in upstream release `v1.3.87` (commit
`b4f8fe4c5a36e2ac2f81deb4c9fddde087c77d06`, 2026-08-14). The Discord adapter
moved from `console/api/src/services/discordAdapter.js` to
`console/api/src/integrations/discord/` in earlier upstream releases; the
route family grew from the four read-only routes to the full live set
documented in `src/adapterClient.js`'s `LIVE_ROUTES` (player linking, player
inventory/storage/find, guild storage/find, OPS providers). Route-by-route
provenance was re-verified against every upstream release tagged between the
prior baseline (reviewed 2026-08-06) and `v1.3.87` -- see
`arrakis-control-panel#172` for the full audit. **This refresh found and
corrected a real, previously-undetected false claim**: the prior "verified
2026-08-06" evidence for `players-accounts-list`, `players-accounts-unlink`,
and `players-accounts-link-steam` was wrong -- direct inspection of every
tagged upstream release shows none of the `players/accounts/*` multi-account
routes ever existed in any tag. They were transiently added in an untagged
upstream commit (`eac9c18`, 2026-08-10) alongside a
`multiAccountLinkProvider.js` file that was never actually committed (broken
import, server crashed on boot), then fully reverted the next day
(`d102557`, 2026-08-11), before ever reaching a tag. All three are now
correctly classified `MISSING_ROUTES`. The same refresh also found a real
regression: `ops-dashboard` was genuinely live at the prior baseline but
upstream's replacement `opsRoutes` dispatch table (added by `eac9c18` and
kept after the revert) omits it, so it now 404s at `v1.3.87` (moved
`LIVE_ROUTES` -> `MISSING_ROUTES`). `ops-location` was already correctly
classified as a stub at the prior baseline but the same dispatch-table
omission means it now hard-404s instead of returning a `{ status: "planned"
}` stub (kept in `PLANNED_ROUTES` since the intent is unchanged, but callers
must not assume "planned" means "safe 200" -- see the route's own comment in
`src/adapterClient.js`). Conversely, `backups`, `announcements`, and
`maintenance` were classified `PLANNED`/`MISSING` at the prior baseline but
now have real, working handlers at `v1.3.87` (moved to `LIVE_ROUTES`) --
this is safe-direction drift (the bot previously under-promised), corrected
in the same pass. The health payload no longer advertises `readOnly: true`;
player linking is a write path on Core's dedicated player-link routes (see
`src/commands.js`'s `aboutPayload`).

Future write-capable behavior is not part of this read-only contract. A draft
upstream proposal for separate, disabled-by-default write adapter routes lives
in `docs/upstream-write-adapter-rfc.md`.

## Boundary

The adapter is disabled by default in the console, protected by a bearer token,
and exposes only read-only routes for this bot.

The bot must not:

- mount the Docker socket
- connect directly to the database
- read game files
- run shell commands
- call write-capable console routes
- log or display Discord, adapter, WebUI, or game service secrets

## Routes

| Bot command | Method | Adapter route | Expected body |
| --- | --- | --- | --- |
| `/dune ping` | `GET` | `/api/integrations/discord/health` | none |
| `/dune health` | `GET` | `/api/integrations/discord/health` | none |
| `/dune status` | `POST` | `/api/integrations/discord/status` | `{ "actor": { ... } }` |
| `/dune status-summary` | `POST` | `/api/integrations/discord/status` | `{ "actor": { ... } }` |
| `/dune readiness` | `POST` | `/api/integrations/discord/readiness` | `{ "actor": { ... } }` |
| `/dune services` | `POST` | `/api/integrations/discord/services` | `{ "actor": { ... } }` |

The POST body carries minimal Discord actor context: user ID, guild ID, channel
ID, and role IDs. It is used for adapter-side capability checks and should not
include tokens, message content, or broader Discord profile data.

## Additional Local Routes (Unverified Against Upstream)

The bot implements bot commands and `AdapterClient` methods for routes beyond
the verified core set above. These have config paths/methods in `src/config.js`
and a client method in `src/adapterClient.js`, and their upstream provenance
was re-verified against tag `v1.3.87` on 2026-08-16 (see
`arrakis-control-panel#172`, plus the full-set pin in
`test/adapterClient.test.js`).
`src/adapterClient.js` tracks per-route status honestly via `LIVE_ROUTES`,
`PLANNED_ROUTES` (upstream stub/placeholder data), `UNMERGED_ROUTES`
(implemented on an upstream feature branch, not `main`), and `MISSING_ROUTES`
(no known upstream implementation). `executeDuneCommand()` surfaces a specific
"not yet merged" message for `UNMERGED_ROUTES` failures instead of a generic
error. Treat any route not in this file's verified table above as unverified
until it is re-checked against upstream `main` and this document is updated.

The `maintenance` route (`server:maintenance` bot command) is a case in point
for why this table needs recurring re-verification, not one-time evidence: at
the prior baseline it genuinely 404'd (Core declared the route constant but
never registered it in `DISCORD_LIVE_ADAPTER_ROUTES`), so it was classified
`MISSING_ROUTES`. Re-verified at `v1.3.87` (2026-08-16, `#172`): upstream now
has a real handler (runs `dune readiness` and returns real output), so it is
now classified `LIVE_ROUTES`. `formatMaintenanceEmbed()` still treats any
response without `ok: true` as an explicit **Unknown** state rather than a
healthy "no maintenance scheduled" state, so a future regression on this
route would still degrade safely instead of showing false-positive health.

## Fixtures

The contract fixtures live in `test/fixtures/adapter/`:

- `health.json`
- `status.json`
- `readiness.json`
- `services.json`

The fixtures are intentionally small. They document the fields the bot must be
able to receive and format without depending on a live console.

## Local Mock

`npm run mock:adapter` starts a local-only adapter mock that serves these
fixtures over the same routes. It is for smoke tests and examples, not for
production use. The mock requires a bearer token and refuses to bind outside
loopback when using the default local token.

## Compatibility Rules

- Default paths and methods should match upstream `main`.
- Route override environment variables remain available for release drift.
- Method overrides are limited to `GET` and `POST`.
- `GET` requests do not send actor bodies.
- `POST` requests send actor context and `content-type: application/json`.
- Adapter errors are formatted through the same redaction path as successful
  payloads.
- `/dune ping` summarizes the health response and timing metadata instead of
  forwarding the raw health payload.
- `/dune status-summary` summarizes aggregate status fields and intentionally
  omits server title and battlegroup from the compact output.

## STRIDE Notes

| Category | Control |
| --- | --- |
| Spoofing | Discord identity comes from the interaction, and the adapter requires a bearer token. |
| Tampering | The bot only sends route-specific read-only requests and minimal actor context. |
| Repudiation | Write actions are out of scope; future write-capable work must add audit evidence before implementation. |
| Information disclosure | Responses are redacted and bounded before being sent to Discord. |
| Denial of service | The adapter client applies request timeouts; recurring or scheduled features need explicit rate limits before shipping. |
| Elevation of privilege | RBAC is restricted by default, and unsupported commands fail closed. |
