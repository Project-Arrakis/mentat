# Write Testing Strategy

Every write-capable command must pass tests at four layers before merge:
unit → integration → security → end-to-end.

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

### writeCommands.js

```js
test("activeWriteCommands returns empty when disabled", ...);
test("activeWriteCommands returns all 12 when enabled", ...);
test("executeWriteCommand rejects when writes disabled", ...);
test("executeWriteCommand rejects unauthorized user", ...);
test("executeWriteCommand enforces tier separation", ...);
test("executeWriteCommand generates idempotency key", ...);
test("executeWriteCommand returns confirmation prompt", ...);
test("executeWriteCommand blocks duplicate idempotency key", ...);
test("executeWriteCommand validates parameters", ...);
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

These require a running bot in a test guild with a mock adapter.

### Scenario: Full Write Lifecycle

1. User types `/dune admin set-maintenance-note note:"Test note"`
2. Bot validates authorization, returns confirmation embed with buttons.
3. **Assert:** Embed shows action "Set Maintenance Note", target "Test note", risk "Low."
4. **Assert:** Confirm button has style SUCCESS, Cancel button has style SECONDARY.
5. User clicks Confirm.
6. Bot calls adapter preview, receives nonce.
7. Bot calls adapter execute, receives audit ID.
8. Bot edits ephemeral message to show "✅ Maintenance note set."
9. **Assert:** Audit event recorded with success status.

### Scenario: Confirmation Cancel

1. User types write command, sees confirmation.
2. User clicks Cancel.
3. Bot edits message to show "cancelled."
4. **Assert:** No adapter calls made.
5. **Assert:** Audit event recorded with cancelled status.

### Scenario: Confirmation Timeout

1. User types write command, sees confirmation.
2. User waits 65 seconds.
3. Bot disables buttons.
4. **Assert:** Message shows "cancelled (timeout)."
5. **Assert:** Audit event recorded with timeout status.

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
