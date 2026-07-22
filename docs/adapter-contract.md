# Discord Adapter Contract

## Source of Truth

The bot follows the Discord adapter in
[Red-Blink/dune-awakening-selfhost-docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker).

Evidence checked on July 18, 2026:

| Source | Value |
| --- | --- |
| Upstream reference clone | Clean local clone of upstream `main`, kept outside this repository. Recommended sibling path: `../dune-awakening-selfhost-docker-upstream-main` |
| Upstream commit | `fdaca43` |
| Upstream file | `console/api/src/services/discordAdapter.js` |
| Latest published upstream release | `v1.3.60` |
| Latest upstream release candidate observed | None newer than `v1.3.60` |

The adapter contract is included in upstream release `v1.3.60`. No changes were
observed in `console/api/src/services/discordAdapter.js` between the earlier
fixture baseline and upstream commit `fdaca43`. Upstream API source changed
elsewhere, so route registration was also reviewed; the Discord adapter still
exposes the same four read-only routes. The health payload still advertises
`readOnly: true` and `writesEnabled: false`.

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
the four verified above. These have config paths/methods in `src/config.js`
and a client method in `src/adapterClient.js`, but their upstream provenance
has not been independently re-verified since the July 18, 2026 evidence check.
`src/adapterClient.js` tracks per-route status honestly via `LIVE_ROUTES`,
`PLANNED_ROUTES` (upstream stub/placeholder data), `UNMERGED_ROUTES`
(implemented on an upstream feature branch, not `main`), and `MISSING_ROUTES`
(no known upstream implementation). `executeDuneCommand()` surfaces a specific
"not yet merged" message for `UNMERGED_ROUTES` failures instead of a generic
error. Treat any route not in this file's verified table above as unverified
until it is re-checked against upstream `main` and this document is updated.

The `maintenance` route (`server:maintenance` bot command) is a case in point:
it has a config path/method and an `AdapterClient.maintenance()` method, but
no upstream verification evidence exists for it, and it is deliberately left
out of `LIVE_ROUTES`/`PLANNED_ROUTES`/`UNMERGED_ROUTES` (so `routeStatus()`
returns `"unknown"`). `formatMaintenanceEmbed()` treats any response without
`ok: true` as an explicit **Unknown** state rather than a healthy "no
maintenance scheduled" state, so an unsupported or failing route degrades
safely instead of showing false-positive health.

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
