# Discord Adapter Contract

## Source of Truth

The bot follows the Discord adapter in
[Red-Blink/dune-awakening-selfhost-docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker).

Evidence checked on June 22, 2026:

| Source | Value |
| --- | --- |
| Upstream reference clone | `/home/ronal/dune-awakening-selfhost-docker-upstream-main` |
| Upstream commit | `6fe7f46` |
| Upstream file | `console/api/src/services/discordAdapter.js` |
| Latest published upstream release | `v1.3.17` |

The adapter contract is present on upstream `main` after the latest published
release. Treat these defaults as upstream-main compatible until a release tag
includes the same adapter behavior.

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
| `/dune health` | `GET` | `/api/integrations/discord/health` | none |
| `/dune status` | `POST` | `/api/integrations/discord/status` | `{ "actor": { ... } }` |
| `/dune readiness` | `POST` | `/api/integrations/discord/readiness` | `{ "actor": { ... } }` |
| `/dune services` | `POST` | `/api/integrations/discord/services` | `{ "actor": { ... } }` |

The POST body carries minimal Discord actor context: user ID, guild ID, channel
ID, and role IDs. It is used for adapter-side capability checks and should not
include tokens, message content, or broader Discord profile data.

## Fixtures

The contract fixtures live in `test/fixtures/adapter/`:

- `health.json`
- `status.json`
- `readiness.json`
- `services.json`

The fixtures are intentionally small. They document the fields the bot must be
able to receive and format without depending on a live console.

## Compatibility Rules

- Default paths and methods should match upstream `main`.
- Route override environment variables remain available for release drift.
- Method overrides are limited to `GET` and `POST`.
- `GET` requests do not send actor bodies.
- `POST` requests send actor context and `content-type: application/json`.
- Adapter errors are formatted through the same redaction path as successful
  payloads.

## STRIDE Notes

| Category | Control |
| --- | --- |
| Spoofing | Discord identity comes from the interaction, and the adapter requires a bearer token. |
| Tampering | The bot only sends route-specific read-only requests and minimal actor context. |
| Repudiation | Write actions are out of scope; future write-capable work must add audit evidence before implementation. |
| Information disclosure | Responses are redacted and bounded before being sent to Discord. |
| Denial of service | The adapter client applies request timeouts; recurring or scheduled features need explicit rate limits before shipping. |
| Elevation of privilege | RBAC is restricted by default, and unsupported commands fail closed. |
