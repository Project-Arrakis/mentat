# RO + RBAC Audit — Upstream Adapter Findings

## Summary

An upstream maintainer flagged three concerns on the Discord adapter PRs. A full
codebase audit was conducted across both the bot (`dune-awakening-selfhost-discordbot`)
and the core adapter (`dune-awakening-selfhost-docker`). Below are the findings
and exact resolution steps.

---

## Bot-side: Verified RO + RBAC

Every bot command is read-only and role-bound:

| Gate | Location | Enforced? |
|------|----------|:----------:|
| RBAC (`isCommandAllowed`) | `src/commands.js:115-118` | Yes — all commands |
| Write enabled gate (`writesEnabled`) | `src/broadcast.js:42` / `src/writeHandler.js:49` | Yes — broadcast + write |
| Write role gate (`canWrite`) | `src/broadcast.js:46` / `src/writeHandler.js:56` | Yes — broadcast + write |
| Confirmation requirement | `src/broadcast.js:66-70` / `src/writeHandler.js:61-63` | Yes — all writes |
| Write group conditional registration | `src/commands.js:104-108` | Yes — only when `DUNE_DISCORD_WRITES_ENABLED=true` |

**Test coverage**: 153/153 tests pass. All write paths are guarded by
at least `isCommandAllowed` + `writesEnabled` + `canWrite` + confirmation.

### Bot fixes applied in this audit

1. **Write subcommand group** now conditionally registered — not visible in
   Discord unless `DUNE_DISCORD_WRITES_ENABLED=true` (`src/commands.js:104-108`)
2. **8 new writeHandler tests** (`test/writeHandler.test.js`): verifies
   disabled state, unauthorized rejection, confirmation for each of 12 commands,
   and "never calls adapter" guarantee
3. **5 new writes tests** (`test/writes.test.js`): `canWrite` with admin/owner/
   no-role paths, `writeAuditEvent` structure + failed result
4. **3 new command integration tests** (`test/commands.test.js`): broadcast
   disabled-by-default, broadcast RBAC rejection, infra RBAC fallback

---

## Core Adapter Findings

### Finding 1: Broadcast executes live command without authorization

**Affected PR**: #71 (branch `feature/broadcast-rabbitmq`)
**File**: `console/api/src/integrations/discord/routes.js:128-132`

```js
// Current (unsafe):
if (path === DISCORD_ADAPTER_ROUTES.BROADCAST && req.method === "POST") {
  const body = await readJson(req);
  const result = await broadcastProvider(config, { message: body.message });
  return json(res, 200, result);
}
```

**Problem**: `broadcastProvider` executes `dune admin broadcast-restart-warning`, a
live in-game command, with only bot-token authentication. The actor
(`body.actor`) is never validated. No write-gate check. No capability check.

**Fix required**:

```js
if (path === DISCORD_ADAPTER_ROUTES.BROADCAST && req.method === "POST") {
  requireDiscordWriteEnabled(config);                             // 1. gate writes
  const body = await readJson(req);
  validateDiscordActor(body.actor);                               // 2. validate actor
  requireDiscordCapability(body.actor, "broadcast:send");         // 3. check capability
  const result = await broadcastProvider(config, { message: body.message });
  return json(res, 200, result);
}
```

Additionally, add to `policy.js`:
```js
export const DISCORD_CAPABILITIES = new Set([
  // ... existing ...
  "broadcast:send",  // NEW
]);
```

And add a `requireDiscordWriteEnabled(config)` function to `adapter.js`:
```js
export function requireDiscordWriteEnabled(config) {
  if (!discordWritesEnabled(config)) {
    throw policyError("writes_disabled", "Write operations are not enabled.", 403);
  }
}
```

### Finding 2: Infra routes execute without actor validation

**Affected PR**: #69 (branch `feature/secure-infra-adapter-routes`)
**File**: `console/api/src/integrations/discord/routes.js:21-35, 185-196`

```js
// Current (unsafe):
async function handleSecureInfraRoute({ key, config, json, res }) {
  const op = INFRA_OPERATIONS[key];
  const result = await runDune(config, buildDuneArgs(op.operation), { ... });
  return json(res, 200, { ... });
}

// Called without actor:
if (path === DISCORD_ADAPTER_ROUTES.SERVERS && req.method === "POST") {
  const body = await readJson(req);            // actor ignored
  return handleSecureInfraRoute({ key: "SERVERS", config, json, res });
}
```

**Problem**: SERVERS, PORTS, DB routes execute `dune` commands (`dune servers`,
`dune ports`, `dune db status`) after only bot-token auth. The actor from
`body.actor` is read but never passed to `handleSecureInfraRoute` for validation.

**Fix required**:

```js
async function handleSecureInfraRoute({ key, config, json, res, actor }) {
  const op = INFRA_OPERATIONS[key];
  requireDiscordCapability(actor, op.capability);                 // 1. check capability
  const result = await runDune(config, buildDuneArgs(op.operation), { ... });
  return json(res, 200, { ... });
}

// Pass actor through:
if (path === DISCORD_ADAPTER_ROUTES.SERVERS && req.method === "POST") {
  const body = await readJson(req);
  validateDiscordActor(body.actor);                               // 2. validate actor
  return handleSecureInfraRoute({
    key: "SERVERS", config, json, res, actor: body.actor
  });
}
```

### Finding 3: /version hardcodes /repo/VERSION

**Affected PR**: #69 (branch `feature/secure-infra-adapter-routes`)
**File**: `console/api/src/integrations/discord/routes.js:198-199`

```js
// Current (hardcoded):
if (path === DISCORD_ADAPTER_ROUTES.VERSION && req.method === "GET") {
  return json(res, 200, { ok: true, version: readFileSync("/repo/VERSION", "utf8").trim() });
}
```

**Problem**: Hardcodes `/repo/VERSION` instead of using `config.repoRoot`.
The `config.js` file already exports `readConsoleVersion(repoRoot)` which
correctly does `resolve(repoRoot, "VERSION")`.

**Fix required**:

```js
if (path === DISCORD_ADAPTER_ROUTES.VERSION && req.method === "GET") {
  const version = readConsoleVersion(config.repoRoot);
  return json(res, 200, { ok: true, version });
}
```

This is used alongside the existing `readConsoleVersion` import from:
`console/api/src/config.js:135-141`

### Finding 4: OPS routes echo actor without validation

**Affected PR**: #63 (merged, on main)
**File**: `console/api/src/integrations/discord/routes.js:115-124`

The 9 OPS routes read `body.actor` but only echo `body.actor.userId` back
without calling `validateDiscordActor()` or `requireDiscordCapability()`.
This is lower-severity since OPS routes are currently stubs, but the actor
should be validated before any future implementation.

**Fix required**: Add `validateDiscordActor(body.actor)` to each OPS route handler,
following the SAME pattern as STATUS/READINESS/SERVICES/POPULATION routes.

### Finding 5: Announcements route ignores actor

**Affected PR**: #63 (merged, on main)
**File**: `console/api/src/integrations/discord/routes.js:153-162`

The announcements route reads `body` but never validates the actor. Same
pattern fix as OPS routes.

---

## Resolution Checklist

| # | Finding | PR | Severity | Status |
|---|---------|:-----:|:----------:|:------:|
| 1 | Broadcast executes without auth | #71 | Critical | Needs fix |
| 2 | Infra routes no actor validation | #69 | Critical | Needs fix |
| 3 | /version hardcoded path | #69 | Medium | Needs fix |
| 4 | OPS routes no actor validation | #63 | Low | Needs fix |
| 5 | Announcements no actor validation | #63 | Low | Needs fix |
| — | Bot-side RO/RBAC verification | — | — | Verified OK |

---

## Test Evidence (Bot Side)

```
npm test → 153/153 pass
```

New tests added for this audit:

| Test file | Tests | What it proves |
|-----------|:-----:|----------------|
| `test/writeHandler.test.js` | 8 | All 12 write commands return `disabled:true` by default, require write roles, confirm before execution, and never call adapter |
| `test/writes.test.js` | +5 | `canWrite` returns false without matching roles; `writeAuditEvent` records actor/action/idempotency |
| `test/commands.test.js` | +3 | `admin:broadcast` returns disabled; RBAC blocks unauthorized broadcast; `infra:version` passes actor to adapter through RBAC fallback |
