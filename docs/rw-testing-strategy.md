# Write Testing Strategy

Every write-capable command must pass tests at four layers before merge:
unit → integration → security → end-to-end.

**Implementation note:** this document mixes tests that exist today (unit
tests for `writes.js`, `writeHandler.js`, `writeConfirmation.js`, and
`broadcast.js`) with target-design tests for a preview/execute adapter
integration that does not exist yet. Sections and scenarios are labeled
"Current, Implemented" or "Not Implemented"/"Forward-Looking" throughout —
treat unlabeled examples in the "Security Tests" section below as
forward-looking unless they reference a real, currently-exported function.

## Test Layers

| Layer | Scope | Framework | Time Budget | Gate |
|-------|-------|-----------|-------------|------|
| **Unit** | Bot-side primitives | node:test | <5s per suite | Must pass |
| **Integration** | Bot ↔ mock adapter | node:test + mock server | <30s | Must pass |
| **Security** | Abuse cases, RBAC, rate limits | node:test + DAST | <60s | Must pass |
| **End-to-End** | Discord interaction → adapter execute | Manual + test harness | Manual | Release candidate |

## Unit Tests — Bot-Side Primitives

### writes.js

```js
test("writesEnabled returns false by default", ...);
test("writesEnabled respects env flag", ...);
test("writesEnabled respects config flag", ...);
test("canWrite returns false when writes disabled", ...);
test("canWrite returns false with no roles", ...);
test("canWrite returns true for write-admin role", ...);
test("canWrite returns true for write-owner role", ...);
test("canWrite enforces tier separation", ...);
test("generateIdempotencyKey produces unique keys", ...);
test("generateIdempotencyKey format is valid UUID v4", ...);
test("requireConfirmation includes action/target/risk", ...);
test("isConfirmationResponse matches confirm", ...);
test("isConfirmationResponse rejects similar strings", ...);
test("writeAuditEvent includes all required fields", ...);
test("writeAuditEvent actor is redacted", ...);
```

### writeCommands.js — NOT the live path (do not rely on these tests as coverage)

`writeCommands.js` (`activeWriteCommands()`, `executeWriteCommand()`) is a
separate, unused command-execution scaffold from the same PR #63 write-safety
foundation. `commands.js` never imports it — the live write dispatch path is
`writeHandler.js::handleWriteCommand()`. Any tests written against
`writeCommands.js` exercise dead code; they do not verify the bot's actual
write-command behavior. Prefer `test/writeHandler.test.js` for that coverage
(see below).

### writeHandler.js — the live write-command path

```js
test("handleWriteCommand returns disabled when writes are off", ...);
test("handleWriteCommand requires write roles when writes are enabled", ...);
test("handleWriteCommand returns confirmation for valid write admin", ...);
test("handleWriteCommand registers a button-based pending confirmation", ...);
test("handleWriteCommand rejects unknown write subcommand", ...);
test("all write commands return pending-upstream status for a write-owner user", ...);
test("write-admin role cannot reach owner-tier commands (tier separation)", ...);
test("write-owner role can reach both admin-tier and owner-tier commands", ...);
test("write commands never call adapter — pure read-only scaffold", ...);
```

### writeConfirmation.js — button UI and interaction routing

```js
test("buildConfirmationRow embeds the idempotency key in both custom IDs", ...);
test("buildConfirmationEmbed includes action, tier, and risk fields", ...);
test("createPendingConfirmation registers an entry retrievable by key", ...);
test("clearPendingConfirmation removes the entry and cancels its timer", ...);
test("handleWriteButtonInteraction ignores non-write custom IDs", ...);
test("handleWriteButtonInteraction shows expired embed for unknown key", ...);
test("handleWriteButtonInteraction rejects a different user's click", ...);
test("handleWriteButtonInteraction cancel clears the pending entry and shows cancelled", ...);
test("handleWriteButtonInteraction confirm clears the pending entry but never executes", ...);
test("pending confirmation expires and fires onTimeout when not confirmed", ...);
```

### broadcast.js

```js
test("broadcastEnabled returns false when writes disabled", ...);
test("canBroadcast delegations to canWrite", ...);
test("checkBroadcastCooldown allows first request", ...);
test("checkBroadcastCooldown blocks within window", ...);
test("checkBroadcastCooldown allows different users", ...);
test("validateBroadcastMessage accepts valid message", ...);
test("validateBroadcastMessage rejects empty", ...);
test("validateBroadcastMessage rejects control chars", ...);
test("validateBroadcastMessage rejects too long", ...);
test("executeBroadcast full flow with confirmation", ...);
```

## Integration Tests — Bot ↔ Mock Adapter

Create a mock write adapter server that responds to:

```js
const writeServer = createServer((req, res) => {
  // GET /write/capabilities
  // POST /write/preview — returns preview + nonce
  // POST /write/execute — validates nonce + idempotency, returns auditId
});
```

### Test Scenarios

1. **Capabilities discovery:** Bot calls GET capabilities, renders write commands.
2. **Preview flow:** Bot calls POST preview, receives nonce, displays confirmation.
3. **Execute flow:** Bot calls POST execute with valid nonce, receives success.
4. **Nonce expiry:** Nonce older than 60s → adapter returns 400, bot shows "expired."
5. **Idempotency replay:** Same key twice → adapter returns cached result, bot shows "already executed."
6. **Adapter timeout:** Mock adapter sleeps 10s → bot returns "adapter not responding."
7. **Adapter 403:** Mock returns 403 → bot returns "not authorized."
8. **Adapter 500:** Mock returns 500 → bot returns "action failed."

## Security Tests — Abuse Cases

### 1. Compromised Observer

```
GIVEN a user with only observer role
WHEN they attempt a write command
THEN the bot returns "not authorized" (ephemeral)
AND no preview or execute call is made
```

### 2. Confirmation Replay

```
GIVEN a user who confirmed a write action
WHEN they try to reuse the same confirmation nonce
THEN the adapter returns 400 "invalid_nonce"
AND the bot shows "confirmation expired — re-run the command"
```

### 3. Idempotency Duplication

```
GIVEN a successfully executed write with idempotency key K
WHEN the same key K is sent again with different parameters
THEN the adapter returns 409 "idempotency_collision"
AND the bot shows "already executed"
```

### 4. Rate Limit Enforcement

```
GIVEN write rate limit of 10/min per user
WHEN a user sends 11 write commands in one minute
THEN the 11th command returns 429
AND the bot shows "rate limited — wait Ns"
```

### 5. Parameter Injection

```
GIVEN a write command with free-text parameter
WHEN the text contains control characters, SQL fragments, or script tags
THEN validation rejects the input before any adapter call
AND no side effects occur
```

### 6. Broad-Action Exploit

```
GIVEN a write command with scope parameter (e.g., "all services")
WHEN a user attempts to restart "all" services
THEN the adapter requires owner tier AND an allow-list entry
AND the confirmation message includes explicit warning about broad impact
```

### 7. Audit Log Leakage

```
GIVEN any write command that fails or succeeds
WHEN audit events are generated
THEN no Discord bot token, adapter token, Steam IDs, Funcom IDs,
     email addresses, or internal IPs appear in the audit output
```

## End-to-End Tests — Discord Interaction

These require a running bot in a test guild. As of this writing, only the
scaffolded (non-executing) lifecycle below is real; the command group is
`write`, not `admin` (e.g. `/dune write maintenance-note`, gated by
`DUNE_DISCORD_WRITES_ENABLED=true` and a write-admin/write-owner role).

### Scenario: Confirmed-But-Not-Executed Lifecycle (Current, Implemented)

1. User types `/dune write maintenance-note note:"Test note"`.
2. Bot validates `writesEnabled()`/`canWrite(..., tier)`, returns a
   confirmation embed with Confirm/Cancel buttons
   (`writeConfirmation.js::buildConfirmationEmbed()`/`buildConfirmationRow()`).
3. **Assert:** Embed shows action `maintenance:set-note`, tier `admin`, risk `low`.
4. **Assert:** Confirm button has style SUCCESS, Cancel button has style SECONDARY.
5. User clicks Confirm.
6. **Assert:** No adapter call is made (no `writePreview()`/`writeExecute()`).
7. Bot edits the message to show "🛑 Write Not Executed... awaiting upstream
   write-adapter contract implementation."
8. **Assert:** The pending confirmation entry is removed
   (`getPendingConfirmation(idempotencyKey)` returns `undefined`).

### Scenario: Confirmation Cancel (Current, Implemented)

1. User types write command, sees confirmation.
2. User clicks Cancel.
3. Bot edits message to show "🚫 Cancelled."
4. **Assert:** No adapter calls made.
5. **Assert:** The pending confirmation entry is removed.

### Scenario: Confirmation Timeout (Current, Implemented With a Known Gap)

1. User types write command, sees confirmation.
2. User waits past `DUNE_WRITE_CONFIRMATION_TIMEOUT_MS` (60s by default).
3. **Assert:** The pending confirmation entry is removed and a
   `writeTimeoutAuditEvent()` object is produced.
4. **Known gap:** the original Discord message is **not** edited on timeout
   — the buttons remain visually clickable. Clicking either button after
   expiry correctly resolves to "Confirmation Expired" since the entry is
   already gone server-side, so no unsafe action can result, but the UI does
   not proactively show "cancelled (timeout)" as originally specified. See
   `docs/rw-confirmation-flow.md` for detail.

### Forward-Looking Scenario: Full Write Lifecycle With Real Execution (Not Implemented)

Once a real upstream write-adapter contract exists and `writePreview()`/
`writeExecute()` are wired into the confirm path:

1. User types `/dune write maintenance-note note:"Test note"`.
2. Bot validates authorization, returns confirmation embed with buttons.
3. User clicks Confirm.
4. Bot calls adapter preview, receives nonce.
5. Bot calls adapter execute, receives audit ID.
6. Bot edits ephemeral message to show "✅ Maintenance note set."
7. **Assert:** Audit event recorded with success status and persisted somewhere
   durable (today's `writeAuditEvent()` only constructs an object; add a
   persistence sink before relying on this assertion).

## Regression Test Checklist

Before each release candidate, run:

- [ ] All unit tests pass (135+ tests)
- [ ] All write-specific unit tests pass
- [ ] Mock adapter integration tests pass
- [ ] Abuse case tests pass (7 scenarios)
- [ ] `npm run security:api` passes (11 DAST tests)
- [ ] `npm run security:check` passes (6 gates)
- [ ] Semgrep, Gitleaks, Trivy, npm audit, ggshield pass
- [ ] Manual E2E test: confirmation flow in test guild
- [ ] Manual E2E test: rate limit enforcement
- [ ] Manual E2E test: idempotency replay

## Sources

- [Write Architecture](rw-architecture.md)
- [Command Reference](rw-command-reference.md)
- [Confirmation Flow](rw-confirmation-flow.md)
- [Adapter Contract](rw-adapter-contract.md)
- [API Security Testing](api-security-testing.md)
- [PR Transparency Template](pr-transparency-template.md)
