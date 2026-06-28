# Upstream Write Adapter RFC

## Status

Draft for discussion with the upstream maintainer. This repository remains
read-only. Do not implement Discord write commands in this bot until upstream
publishes and approves a write-capable adapter contract.

The current upstream Discord adapter is read-only in
`Red-Blink/dune-awakening-selfhost-docker@1bb72c5`, latest stable tag
`v1.3.37`. Its health payload advertises `readOnly: true` and
`writesEnabled: false`. The upstream `v1.3.38-rc.1` tag was checked as a
release-candidate signal and did not change Discord adapter route files.

## Maintainer Brief

The goal is to let an external, self-hosted Discord bot request narrowly scoped
administrative actions without giving the bot Docker socket access, database
access, game-file access, shell access, or direct console internals.

The proposed write adapter should be:

- disabled by default
- separate from the current read-only adapter routes
- bearer-token protected
- capability-discovered before use
- dry-run capable when an action can be previewed
- confirmation and idempotency aware for executed writes
- audit logged by the console
- redacted before returning data to Discord

Read-only bot commands must keep working without enabling any write route.
When write routes are explicitly enabled, their capability response should
report `readOnly: false`; the existing read-only adapter routes should keep
their current read-only behavior.

## Non-Goals

- No direct Docker socket access from the bot.
- No direct database access from the bot.
- No game-file mounts in the bot container.
- No raw shell command execution requested by the bot.
- No shared public bot or upstream-hosted Discord service.
- No player or game-state mutation as the first write slice.
- No PCI/payment-card data flow.

## Proposed Routes

Keep write routes under a separate namespace:

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/integrations/discord/write/capabilities` | Advertise enabled write contract version, action list, tiers, and constraints. |
| `POST` | `/api/integrations/discord/write/preview` | Validate and preview a write request without side effects. |
| `POST` | `/api/integrations/discord/write/execute` | Execute a confirmed write request with idempotency and audit evidence. |

All write routes should return `404` or an equivalent disabled response until a
write-specific feature flag is enabled. A deployment should be able to disable
all write routes without disabling the existing read-only adapter.

## Capability Discovery

The capability response should be safe to call before rendering any write
command:

- `contractVersion`
- `readOnly`
- `writesEnabled`
- `writeRoutes`
- `supportedActions`
- `requiredActorFields`
- `maxRequestBytes`
- `rateLimit`
- `idempotencyWindowSeconds`

Each action should document:

- `action`
- `label`
- `risk`
- `tier`
- `dryRunSupported`
- `confirmationRequired`
- `idempotencyRequired`
- `targetSchemaRef`
- `parameterSchemaRef`
- `sideEffects`
- `rollback`
- `disabledReason`, when unavailable

Schema: `docs/schemas/upstream-write-adapter/write-capabilities.schema.json`.

## Request Shape

Write preview and execute requests should include:

- `contractVersion`
- `clientRequestId`
- `idempotencyKey`
- `dryRun`
- `action`
- `actor`
- `target`
- `parameters`
- `confirmation`

The actor object should be minimal Discord context only:

- `userId`
- `guildId`
- `channelId`
- `roleIds`

Do not include Discord tokens, adapter tokens, message content, broader Discord
profile data, email addresses, SteamIDs, FuncomIDs, real names, or private
server addresses.

Schema: `docs/schemas/upstream-write-adapter/write-request.schema.json`.

## Response Shape

Write preview and execute responses should include:

- `ok`
- `contractVersion`
- `operation`
- `action`
- `dryRun`
- `correlationId`
- `auditId`
- `sideEffectSummary`
- `rollbackHint`
- `result`
- `error`

Errors should use stable machine-readable codes and redacted messages. The
adapter should not return raw exception stacks, shell output, tokens, file
paths with private user names, emails, SteamIDs, FuncomIDs, real names, or
private server addresses.

Schema: `docs/schemas/upstream-write-adapter/write-response.schema.json`.

## Confirmation and Idempotency

The bot should require a Discord-side confirmation step before calling execute.
The adapter should also reject execute requests without a valid confirmation
object for actions marked `confirmationRequired`.

The adapter should treat `idempotencyKey` as required for all write execution.
If a retry repeats the same key, the adapter should return the original
operation status instead of duplicating side effects.

Suggested execute behavior:

1. Validate bearer token and write feature flag.
2. Validate actor tier for the requested action.
3. Validate action, target, parameters, and confirmation.
4. Check idempotency cache.
5. Create audit/correlation IDs before side effects.
6. Execute the operation or return dry-run/preview output.
7. Store the idempotency result.
8. Return a bounded, redacted response.

## Audit Requirements

The console should own write audit logging because it owns the side effects.
Each write attempt should produce an audit event with:

- timestamp
- correlation ID
- audit ID
- actor Discord user ID
- guild ID
- channel ID
- action
- target summary
- dry-run flag
- result status
- error code, when applicable
- idempotency key hash, not the raw key

Audit logs must redact secrets, tokens, authorization headers, emails, SteamIDs,
FuncomIDs, explicit real-name fields, and private deployment details.

## Proposed Action Tiers

Start with actions that do not restart services, touch game state, or mutate
player data.

| Phase | Candidate action | Risk | Notes |
| --- | --- | --- | --- |
| 1 | `maintenance.note.set` | Low | Operator-visible metadata only. Good first write contract candidate. |
| 1 | `maintenance.window.set` | Low | Metadata with clear start/end validation. |
| 1 | `discord.notification-config.set` | Low | Bot-owned or adapter-owned notification metadata only. |
| 2 | `backup.create` | Medium | Side effect is a new backup artifact; needs quota and path controls. |
| 2 | `service.restart` | High | Operational disruption; requires stronger confirmation and cooldowns. |
| 2 | `update.trigger` | High | Needs dry-run, maintenance window awareness, and rollback instructions. |
| 3 | `player.moderation.*` | Critical | Do not start here; privacy and abuse risks are high. |
| 3 | `database.execute` | Critical | Not suitable for Discord adapter v1 write scope. |
| 3 | `restore.execute` | Critical | Highest operational risk; needs out-of-band approval. |

## STRIDE Review

| Category | Minimum control |
| --- | --- |
| Spoofing | Bind Discord actor context to bearer-token-authenticated adapter requests. |
| Tampering | Validate action, target, parameters, confirmation nonce, and idempotency key before side effects. |
| Repudiation | Write audit event before and after side effects with correlation IDs. |
| Information disclosure | Redact sensitive fields in previews, errors, audit logs, and Discord output. |
| Denial of service | Enforce rate limits, cooldowns, concurrency limits, request size limits, and timeouts. |
| Elevation of privilege | Require write-specific tiers; observer roles must never inherit write access. |

## Abuse Cases

- A compromised observer role tries to restart services.
- A user replays a confirmation message after the maintenance window.
- A network timeout causes the bot to retry a write and duplicate side effects.
- A failed write returns raw shell output or a token in the error body.
- A public Discord channel receives write-result details that identify a player
  or private server address.
- A broad write route accepts an action that performs more than its label says.

## Fixture Packet

Example fixtures live under `test/fixtures/write-adapter/`:

- `capabilities.json`
- `requests/preview-maintenance-note.json`
- `requests/execute-maintenance-note.json`
- `responses/dry-run-success.json`
- `responses/confirmed-success.json`
- `responses/denied.json`
- `responses/timeout.json`
- `responses/redacted-failure.json`

These are proposal fixtures for conversation with upstream. They do not mean
the bot currently calls write routes.

## Maintainer Questions

1. Is a separate `/api/integrations/discord/write/*` namespace acceptable?
2. Should capability discovery live in health, a new write route, or both?
3. Which low-risk metadata write would upstream prefer as the first contract
   candidate?
4. Can upstream own idempotency result storage, or should it be limited to a
   bounded in-memory window?
5. Where should write audit events live in the console deployment?
6. Are there existing upstream permission tiers that should map to
   `observer`, `write-admin`, and `owner`?
7. Which operations can support dry-run or preview without creating side
   effects?

## Sources

- Current read-only adapter contract: `docs/adapter-contract.md`
- Non-read-only roadmap: `docs/non-readonly-roadmap.md`
- OWASP API Security Top 10 2023:
  https://owasp.org/API-Security/editions/2023/en/0x00-header/
- OWASP Authorization Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
- OWASP Logging Cheat Sheet:
  https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- NIST SP 800-53 Rev. 5 control catalog:
  https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final
- HTTP Semantics, RFC 9110:
  https://www.rfc-editor.org/rfc/rfc9110
