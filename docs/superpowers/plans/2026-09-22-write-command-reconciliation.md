# Write Command Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire mentat's Discord commands to Core's real write bridge (25 existing actions + 3 new ones), replacing the permanent "awaiting upstream contract" stub with real `write/preview` → confirm → `write/execute` calls, and add a bot self-update command that reuses the existing git-push deploy pipeline's safety guardrails.

**Architecture:** One generic, table-driven command engine (not 27 bespoke handlers): a single write-action table drives both Discord command registration (`commands.js`) and dispatch (`writeHandler.js`), a single confirmation-flow module (`writeConfirmation.js`) calls Core's real `adapterClient.writePreview()`/`writeExecute()` and builds the confirm button from Core's real response, and one error-mapping table turns every one of Core's real error codes into a specific Discord message. Bot self-update is architecturally separate — no Core call, a detached local script reusing the existing deploy pipeline's test-gated safety logic.

**Tech Stack:** Node.js, discord.js (`SlashCommandBuilder`, `ButtonBuilder`), `node:test`, bats (for shell script tests), Core's `dune-awakening-selfhost-docker` write bridge (external HTTP dependency via `adapterClient`).

**Spec:** `docs/design/write-command-reconciliation-l1-design-2026-09-22.md`

## Global Constraints

- Discord slash commands allow exactly two levels of nesting (command → subcommand group → subcommand). The new command groups (`player`, `base`, `server`, `map`, `carepackage`, `guild`, `bot`) are each their own **top-level subcommand group** under `/dune` (e.g. `/dune player kick`), siblings to the existing `core`/`infra`/`write` groups — never nested under `write`. The `/dune` command's subcommand-group count goes from 9 to 16, still under Discord's 25-group ceiling (verified against the existing code comment documenting this ceiling).
- The existing `write` group (12 old entries) and its hand-maintained, separately-defined `commands.js` builder are **left untouched** — none of the 8 deferred actions or the removed `operations:restart-service`/`cache` entries are touched by this plan.
- Every new group's Discord command definition is generated **mechanically from one shared table** (`writeActions.js`, new file) — never hand-duplicated a second time in `commands.js`, avoiding the exact drift risk the existing `write` group already has (its `WRITE_COMMANDS` array and its `commands.js` builder are two independently-hand-maintained copies of the same 12 commands today).
- Owner-tier and admin-tier checks reuse `canWrite()` from `writes.js` exactly as today — no new authorization mechanism.
- No new dependency on Core's write bridge beyond what `adapterClient.writePreview()`/`writeExecute()` already expose. `AdapterHttpError` (`src/adapterClient.js`) is the real, existing shape every error-mapping test asserts against: `{ status, route, body: { ok: false, code, error } }`.
- `child_process.spawn` calls in the self-update path always use an argument array, never a template-interpolated shell string, even though the self-update command takes no user-controlled parameters today.

---

### Task 1: Core — add `backup.create` and `updates.*` to `WRITE_ACTION_ROUTES`

**Files:**
- Modify: `console/api/src/integrations/discord/writeActionRoutes.js` (worktree `core-issue215-write-bridge`, branch `issue/215-write-bridge`)
- Modify: `console/api/src/integrations/discord/writeActionMinTier.js`
- Test: `console/api/test/writeActionRoutes.test.js`, `console/api/test/writeActionMinTier.test.js`

**Interfaces:**
- Produces: three new `WRITE_ACTION_ROUTES` keys (`backup.create`, `updates.apply-game`, `updates.fix-steamcmd`), each resolvable via the existing `resolveWriteActionRoute(action, params)` and covered by the existing `selfCheckWriteActionRoutes()`/`checkConfirmPhrasesAgainstRealHandlers()` self-checks with zero code changes to those functions (both already iterate the table generically).

- [ ] **Step 1: Write the failing test**

In `console/api/test/writeActionRoutes.test.js`, add:

```js
test("WRITE_ACTION_ROUTES: backup.create and updates.* resolve to their real Core routes", () => {
  const backup = resolveWriteActionRoute("backup.create", {});
  assert.deepEqual(backup, { method: "POST", path: "/api/backups/create", confirmPhrase: null, policyAction: "backups:create", auditAction: "backup.create", requiresDualConfirmation: false });

  const applyGame = resolveWriteActionRoute("updates.apply-game", {});
  assert.deepEqual(applyGame, { method: "POST", path: "/api/updates/apply-game", confirmPhrase: null, policyAction: "updates:apply", auditAction: "updates.apply-game", requiresDualConfirmation: false });

  const fixSteamcmd = resolveWriteActionRoute("updates.fix-steamcmd", {});
  assert.deepEqual(fixSteamcmd, { method: "POST", path: "/api/updates/fix-steamcmd", confirmPhrase: null, policyAction: "updates:fix", auditAction: "updates.fix-steamcmd", requiresDualConfirmation: false });
});
```

In `console/api/test/writeActionMinTier.test.js`, add:

```js
test("WRITE_ACTION_MIN_TIER: backup.create and updates.* require owner tier", () => {
  assert.equal(meetsMinTier("owner", "backup.create"), true);
  assert.equal(meetsMinTier("admin", "backup.create"), false);
  assert.equal(meetsMinTier("owner", "updates.apply-game"), true);
  assert.equal(meetsMinTier("admin", "updates.apply-game"), false);
  assert.equal(meetsMinTier("owner", "updates.fix-steamcmd"), true);
  assert.equal(meetsMinTier("admin", "updates.fix-steamcmd"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd console/api && node --test test/writeActionRoutes.test.js test/writeActionMinTier.test.js`
Expected: FAIL — `resolveWriteActionRoute("backup.create", ...)` returns `null` (unknown action).

- [ ] **Step 3: Add the three entries**

In `writeActionRoutes.js`, add to `RAW_WRITE_ACTION_ROUTES` (after the `guild.remove` entry, before the closing `};`):

```js
  "backup.create": { method: "POST", path: () => "/api/backups/create", policyAction: "backups:create", auditAction: "backup.create" },
  "updates.apply-game": { method: "POST", path: () => "/api/updates/apply-game", policyAction: "updates:apply", auditAction: "updates.apply-game" },
  "updates.fix-steamcmd": { method: "POST", path: () => "/api/updates/fix-steamcmd", policyAction: "updates:fix", auditAction: "updates.fix-steamcmd" }
```

In `writeActionMinTier.js`, add to `WRITE_ACTION_MIN_TIER` (matching the existing table's shape):

```js
  "backup.create": "owner",
  "updates.apply-game": "owner",
  "updates.fix-steamcmd": "owner",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd console/api && node --test test/writeActionRoutes.test.js test/writeActionMinTier.test.js`
Expected: PASS. Also run `node --test test/writeActionRoutes.test.js -- --test-name-pattern="selfCheck"` to confirm the boot self-check still reports zero problems against the real `actions.js` IAM table (it already resolved `backups:create`/`updates:apply`/`updates:fix` as real actions earlier this session — this just confirms the new table entries agree).

- [ ] **Step 5: Run the full Core test suite**

Run: `cd console/api && node --test`
Expected: same pass/fail/skip counts as before this change plus 2 new passing tests (no regressions).

- [ ] **Step 6: Commit**

```bash
git add console/api/src/integrations/discord/writeActionRoutes.js console/api/src/integrations/discord/writeActionMinTier.js console/api/test/writeActionRoutes.test.js console/api/test/writeActionMinTier.test.js
git commit -m "feat(discord): add backup.create and updates.* to the write bridge

Backs mentat's operations:create-backup/trigger-update commands.
Owner tier, no confirmation phrase (matches server.restart/stop/start's
existing precedent -- these routes use task(), which has no
confirmation-phrase mechanism)."
```

Push to the existing `issue/215-write-bridge` branch (PR #1026 is still draft): `git push origin issue/215-write-bridge`.

---

### Task 2: mentat — unblock `write-execute`/`write-preview` in `adapterClient.js`

**Files:**
- Modify: `src/adapterClient.js`
- Test: existing adapter-client route tests (find via `grep -rl "MISSING_ROUTES" test/`)

**Interfaces:**
- Consumes: none new.
- Produces: `isRouteMissing("write-execute")` and `isRouteMissing("write-preview")` now return `false`; `AdapterClient#writePreview`/`#writeExecute` (already defined, lines 292-293) become genuinely callable.

- [ ] **Step 1: Write the failing test**

Find the existing test asserting `MISSING_ROUTES` contents (`grep -rn "write-execute" test/*.js`) and add:

```js
test("write-execute and write-preview are no longer MISSING_ROUTES", () => {
  assert.equal(isRouteMissing("write-execute"), false);
  assert.equal(isRouteMissing("write-preview"), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/adapterClient*.test.js` (match the real existing test file name)
Expected: FAIL — both currently return `true`.

- [ ] **Step 3: Remove the two entries from `MISSING_ROUTES`**

In `src/adapterClient.js`, find:

```js
export const MISSING_ROUTES = new Set([
  "write-execute", "write-preview",
```

Remove `"write-execute", "write-preview",` from this set (keep whatever else is in it). Add a comment immediately above the `MISSING_ROUTES` declaration:

```js
// write-execute/write-preview removed 2026-09-22 (operator decision, see
// docs/design/write-command-reconciliation-l1-design-2026-09-22.md): these
// routes are real once dune-awakening-selfhost-docker#1026 merges. Gating
// on DUNE_DISCORD_WRITES_ENABLED (writesEnabled(), writes.js) is the real
// kill switch for this feature going forward, not a version-compatibility
// flag -- this operator runs Core and the bot together, not against an
// arbitrary public Core release that may predate these routes.
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/adapterClient*.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full mentat test suite**

Run: `npm test`
Expected: no regressions (check for any OTHER test asserting the old `MISSING_ROUTES` contents by name — fix any that explicitly listed `write-execute`/`write-preview` as expected-missing).

- [ ] **Step 6: Commit**

```bash
git add src/adapterClient.js test/adapterClient*.test.js
git commit -m "feat(write): unblock write-execute/write-preview now that Core's routes are real"
```

---

### Task 3: mentat — the write-action table (`src/writeActions.js`, new file)

This is the single source of truth Task 4 (dispatch) and Task 8 (Discord registration) both read from — the mechanical-generation principle from the Global Constraints section.

**Files:**
- Create: `src/writeActions.js`
- Test: `test/writeActions.test.js`

**Interfaces:**
- Produces: `export const WRITE_ACTIONS` (array, one entry per real Core action + `bot.self-update`), each shaped `{ group, name, action, tier, confirmPhrase, params, desc }` where `params` is `[{ name, type, desc, required, maxLength?, minValue?, maxValue? }]` (same shape `WRITE_COMMANDS` already uses, so `writeHandler.js`'s existing per-param validation logic, if any, is reusable). `group` is the real Discord top-level subcommand-group name (`player`, `base`, `server`, `map`, `carepackage`, `guild`, `bot`) — never `"write"`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { WRITE_ACTIONS } from "../src/writeActions.js";

test("WRITE_ACTIONS: exactly 27 entries (25 Core actions + self-update), no duplicate names within a group", () => {
  assert.equal(WRITE_ACTIONS.length, 27);
  const seen = new Set();
  for (const entry of WRITE_ACTIONS) {
    const key = `${entry.group}:${entry.name}`;
    assert.ok(!seen.has(key), `duplicate command: ${key}`);
    seen.add(key);
  }
});

test("WRITE_ACTIONS: every entry has a real Core action name or is bot.self-update", () => {
  const coreActions = WRITE_ACTIONS.filter((e) => e.action !== "bot.self-update").map((e) => e.action);
  const expected = [
    "player.kick", "player.ban", "player.unban", "player.warn", "player.give-item", "player.clear-backpack", "player.fill-water",
    "base.refill-generators", "base.refill-water",
    "server.restart", "server.stop", "server.start", "server.restart-service",
    "map.spawn", "map.despawn", "map.respawn", "map.teleport",
    "carepackage.grant", "carepackage.grant-all", "carepackage.enable", "carepackage.disable", "carepackage.scan", "carepackage.history-clear",
    "guild.add", "guild.remove",
    "backup.create", "updates.apply-game", "updates.fix-steamcmd"
  ];
  assert.deepEqual([...coreActions].sort(), [...expected].sort());
});

test("WRITE_ACTIONS: server.stop is the only entry requiring dual confirmation", () => {
  const dualConfirm = WRITE_ACTIONS.filter((e) => e.requiresDualConfirmation === true);
  assert.equal(dualConfirm.length, 1);
  assert.equal(dualConfirm[0].action, "server.stop");
});

test("WRITE_ACTIONS: bot.self-update has no confirmPhrase and is owner tier, group bot", () => {
  const entry = WRITE_ACTIONS.find((e) => e.action === "bot.self-update");
  assert.ok(entry);
  assert.equal(entry.group, "bot");
  assert.equal(entry.tier, "owner");
  assert.equal(entry.confirmPhrase, null);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/writeActions.test.js`
Expected: FAIL — `src/writeActions.js` does not exist (`Cannot find module`).

- [ ] **Step 3: Write the table**

Create `src/writeActions.js`:

```js
// Single source of truth for mentat's real write commands -- both Discord
// command registration (commands.js) and dispatch (writeHandler.js) read
// from this table, so the two can never drift the way the old WRITE_COMMANDS
// array and its separate, hand-duplicated commands.js builder already have
// (docs/design/write-command-reconciliation-l1-design-2026-09-22.md).
//
// `action` is Core's real WRITE_ACTION_ROUTES key for every entry except
// "bot.self-update", which never calls Core at all (see writeSelfUpdate.js).
// `group` is the real Discord top-level subcommand-group name -- Discord
// only allows two levels of nesting (command -> group -> subcommand), so
// each of these is its own sibling group under /dune, never nested under
// the existing "write" group.
export const WRITE_ACTIONS = Object.freeze([
  // --- player ---
  { group: "player", name: "kick", action: "player.kick", tier: "admin", confirmPhrase: null,
    desc: "Kick a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID (Funcom-style, e.g. Server#4242)", required: true },
      { name: "reason", type: "string", desc: "Reason for the kick", required: false, maxLength: 200 }] },
  { group: "player", name: "ban", action: "player.ban", tier: "admin", confirmPhrase: "BAN PLAYER",
    desc: "Ban a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "reason", type: "string", desc: "Reason for the ban", required: false, maxLength: 200 }] },
  { group: "player", name: "unban", action: "player.unban", tier: "admin", confirmPhrase: null,
    desc: "Unban a player.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },
  { group: "player", name: "warn", action: "player.warn", tier: "moderator", confirmPhrase: null,
    desc: "Broadcast a warning message to everyone on a map (not a DM).", params: [
      { name: "message", type: "string", desc: "Message text", required: true, maxLength: 500 },
      { name: "mapName", type: "string", desc: "Map name", required: false },
      { name: "dimension", type: "integer", desc: "Dimension", required: false }] },
  { group: "player", name: "give-item", action: "player.give-item", tier: "owner", confirmPhrase: null,
    desc: "Give an item to a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "itemName", type: "string", desc: "Item name (catalog lookup)", required: true },
      { name: "quantity", type: "integer", desc: "Quantity", required: false, minValue: 1 }] },
  { group: "player", name: "clear-backpack", action: "player.clear-backpack", tier: "owner", confirmPhrase: "CLEAN INVENTORY",
    desc: "Clear a player's backpack.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },
  { group: "player", name: "fill-water", action: "player.fill-water", tier: "admin", confirmPhrase: null,
    desc: "Refill a player's water.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },

  // --- base ---
  { group: "base", name: "refill-generators", action: "base.refill-generators", tier: "admin", confirmPhrase: null,
    desc: "Refill a base's generators.", params: [{ name: "baseId", type: "integer", desc: "Base ID", required: true }] },
  { group: "base", name: "refill-water", action: "base.refill-water", tier: "admin", confirmPhrase: null,
    desc: "Refill a base's water.", params: [{ name: "baseId", type: "integer", desc: "Base ID", required: true }] },

  // --- server ---
  { group: "server", name: "restart", action: "server.restart", tier: "owner", confirmPhrase: null,
    desc: "Restart the game server.", params: [] },
  { group: "server", name: "stop", action: "server.stop", tier: "owner", confirmPhrase: null, requiresDualConfirmation: true,
    desc: "Stop the game server. Requires a second, different owner-tier admin to confirm.", params: [] },
  { group: "server", name: "start", action: "server.start", tier: "admin", confirmPhrase: null,
    desc: "Start the game server.", params: [] },
  { group: "server", name: "restart-service", action: "server.restart-service", tier: "admin", confirmPhrase: null,
    desc: "Restart a specific game service.", params: [
      { name: "service", type: "string", desc: "Service name (gateway/survival-1/overmap)", required: true }] },

  // --- map ---
  { group: "map", name: "spawn", action: "map.spawn", tier: "admin", confirmPhrase: "SPAWN MAP",
    desc: "Spawn a map.", params: [
      { name: "mapName", type: "string", desc: "Map name", required: true },
      { name: "preset", type: "string", desc: "Preset name", required: false }] },
  { group: "map", name: "despawn", action: "map.despawn", tier: "admin", confirmPhrase: "DESPAWN MAP",
    desc: "Despawn a map.", params: [{ name: "mapName", type: "string", desc: "Map name", required: true }] },
  { group: "map", name: "respawn", action: "map.respawn", tier: "admin", confirmPhrase: "RESTART MAP",
    desc: "Respawn (restart) a map.", params: [{ name: "mapName", type: "string", desc: "Map name", required: true }] },
  { group: "map", name: "teleport", action: "map.teleport", tier: "admin", confirmPhrase: null,
    desc: "Teleport a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "x", type: "number", desc: "X coordinate", required: true },
      { name: "y", type: "number", desc: "Y coordinate", required: true },
      { name: "z", type: "number", desc: "Z coordinate", required: false },
      { name: "yaw", type: "number", desc: "Yaw", required: false }] },

  // --- carepackage ---
  { group: "carepackage", name: "grant", action: "carepackage.grant", tier: "admin", confirmPhrase: "GRANT CARE PACKAGE",
    desc: "Grant a care package to a player.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },
  { group: "carepackage", name: "grant-all", action: "carepackage.grant-all", tier: "owner", confirmPhrase: "GRANT CARE PACKAGE TO ELIGIBLE PLAYERS",
    desc: "Grant care packages to every eligible player.", params: [] },
  { group: "carepackage", name: "enable", action: "carepackage.enable", tier: "admin", confirmPhrase: "ENABLE CARE PACKAGE",
    desc: "Enable the care package system.", params: [] },
  { group: "carepackage", name: "disable", action: "carepackage.disable", tier: "admin", confirmPhrase: "DISABLE CARE PACKAGE",
    desc: "Disable the care package system.", params: [] },
  { group: "carepackage", name: "scan", action: "carepackage.scan", tier: "admin", confirmPhrase: "RUN CARE PACKAGE SCAN",
    desc: "Run a care package eligibility scan.", params: [] },
  { group: "carepackage", name: "history-clear", action: "carepackage.history-clear", tier: "owner", confirmPhrase: "CLEAR GRANT HISTORY",
    desc: "Clear care package grant history.", params: [] },

  // --- guild ---
  { group: "guild", name: "add", action: "guild.add", tier: "admin", confirmPhrase: null,
    desc: "Add a player to a guild.", params: [
      { name: "guildId", type: "string", desc: "Guild ID", required: true },
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "roleId", type: "string", desc: "Guild role ID", required: false }] },
  { group: "guild", name: "remove", action: "guild.remove", tier: "admin", confirmPhrase: null,
    desc: "Remove a player from a guild.", params: [
      { name: "guildId", type: "string", desc: "Guild ID", required: true },
      { name: "playerId", type: "string", desc: "Player ID", required: true }] },

  // --- operations (backed by Task 1's new Core actions) ---
  { group: "operations", name: "create-backup", action: "backup.create", tier: "owner", confirmPhrase: null,
    desc: "Create a database backup.", params: [] },
  { group: "operations", name: "trigger-update", action: null, tier: "owner", confirmPhrase: null,
    desc: "Trigger a game or SteamCMD update.", params: [
      { name: "type", type: "string", desc: "Update type: game or steamcmd", required: true, choices: ["game", "steamcmd"] }],
    // trigger-update's real Core action depends on `type` -- resolved at
    // dispatch time in writeHandler.js, not fixed here (see Task 4).
    resolveAction: (params) => (params.type === "steamcmd" ? "updates.fix-steamcmd" : "updates.apply-game") },

  // --- bot (no Core call at all) ---
  { group: "bot", name: "self-update", action: "bot.self-update", tier: "owner", confirmPhrase: null,
    desc: "Restart the bot on the latest deployed code (replays the deploy pipeline's test-gated safety checks).", params: [] }
]);

export function findWriteAction(group, name) {
  return WRITE_ACTIONS.find((e) => e.group === group && e.name === name) || null;
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `node --test test/writeActions.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/writeActions.js test/writeActions.test.js
git commit -m "feat(write): add the single-source-of-truth write-action table"
```

---

### Task 4: mentat — the real dispatch engine (replace the stub)

**Files:**
- Modify: `src/writeHandler.js`
- Modify: `src/writeConfirmation.js`
- Create: `src/writeErrorMapping.js`
- Test: `test/writeHandler.test.js`, `test/writeErrorMapping.test.js`

**Interfaces:**
- Consumes: `WRITE_ACTIONS`/`findWriteAction` (Task 3), `adapterClient.writePreview(actor, body, guildId)`/`writeExecute(actor, body, guildId)` (existing, `src/adapterClient.js:292-293`), `AdapterHttpError` (existing, `src/adapterClient.js:4`), `canWrite()` (existing, `src/writes.js`).
- Produces: `mapWriteError(error)` (exported from `writeErrorMapping.js`) — takes an `AdapterHttpError` or any thrown error, returns `{ title, description }` for a Discord embed. `handleWriteCommand()`'s return shape changes: replaces `status: "pending-upstream"` with either a real preview response (`{ ok: true, needsConfirmation: true, nonce, expiresAt, confirmationEmbed, confirmationRow }`) or a real error embed on immediate rejection.

- [ ] **Step 1: Write the failing test for error mapping**

Create `test/writeErrorMapping.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { AdapterHttpError } from "../src/adapterClient.js";
import { mapWriteError } from "../src/writeErrorMapping.js";

function coreError(status, code, message) {
  return new AdapterHttpError(`Adapter write-execute returned HTTP ${status}.`, { status, route: "write-execute", body: { ok: false, code, error: message } });
}

test("mapWriteError: maps every real Core write-bridge error code to a specific message", () => {
  const cases = [
    ["writes_disabled", "Write operations are not enabled.", 403, /disabled/i],
    ["not_authorized", "Discord actor is not authorized.", 403, /permission/i],
    ["nonce_not_found", "Confirmation expired or was already used.", 410, /expired/i],
    ["nonce_actor_mismatch", "This confirmation was not issued to you.", 403, /wasn't issued to you|not issued to you/i],
    ["second_confirmation_required", "second confirmation needed", 202, /second/i],
    ["second_confirmation_same_actor", "different admin required", 403, /different administrator/i],
    ["stale_actor_signature", "Your role info expired.", 403, /role info expired|run the command again/i],
    ["write_backend_unavailable", "backend down", 503, /temporarily unavailable/i]
  ];
  for (const [code, message, status, expectedPattern] of cases) {
    const result = mapWriteError(coreError(status, code, message));
    assert.match(result.description, expectedPattern, `code ${code} produced: ${result.description}`);
  }
});

test("mapWriteError: an unrecognized error code falls back to a generic-but-real message, never throws", () => {
  const result = mapWriteError(coreError(400, "totally_unknown_code", "something"));
  assert.ok(result.title);
  assert.ok(result.description);
});

test("mapWriteError: a non-AdapterHttpError (e.g. network failure) is handled without throwing", () => {
  const result = mapWriteError(new Error("fetch failed"));
  assert.ok(result.title);
  assert.ok(result.description);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/writeErrorMapping.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/writeErrorMapping.js`**

```js
// Maps every real error code Core's write/preview and write/execute can
// return (docs/design/write-command-reconciliation-l1-design-2026-09-22.md
// section 3) to a specific Discord message -- never a generic "something
// went wrong" for a code this bot actually knows about.
import { duneEmbed } from "./embedFormat.js";

const MESSAGES = {
  writes_disabled: "Write commands are disabled on this console.",
  not_authorized: "You don't have permission for this action.",
  unknown_write_action: "This command isn't available on the connected Core instance yet.",
  invalid_parameters: null, // uses the real error string from Core, see below
  nonce_not_found: "This confirmation expired. Please run the command again.",
  nonce_actor_mismatch: "This confirmation wasn't issued to you.",
  nonce_action_mismatch: "Internal error: action mismatch. Please run the command again.",
  second_confirmation_same_actor: "A different administrator must provide the second confirmation.",
  stale_actor_signature: "Your role info expired. Please run the command again.",
  invalid_actor_signature: "Your role info could not be verified. Please run the command again.",
  write_backend_unavailable: "The write backend is temporarily unavailable. Try again shortly."
};

export function mapWriteError(error) {
  const code = error?.body?.code;
  const coreMessage = error?.body?.error;
  if (code && Object.hasOwn(MESSAGES, code)) {
    const description = MESSAGES[code] || coreMessage || "Request failed.";
    return { title: "Write Command Failed", description };
  }
  return { title: "Write Command Failed", description: coreMessage || error?.message || "An unexpected error occurred." };
}

export function buildWriteErrorEmbed(error) {
  const { title, description } = mapWriteError(error);
  return duneEmbed({ title: `🛑 ${title}`, color: "error", description });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/writeErrorMapping.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the real dispatch flow**

Create `test/writeHandler.test.js` (or extend the existing one if `writeHandler.test.js` already exists — check first with `ls test/writeHandler*`):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWriteCommand } from "../src/writeHandler.js";

function fakeAdapterClient({ previewResult, previewError, executeResult, executeError } = {}) {
  return {
    async writePreview(actor, body) {
      if (previewError) throw previewError;
      return previewResult;
    },
    async writeExecute(actor, body) {
      if (executeError) throw executeError;
      return executeResult;
    }
  };
}

function fakeOwnerInteraction() {
  return { user: { id: "owner-1" }, member: { roles: new Set() }, guild: { ownerId: "owner-1" } };
}

test("handleWriteCommand: a real preview success returns needsConfirmation with the real Core nonce/expiresAt, not the old stub", async () => {
  const adapterClient = fakeAdapterClient({
    previewResult: { ok: true, nonce: "real-nonce-123", expiresAt: Date.now() + 60000, preview: { action: "player.kick", confirmPhrase: null } }
  });
  const config = { discord: { writes: { enabled: true } } };
  const result = await handleWriteCommand({
    subcommand: "kick", group: "player",
    interaction: { ...fakeOwnerInteraction(), options: { getString: () => "Server#4242" } },
    adapterClient, config
  });
  assert.equal(result.ok, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.nonce, "real-nonce-123");
  assert.ok(!("status" in result) || result.status !== "pending-upstream", "must not return the old stub status");
});

test("handleWriteCommand: a preview rejection (e.g. not_authorized) returns a real error embed, no confirmation offered", async () => {
  const { AdapterHttpError } = await import("../src/adapterClient.js");
  const adapterClient = fakeAdapterClient({
    previewError: new AdapterHttpError("HTTP 403", { status: 403, route: "write-preview", body: { ok: false, code: "not_authorized", error: "nope" } })
  });
  const config = { discord: { writes: { enabled: true } } };
  const result = await handleWriteCommand({
    subcommand: "kick", group: "player",
    interaction: { ...fakeOwnerInteraction(), options: { getString: () => "Server#4242" } },
    adapterClient, config
  });
  assert.equal(result.ok, false);
  assert.ok(!result.needsConfirmation);
  assert.match(result.error, /permission/i);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `node --test test/writeHandler.test.js`
Expected: FAIL — `handleWriteCommand` still returns the old stub shape and never calls `adapterClient.writePreview`.

- [ ] **Step 7: Rewrite `handleWriteCommand` to call Core for real**

Replace `src/writeHandler.js`'s body (keep the file's existing `import`s for `writesEnabled`/`canWrite`, add new ones):

```js
import { randomUUID } from "node:crypto";
import { writesEnabled, canWrite } from "./writes.js";
import { findWriteAction, WRITE_ACTIONS } from "./writeActions.js";
import { mapWriteError } from "./writeErrorMapping.js";
import { buildConfirmationEmbed, buildConfirmationRow, registerRealPendingConfirmation, confirmationTimeoutMs } from "./writeConfirmation.js";

export { WRITE_ACTIONS };

function collectParams(def, interaction) {
  const params = {};
  for (const p of def.params) {
    if (p.type === "integer") params[p.name] = interaction.options.getInteger(p.name);
    else if (p.type === "number") params[p.name] = interaction.options.getNumber(p.name);
    else params[p.name] = interaction.options.getString(p.name);
  }
  return params;
}

export async function handleWriteCommand({ group, subcommand, interaction, adapterClient, config, guildId = null, db = null }) {
  if (!writesEnabled(config)) {
    return { ok: false, error: "Write commands are disabled. Set DUNE_DISCORD_WRITES_ENABLED=true.", disabled: true };
  }

  const def = findWriteAction(group, subcommand);
  if (!def) return { ok: false, error: `Unknown write command: ${group} ${subcommand}` };

  if (!canWrite(interaction, config, def.tier, db, guildId)) {
    const requiresOwner = def.tier === "owner";
    return {
      ok: false,
      error: requiresOwner
        ? "Not authorized for write operations. This action requires owner-tier access, which belongs only to this Discord server's real owner."
        : "Not authorized for write operations. Requires admin-tier access (a mapped Admin role, or the real Discord server owner)."
    };
  }

  const params = collectParams(def, interaction);
  const action = def.resolveAction ? def.resolveAction(params) : def.action;

  // bot.self-update never touches Core at all -- handled entirely in
  // writeSelfUpdate.js (Task 6), routed here before any adapterClient call.
  // Uses a random UUID key, never a colon-delimited string: the confirm
  // button's customId is itself colon-delimited ("write:confirm:<key>"),
  // and handleWriteButtonInteraction's `[, action, idempotencyKey] = parts`
  // destructuring would silently truncate a key containing its own colons.
  if (action === "bot.self-update") {
    const key = randomUUID();
    const expiresAt = Date.now() + confirmationTimeoutMs();
    registerRealPendingConfirmation({ nonce: key, action, tier: def.tier, userId: interaction.user.id, expiresAt });
    return { ok: true, needsConfirmation: true, action, tier: def.tier, isSelfUpdate: true,
      confirmationEmbed: buildConfirmationEmbed({ action, tier: def.tier, risk: "high" }),
      confirmationRow: buildConfirmationRow(key) };
  }

  const actor = { userId: interaction.user?.id, username: interaction.user?.username, guildOwnerId: interaction.guild?.ownerId };

  let preview;
  try {
    preview = await adapterClient.writePreview(actor, { action, params }, guildId);
  } catch (error) {
    const { description } = mapWriteError(error);
    return { ok: false, error: description };
  }

  const nonce = preview.nonce;
  const expiresAt = preview.expiresAt;
  registerRealPendingConfirmation({ nonce, action, tier: def.tier, userId: interaction.user.id, expiresAt, confirmPhrase: preview.preview?.confirmPhrase });

  return {
    ok: true,
    needsConfirmation: true,
    action,
    tier: def.tier,
    nonce,
    expiresAt,
    confirmationEmbed: buildConfirmationEmbed({ action, tier: def.tier, risk: def.tier === "owner" ? "high" : "medium", expiresAt }),
    confirmationRow: buildConfirmationRow(nonce)
  };
}
```

- [ ] **Step 8: Add `registerRealPendingConfirmation` to `writeConfirmation.js`**

In `src/writeConfirmation.js`, add alongside the existing `createPendingConfirmation`/`pendingConfirmations` map (reuse the SAME map — a real Core nonce is just as good a key as the old `idempotencyKey` was):

```js
// Real-flow variant of createPendingConfirmation (issue: write command
// reconciliation): the confirmation is already registered server-side by
// Core (the nonce itself IS the server-side confirmation record) -- this
// only tracks what the BOT needs locally to route the eventual button
// click back to the right action/tier/actor, keyed by Core's real nonce
// instead of a bot-generated idempotencyKey.
export function registerRealPendingConfirmation({ nonce, action, tier, userId, expiresAt, confirmPhrase }) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("registerRealPendingConfirmation: userId is required.");
  }
  pendingConfirmations.set(nonce, { action, tier, userId, expiresAt, confirmPhrase, isReal: true });
  return nonce;
}
```

- [ ] **Step 9: Run to verify tests pass**

Run: `node --test test/writeHandler.test.js test/writeErrorMapping.test.js`
Expected: PASS.

- [ ] **Step 10: Run the full mentat suite**

Run: `npm test`
Expected: existing `writeConfirmation`/`writeHandler`/`writes` tests that referenced the OLD stub behavior (`buildScaffoldedEmbed`, `status: "pending-upstream"`) will now fail — fix each to assert the new real behavior instead (do not delete coverage, update it; if a test asserted "confirming always shows the scaffolded embed," change it to assert the button click now calls `adapterClient.writeExecute` — see Task 5).

- [ ] **Step 11: Commit**

```bash
git add src/writeHandler.js src/writeConfirmation.js src/writeErrorMapping.js test/writeHandler.test.js test/writeErrorMapping.test.js test/writeConfirmation.test.js
git commit -m "feat(write): replace the permanent stub with real write/preview calls and error mapping"
```

---

### Task 5: mentat — wire the confirm button to `write/execute`, including `server.stop`'s dual-confirmation state

**Files:**
- Modify: `src/writeConfirmation.js`
- Test: `test/writeConfirmation.test.js`

**Interfaces:**
- Consumes: `registerRealPendingConfirmation` (Task 4), `adapterClient.writeExecute` (existing), `mapWriteError` (Task 4).
- Produces: `handleWriteButtonInteraction(interaction, adapterClient)` — signature changes to accept `adapterClient` (needed to call `writeExecute`); every caller (`grep -rn "handleWriteButtonInteraction" src/`) is updated to pass it.

- [ ] **Step 1: Write the failing tests**

Add to `test/writeConfirmation.test.js`:

```js
test("handleWriteButtonInteraction: confirm calls adapterClient.writeExecute with the real nonce and shows success", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n1", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000 });
  let executeCalledWith = null;
  const adapterClient = { writeExecute: async (actor, body) => { executeCalledWith = { actor, body }; return { ok: true }; } };
  const updates = [];
  const interaction = {
    isButton: () => true, customId: "write:confirm:n1",
    user: { id: "u1" },
    update: async (payload) => updates.push(payload)
  };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient);
  assert.equal(handled, true);
  assert.equal(executeCalledWith.body.nonce, "n1");
  assert.equal(executeCalledWith.body.action, "player.kick");
  assert.equal(updates.length, 1);
});

test("handleWriteButtonInteraction: a 202 second_confirmation_required response shows the waiting state, not success/failure", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n2", action: "server.stop", tier: "owner", userId: "u1", expiresAt: Date.now() + 300000 });
  const adapterClient = { writeExecute: async () => ({ ok: true, code: "second_confirmation_required", nonce: "n2", expiresAt: Date.now() + 300000 }) };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n2", user: { id: "u1" }, update: async (p) => updates.push(p) };
  await handleWriteButtonInteraction(interaction, adapterClient);
  assert.match(JSON.stringify(updates[0]), /second|waiting/i);
});

test("handleWriteButtonInteraction: writeExecute throwing a mapped error shows the specific error, not a generic failure", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n3", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000 });
  const { AdapterHttpError } = await import("../src/adapterClient.js");
  const adapterClient = { writeExecute: async () => { throw new AdapterHttpError("HTTP 410", { status: 410, route: "write-execute", body: { ok: false, code: "nonce_not_found", error: "gone" } }); } };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n3", user: { id: "u1" }, update: async (p) => updates.push(p) };
  await handleWriteButtonInteraction(interaction, adapterClient);
  assert.match(JSON.stringify(updates[0]), /expired/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/writeConfirmation.test.js`
Expected: FAIL — `handleWriteButtonInteraction` still shows `buildScaffoldedEmbed` unconditionally on confirm.

- [ ] **Step 3: Rewrite the confirm branch**

In `src/writeConfirmation.js`, replace the `if (action === "confirm") { ... }` block inside `handleWriteButtonInteraction` (keep the function's existing not-yours/expired/cancel handling above it unchanged) with:

```js
  if (action === "confirm") {
    const isSelfUpdate = entry.action === "bot.self-update";
    clearPendingConfirmation(idempotencyKey);

    if (isSelfUpdate) {
      const { runSelfUpdate } = await import("./writeSelfUpdate.js");
      await interaction.update({ embeds: [duneEmbed({ title: "🔄 Self-Update Starting", color: "warning", description: "Restarting on the latest deployed code. I'll post the result here once it's done." })], components: [] });
      runSelfUpdate({ interactionToken: interaction.token, applicationId: interaction.applicationId, channelId: interaction.channelId });
      return true;
    }

    try {
      const result = await adapterClient.writeExecute(
        { userId: entry.userId },
        { nonce: idempotencyKey, action: entry.action }
      );
      if (result?.code === "second_confirmation_required") {
        registerRealPendingConfirmation({ nonce: idempotencyKey, action: entry.action, tier: entry.tier, userId: entry.userId, expiresAt: result.expiresAt });
        await interaction.update({
          embeds: [duneEmbed({ title: "⏳ Waiting on a Second Administrator", color: "warning", description: "Your confirmation was accepted. A second, different owner-tier admin must now run this command and confirm it too." })],
          components: [buildConfirmationRow(idempotencyKey)]
        });
        return true;
      }
      await interaction.update({
        embeds: [duneEmbed({ title: "✅ Write Executed", color: "success", description: `\`${entry.action}\` completed.` })],
        components: []
      });
    } catch (error) {
      await interaction.update({ embeds: [buildWriteErrorEmbed(error)], components: [] });
    }
    return true;
  }
```

Update the function signature: `export async function handleWriteButtonInteraction(interaction, adapterClient) {`. Add the needed imports at the top of the file: `import { buildWriteErrorEmbed } from "./writeErrorMapping.js";`.

- [ ] **Step 4: Update every caller**

Run: `grep -rn "handleWriteButtonInteraction(" src/` — for each call site (likely in `src/index.js`'s interaction-handling dispatch), pass the already-in-scope `adapterClient` as the second argument.

- [ ] **Step 5: Run to verify tests pass**

Run: `node --test test/writeConfirmation.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full mentat suite**

Run: `npm test`
Expected: no regressions elsewhere (confirm the button-interaction dispatch tests for other command groups, if any share this handler, still pass with the new two-argument signature).

- [ ] **Step 7: Commit**

```bash
git add src/writeConfirmation.js src/index.js test/writeConfirmation.test.js
git commit -m "feat(write): wire the confirm button to real write/execute, including the stop dual-confirmation state"
```

---

### Task 6: mentat — bot self-update (`scripts/lib/deploy-core.sh` extraction + `scripts/self-update.sh` + `src/writeSelfUpdate.js`)

**Files:**
- Create: `scripts/lib/deploy-core.sh`
- Modify: `scripts/deploy-post-receive.sh`
- Create: `scripts/self-update.sh`
- Create: `src/writeSelfUpdate.js`
- Test: `test/deploy-hook.bats` (must stay green, unmodified in intent), new `test/self-update.bats`, `test/writeSelfUpdate.test.js`

**Interfaces:**
- Produces: `deploy_core::sync_test_install_restart(work_dir, service_name)` (bash function, `scripts/lib/deploy-core.sh`) — returns 0 on full success, non-zero (with the specific guardrail's error already echoed) on any failure, and **never restarts the service if it returns non-zero**. `runSelfUpdate({ interactionToken, applicationId, channelId })` (`src/writeSelfUpdate.js`) — spawns `scripts/self-update.sh` detached, returns immediately (does not await completion).

- [ ] **Step 1: Write the failing bats test for the extracted library**

Create `test/self-update.bats` (bats, matching `test/deploy-hook.bats`'s existing style — check that file first for the exact bats setup/helper pattern used):

```bash
#!/usr/bin/env bats

setup() {
  export WORK_DIR="$(mktemp -d)"
  cd "$WORK_DIR"
  git init -q
  git config user.email test@test.com
  git config user.name test
  echo '{"scripts":{"test":"exit 0"}}' > package.json
  git add package.json
  git commit -qm init
  mkdir -p src
  touch src/index.js src/statsPusher.js
  git add src
  git commit -qm "add required files"
  export SERVICE_NAME="fake-test-service.service"
  source "${BATS_TEST_DIRNAME}/../scripts/lib/deploy-core.sh"
}

teardown() {
  rm -rf "$WORK_DIR"
}

@test "deploy_core::sync_test_install_restart returns 0 when tests pass" {
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME" --skip-restart
  [ "$status" -eq 0 ]
}

@test "deploy_core::sync_test_install_restart returns non-zero and never restarts when the test gate fails" {
  echo '{"scripts":{"test":"exit 1"}}' > package.json
  git add package.json
  git commit -qm "break tests"
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME" --skip-restart
  [ "$status" -ne 0 ]
  [[ "$output" == *"aborting"* ]]
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `bats test/self-update.bats`
Expected: FAIL — `scripts/lib/deploy-core.sh` does not exist.

- [ ] **Step 3: Extract the shared library**

Read `scripts/deploy-post-receive.sh` in full first (already read above in this plan's research). Create `scripts/lib/deploy-core.sh` containing a function wrapping the existing script's "Reset to latest / run tests / check required files / npm install / re-register / restart / health check" steps (lines under the `while read` loop, from `# Reset to latest from deploy remote` through the health check), parameterized on `$1` (work dir) and `$2` (service name), with a `--skip-restart` third flag for testability:

```bash
#!/usr/bin/env bash
# Shared deploy logic used by BOTH scripts/deploy-post-receive.sh (the real
# git-push-triggered hook) and scripts/self-update.sh (Discord-triggered,
# see src/writeSelfUpdate.js). Extracted so there is exactly one copy of
# the test-gated safety logic, not two independently-maintainable ones.
deploy_core::sync_test_install_restart() {
  local work_dir="$1"
  local service_name="$2"
  local skip_restart="${3:-}"

  cd "$work_dir" || { echo "ERROR: cannot cd to $work_dir"; return 1; }

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "ERROR: working tree at $work_dir is dirty -- refusing to deploy."
    return 1
  fi

  echo "Running test suite..."
  local test_log
  test_log="$(mktemp)"
  npm test > "$test_log" 2>&1
  local test_exit=$?
  tail -10 "$test_log"
  if [ "$test_exit" -ne 0 ]; then
    echo "ERROR: tests failed (exit code $test_exit) -- aborting deployment."
    rm -f "$test_log"
    return 1
  fi
  if grep -qE "^not ok " "$test_log"; then
    echo "ERROR: tests had failures -- aborting deployment."
    rm -f "$test_log"
    return 1
  fi
  rm -f "$test_log"
  echo "Tests passed."

  for f in src/index.js src/statsPusher.js package.json; do
    if [ ! -f "$work_dir/$f" ]; then
      echo "ERROR: missing required file: $f -- aborting deployment."
      return 1
    fi
  done

  npm install --omit=dev 2>&1 | tail -3

  if [ "$skip_restart" != "--skip-restart" ]; then
    echo "Restarting $service_name..."
    sudo systemctl restart "$service_name" 2>/dev/null || systemctl --user restart "$service_name" 2>/dev/null || true
    sleep 3
    if systemctl is-active "$service_name" 2>/dev/null | grep -q active; then
      echo "Deployment complete -- service is active."
    else
      echo "WARNING: service status unclear -- check manually."
    fi
  fi

  return 0
}
```

- [ ] **Step 4: Run to verify the new test passes**

Run: `bats test/self-update.bats`
Expected: PASS.

- [ ] **Step 5: Refactor `deploy-post-receive.sh` to call the shared function**

Replace the body of the `while read` loop's deploy steps (from `git fetch deploy ...` through the health-check block) with:

```bash
  git fetch deploy "$DEPLOY_BRANCH" 2>&1 || { echo "ERROR: git fetch failed"; exit 1; }
  git reset --hard deploy/"$DEPLOY_BRANCH" 2>&1 || { echo "ERROR: git reset failed"; exit 1; }
  echo "Current: $(git log --oneline -1)"

  source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-core.sh"
  if ! deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"; then
    exit 1
  fi
```

Keep the dirty-tree guard (it's already duplicated intentionally — the hook's own guard runs BEFORE the fetch/reset, the library's runs again defensively before the test suite; both are cheap, keep both), the slash-command re-registration block, and the post-restart security smoke test exactly as they are today — only the block replaced above changes.

- [ ] **Step 6: Run the existing deploy-hook test suite to verify no regression**

Run: `bats test/deploy-hook.bats`
Expected: PASS — same behavior as before the refactor (this is the proof the extraction didn't change the real git-push deploy path).

- [ ] **Step 7: Write `scripts/self-update.sh`**

```bash
#!/usr/bin/env bash
# Discord-triggered replay of the deploy pipeline (see
# docs/design/write-command-reconciliation-l1-design-2026-09-22.md section
# 4a). Invoked by src/writeSelfUpdate.js's runSelfUpdate(), detached from
# the bot process since the restart this triggers kills its parent.
#
# Unlike deploy-post-receive.sh, this does NOT fetch/reset from the deploy
# remote first -- it operates on whatever is already checked out at
# WORK_DIR (this replays the pipeline on demand; it cannot invent new code
# to deploy that isn't already there).
set -u

WORK_DIR="${WORK_DIR:-/home/bot/arrakis-control-panel}"
SERVICE_NAME="${SERVICE_NAME:-acp-bot.service}"
DISCORD_WEBHOOK_URL="${1:-}"

source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-core.sh"

report() {
  local message="$1"
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    curl -sS -X POST -H "Content-Type: application/json" \
      -d "$(printf '{"content":%s}' "$(printf '%s' "$message" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')")" \
      "$DISCORD_WEBHOOK_URL" >/dev/null 2>&1 || true
  fi
}

if deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"; then
  report "✅ Self-update complete. \`$(cd "$WORK_DIR" && git log --oneline -1)\` is now live."
else
  report "🛑 Self-update aborted -- the test gate failed. The bot is still running on its previous code. Check the self-update log on the host for details."
  exit 1
fi
```

- [ ] **Step 8: Write the failing test for `writeSelfUpdate.js`**

Create `test/writeSelfUpdate.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSelfUpdate, __setSpawnImplForTests } from "../src/writeSelfUpdate.js";

test("runSelfUpdate: spawns self-update.sh detached, with an argument array (never a shell string), and does not await it", async () => {
  let capturedCommand = null;
  let capturedArgs = null;
  let capturedOptions = null;
  __setSpawnImplForTests((command, args, options) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return { unref: () => {}, pid: 12345 };
  });

  const result = runSelfUpdate({ interactionToken: "tok", applicationId: "app", channelId: "chan" });

  assert.equal(typeof capturedCommand, "string");
  assert.ok(Array.isArray(capturedArgs), "args must be an array, never a single interpolated string");
  assert.equal(capturedOptions.detached, true);
  assert.equal(capturedOptions.stdio[0], "ignore");
  assert.equal(result.pid, 12345);
});
```

- [ ] **Step 9: Run to verify it fails**

Run: `node --test test/writeSelfUpdate.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 10: Write `src/writeSelfUpdate.js`**

```js
// Discord-side trigger for the bot's own self-update (see
// docs/design/write-command-reconciliation-l1-design-2026-09-22.md section
// 4a). Never a template-interpolated shell string, even though this
// command takes no user-controlled parameters today -- the discipline is
// followed regardless, matching this codebase's own established
// injection-prevention pattern for every other shell-adjacent call.
import { spawn as realSpawn } from "node:child_process";
import { openSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let spawnImpl = realSpawn;
export function __setSpawnImplForTests(fn) { spawnImpl = fn; }
export function __resetSpawnImplForTests() { spawnImpl = realSpawn; }

const __dirname = dirname(fileURLToPath(import.meta.url));

export function runSelfUpdate({ interactionToken, applicationId, channelId }) {
  const scriptPath = join(__dirname, "..", "scripts", "self-update.sh");
  const logPath = join(__dirname, "..", "runtime", `self-update-${Date.now()}.log`);
  const logFd = openSync(logPath, "a");

  const webhookUrl = applicationId && interactionToken
    ? `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`
    : "";

  const child = spawnImpl("bash", [scriptPath, webhookUrl], {
    detached: true,
    stdio: ["ignore", logFd, logFd]
  });
  child.unref?.();
  return { pid: child.pid, logPath };
}
```

- [ ] **Step 11: Run to verify it passes**

Run: `node --test test/writeSelfUpdate.test.js`
Expected: PASS.

- [ ] **Step 12: Add `runtime/` to `.gitignore` if not already covered**

Run: `grep -n "^runtime" .gitignore || echo "runtime/" >> .gitignore`

- [ ] **Step 13: Run the full mentat suite**

Run: `npm test` and `bats test/*.bats`
Expected: no regressions, all new tests pass.

- [ ] **Step 14: Commit**

```bash
git add scripts/lib/deploy-core.sh scripts/deploy-post-receive.sh scripts/self-update.sh src/writeSelfUpdate.js test/self-update.bats test/writeSelfUpdate.test.js .gitignore
git commit -m "feat(write): add bot self-update, reusing the deploy pipeline's test-gated safety logic

Extracts scripts/deploy-post-receive.sh's sync/test/install/restart steps
into scripts/lib/deploy-core.sh, used by both the real git-push deploy
hook (refactored, behavior-unchanged -- test/deploy-hook.bats stays green)
and the new Discord-triggered scripts/self-update.sh. The test gate is
never bypassed: a failing test suite aborts before any restart, same as
today's git-push path."
```

**IMPORTANT — deployment note for whoever runs this in production:** `scripts/deploy-post-receive.sh`'s own header states the *live* copy on the bot VM (`~/acp-deploy.git/hooks/post-receive`) must be updated to match this file whenever it changes (this is a pre-existing, documented drift risk, not new to this task). After this PR merges and deploys, manually verify the live hook was updated — do not assume the next `git push deploy deploy` alone propagates this refactor if the live hook is a copied file rather than a symlink.

---

### Task 7: mentat — Discord command registration for the new groups (mechanical, generated from `WRITE_ACTIONS`)

**Files:**
- Modify: `src/commands.js`
- Test: `test/commands.test.js` (or equivalent existing command-registration test file — find via `grep -rln "buildDuneCommand" test/`)

**Interfaces:**
- Consumes: `WRITE_ACTIONS` (Task 3).
- Produces: `buildDuneCommand()`'s returned `SlashCommandBuilder` gains 7 new top-level `addSubcommandGroup` entries (`player`, `base`, `server`, `map`, `carepackage`, `guild`, `operations`, `bot` — 8, not 7; recount: player/base/server/map/carepackage/guild/operations/bot = 8 new groups), each built mechanically from `WRITE_ACTIONS`, never hand-written per-command.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDuneCommand } from "../src/commands.js";
import { WRITE_ACTIONS } from "../src/writeActions.js";

test("buildDuneCommand: registers a subcommand group for every distinct WRITE_ACTIONS group, with every action as a subcommand", () => {
  const built = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  const groupNames = new Set(WRITE_ACTIONS.map((e) => e.group));
  const registeredGroups = new Map(built.options.filter((o) => o.type === 2).map((g) => [g.name, g]));

  for (const groupName of groupNames) {
    assert.ok(registeredGroups.has(groupName), `missing subcommand group: ${groupName}`);
    const registeredSubcommands = new Set(registeredGroups.get(groupName).options.map((s) => s.name));
    const expectedSubcommands = WRITE_ACTIONS.filter((e) => e.group === groupName).map((e) => e.name);
    for (const name of expectedSubcommands) {
      assert.ok(registeredSubcommands.has(name), `group ${groupName} missing subcommand: ${name}`);
    }
  }
});

test("buildDuneCommand: total subcommand-group count stays under Discord's 25-group ceiling", () => {
  const built = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  const groupCount = built.options.filter((o) => o.type === 2).length;
  assert.ok(groupCount <= 25, `${groupCount} subcommand groups exceeds Discord's limit`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/commands.test.js`
Expected: FAIL — none of the new groups are registered yet.

- [ ] **Step 3: Add a mechanical group-builder helper and call it once per group**

In `src/commands.js`, add near the top (after existing imports):

```js
import { WRITE_ACTIONS } from "./writeActions.js";

function addOptionToSubcommand(subcommandBuilder, param) {
  const setCommon = (opt) => opt.setName(param.name).setDescription(param.desc).setRequired(Boolean(param.required));
  if (param.type === "integer") {
    return subcommandBuilder.addIntegerOption((o) => {
      setCommon(o);
      if (param.minValue !== undefined) o.setMinValue(param.minValue);
      if (param.maxValue !== undefined) o.setMaxValue(param.maxValue);
      return o;
    });
  }
  if (param.type === "number") {
    return subcommandBuilder.addNumberOption((o) => setCommon(o));
  }
  return subcommandBuilder.addStringOption((o) => {
    setCommon(o);
    if (param.maxLength !== undefined) o.setMaxLength(param.maxLength);
    if (param.choices) o.addChoices(...param.choices.map((c) => ({ name: c, value: c })));
    return o;
  });
}

function addWriteActionGroup(builder, groupName) {
  const entries = WRITE_ACTIONS.filter((e) => e.group === groupName);
  builder.addSubcommandGroup((g) => {
    g.setName(groupName).setDescription(`Write commands: ${groupName} (gated behind DUNE_DISCORD_WRITES_ENABLED).`);
    for (const entry of entries) {
      g.addSubcommand((c) => {
        c.setName(entry.name).setDescription(entry.desc);
        for (const param of entry.params) addOptionToSubcommand(c, param);
        return c;
      });
    }
    return g;
  });
}
```

Inside `buildDuneCommand`, right after the existing `if (includeWriteGroup) { ... }` block (do not modify that block — the old 12 stub commands stay exactly as they are):

```js
  if (includeWriteGroup) {
    for (const groupName of [...new Set(WRITE_ACTIONS.map((e) => e.group))]) {
      addWriteActionGroup(builder, groupName);
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/commands.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full suite and check the real Discord API validation**

Run: `npm test`. Then, in a non-production context (per this project's own deploy safety norms — never register against the live bot's application ID from a dev session without explicit sign-off), verify `buildDuneCommand({ includeWriteGroup: true }).toJSON()` doesn't throw when discord.js validates it (discord.js's builders throw synchronously on some invalid shapes, like a name that's too long or has bad characters) — a quick `node -e 'import("./src/commands.js").then(m => console.log(JSON.stringify(m.buildDuneCommand({includeWriteGroup:true}).toJSON()).length))'` succeeding confirms the shape is valid without actually calling Discord's API.

- [ ] **Step 6: Update the dispatch call site to pass `group`**

Find where `handleWriteCommand` is called in `src/commands.js` (the `else if (group === "write")` branch shown during planning research) and change it to pass `group` too (Task 4's `handleWriteCommand` now takes `group` as a parameter): the existing code already computes `group` from the interaction — verify `interaction.options.getSubcommandGroup()` is being read into a variable named `group` nearby (it is, based on this file's existing structure), and that it's forwarded: `handleWriteCommand({ subcommand, group, interaction, adapterClient, config, guildId, db })`.

- [ ] **Step 7: Commit**

```bash
git add src/commands.js test/commands.test.js
git commit -m "feat(write): register the new write-command groups, generated mechanically from WRITE_ACTIONS"
```

---

### Task 8: mentat — update `docs/upstream-write-adapter-rfc.md` and remove the stale safety-boundary comments

**Files:**
- Modify: `docs/upstream-write-adapter-rfc.md`
- Modify: `src/writeHandler.js` (module header comment, currently says "All commands return disabled until... the upstream write-adapter contract is implemented")

**Interfaces:** none (documentation only).

- [ ] **Step 1: Update the RFC's Status section**

In `docs/upstream-write-adapter-rfc.md`, add immediately after the existing `## Status` heading's first paragraph:

```markdown
**Update (2026-09-22, operator decision):** the "do not implement" gate above is overridden for the 27 real write commands listed in `docs/design/write-command-reconciliation-l1-design-2026-09-22.md` (Core's real, audited `dune-awakening-selfhost-docker`#215/#1026 actions, plus bot self-update). This RFC's original concern — a public write-capable adapter contract for arbitrary third-party bots — remains unresolved and is a separate question from this operator's own single Core+bot deployment choosing to use its own, now-real write bridge. The 8 actions with no real backing feature anywhere (`maintenance:*`/`notifications:*`/`schedule:*`) and `operations:clear-cache` remain genuinely blocked, unrelated to the upstream-contract question this RFC is about.
```

- [ ] **Step 2: Fix the stale module header in `writeHandler.js`**

Replace the file's top comment:

```js
// Write Command Handler — validates, confirms, audits write operations.
// 27 real actions (docs/design/write-command-reconciliation-l1-design-2026-09-22.md)
// call Core's real write/preview -> write/execute; the 12 original
// maintenance/notifications/schedule/cache scaffold entries remain stubbed
// (no real backing feature anywhere -- see that design doc section 5).
// All commands still require DUNE_DISCORD_WRITES_ENABLED=true.
```

- [ ] **Step 3: Commit**

```bash
git add docs/upstream-write-adapter-rfc.md src/writeHandler.js
git commit -m "docs(write): record the operator's decision to override the upstream-contract gate"
```

---

### Task 9: Push, open the mentat PR, verify CI

- [ ] **Step 1: Fetch and check for divergence before pushing**

Run: `git fetch origin && git log --oneline HEAD..origin/docs/write-command-reconciliation`
Expected: no output (branch is still only pushed by this session, per Task setup).

- [ ] **Step 2: Push**

Run: `git push origin docs/write-command-reconciliation`

- [ ] **Step 3: Update PR #395's body**

Run: `gh pr edit 395 --repo Project-Arrakis/mentat --title "feat(write): wire mentat to Core's real write bridge" --body "<comprehensive body covering: what changed, the 27 commands, the self-update mechanism and its safety-guardrail reuse, dependency on dune-awakening-selfhost-docker#1026 merging first, test output, and a note that this is currently blocked on Task 1 (Core-side) landing>"`
(Remove `--draft` only once CI is green and this session has run the Layer 1 design audit requested for after this plan, per Requirement 20 — do not mark ready before that.)

- [ ] **Step 4: Check CI**

Run: `gh run list --repo Project-Arrakis/mentat --branch docs/write-command-reconciliation --limit 5`
Fix any failure found the same way Task 1-8's own test steps would have caught it locally — investigate root cause, don't skip/disable a check.

---

## Plan Self-Review Notes (for whoever executes this)

- Task 1 must land and merge (or at least be pushed) before Task 4/5/7's tests that reference `backup.create`/`updates.*` can be exercised against a real Core instance — the mentat-side unit tests in this plan use a fake `adapterClient`, so they don't require Core's PR to be merged first, but a real end-to-end manual smoke test does.
- Every task's tests use a fake/injected `adapterClient` or `spawn` implementation — no task in this plan requires a live Core instance or a live Discord connection to pass its own test suite.
- The existing `write` group (12 stub entries, `commands.js`'s hand-written builder for it) is never modified by this plan — confirmed by Task 7 Step 3 explicitly preserving that block untouched.
