# Write Command Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Revision 2 (2026-09-22), after a Layer 1 eight-hat design audit found 4 CRITICAL and many HIGH/MEDIUM findings against Revision 1.** Every finding is fixed inline below, each marked `[Audit fix: <hat>, <severity>]` at its exact location, not summarized separately — the fix IS the plan text now. A second, narrower re-audit of just the changed sections runs after this revision, before any implementation begins.

**Goal:** Wire mentat's Discord commands to Core's real write bridge (25 existing actions + 3 new ones), replacing the permanent "awaiting upstream contract" stub with real `write/preview` → confirm → `write/execute` calls, and add a bot self-update command gated by a single, explicit host-operator identity — never by any guild's Discord ownership — that reuses the existing git-push deploy pipeline's safety guardrails.

**Architecture:** One generic, table-driven command engine (not 27 bespoke handlers): a single write-action table drives both Discord command registration (`commands.js`) and dispatch (`writeHandler.js`), a single confirmation-flow module (`writeConfirmation.js`) calls Core's real `adapterClient.writePreview()`/`writeExecute()` and builds the confirm button from Core's real response, and one error-mapping table turns every one of Core's 12 real error codes into a specific Discord message. Bot self-update is architecturally separate — no Core call, gated by a dedicated host-operator identity check (not the generic per-guild tier system, since mentat is multi-tenant and self-update affects the one shared process), with a lock file preventing concurrent deploys and two independent layers of success/failure reporting.

**Tech Stack:** Node.js, discord.js (`SlashCommandBuilder`, `ButtonBuilder`), `node:test`, bats (for shell script tests), Core's `dune-awakening-selfhost-docker` write bridge (external HTTP dependency via `adapterClient`), `systemd-run` (for self-update's cgroup escape).

**Spec:** `docs/design/write-command-reconciliation-l1-design-2026-09-22.md` (Revision 2)

## Global Constraints

- Discord slash commands allow exactly two levels of nesting (command → subcommand group → subcommand). `base`, `map`, `carepackage`, `guild`, `operations`, `bot` are genuinely new top-level subcommand groups. **`[Audit fix: Architect, CRITICAL]` `player` and `server` are NOT new groups** — `commands.js` already has live top-level groups with those exact names (read commands: `link`/`verify`/`characters`/`enable`/`disable`/`default`/`unlink`/`faction`/`whoami`/`inventory`/`storage`/`find` under `player`; `health`/`status`/`summary`/`readiness`/`services`/`maintenance`/`coriolis`/`atlas` under `server`). The new write subcommands for these two groups are **merged into the existing groups** — verified no subcommand-name collision (`kick`/`ban`/`unban`/`warn`/`give-item`/`clear-backpack`/`fill-water` for `player`; `restart`/`stop`/`start`/`restart-service` for `server`) against either group's existing subcommand list.
- The existing `write` group (12 old entries) and its hand-maintained, separately-defined `commands.js` builder are **left untouched** — none of the 8 deferred actions or the removed `operations:restart-service`/`cache` entries are touched by this plan.
- Every new/merged command's Discord definition is generated **mechanically from one shared table** (`writeActions.js`, new file) — never hand-duplicated a second time in `commands.js`.
- **`[Audit fix: Architect, CRITICAL]` Dispatch is table-driven, not group-name-driven**: `executeDuneCommand` gains one new branch — `else if (findWriteAction(group, subcommand)) { ... }` — checked before the final "Unknown command" fallback, so both merged-into-existing groups (`player`, `server`) and genuinely-new groups reach `handleWriteCommand` uniformly.
- Owner-tier and admin-tier checks reuse `canWrite()` from `writes.js` exactly as today — **except `bot.self-update`, which uses a dedicated host-operator identity check and never `canWrite()`** (see Task 6 — mentat is multi-tenant; per-guild "owner" tier is the wrong authorization boundary for an action that restarts the one shared bot process).
- No new dependency on Core's write bridge beyond what `adapterClient.writePreview()`/`writeExecute()` already expose. `AdapterHttpError` (`src/adapterClient.js`) is the real, existing shape every error-mapping test asserts against: `{ status, route, body: { ok: false, code, error } }`.
- `child_process.spawn` calls in the self-update path always use an argument array, never a template-interpolated shell string. **`[Audit fix: Security/Cloud-Security, HIGH]` The Discord interaction webhook URL (a bearer-style credential) is passed via the child's `env`, never `argv`** — an argv-passed secret is visible to any local process via `ps auxww`/`/proc/<pid>/cmdline` for the child's lifetime; an env var requires owning the process or root to read (`/proc/<pid>/environ`), matching this codebase's own established `_FILE`/env-var secret-handling convention.
- Every write command's real outcome is recorded via the existing `writeAuditEvent()` (`src/writes.js`) — **`[Audit fix: GRC, HIGH — Repudiation]` this was entirely absent from Revision 1.**
- Confirm-button `customId` values are parsed with `indexOf`-based extraction, never a naive `split(":")` — **`[Audit fix: Security/QA, MEDIUM]`** a naive split silently truncates any key containing its own colon.

---

### Task 1: Core — add `backup.create` and `updates.*` to `WRITE_ACTION_ROUTES`

*(Unchanged from Revision 1 — no audit findings against this task.)*

**Files:**
- Modify: `console/api/src/integrations/discord/writeActionRoutes.js` (worktree `core-issue215-write-bridge`, branch `issue/215-write-bridge`)
- Modify: `console/api/src/integrations/discord/writeActionMinTier.js`
- Test: `console/api/test/writeActionRoutes.test.js`, `console/api/test/writeActionMinTier.test.js`

**Interfaces:**
- Produces: three new `WRITE_ACTION_ROUTES` keys (`backup.create`, `updates.apply-game`, `updates.fix-steamcmd`), each resolvable via the existing `resolveWriteActionRoute(action, params)` and covered by the existing `selfCheckWriteActionRoutes()`/`checkConfirmPhrasesAgainstRealHandlers()` self-checks with zero code changes to those functions.

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

In `writeActionMinTier.js`, add to `WRITE_ACTION_MIN_TIER`:

```js
  "backup.create": "owner",
  "updates.apply-game": "owner",
  "updates.fix-steamcmd": "owner",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd console/api && node --test test/writeActionRoutes.test.js test/writeActionMinTier.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full Core test suite**

Run: `cd console/api && node --test`
Expected: same pass/fail/skip counts as before this change plus 2 new passing tests.

- [ ] **Step 6: Commit**

```bash
git add console/api/src/integrations/discord/writeActionRoutes.js console/api/src/integrations/discord/writeActionMinTier.js console/api/test/writeActionRoutes.test.js console/api/test/writeActionMinTier.test.js
git commit -m "feat(discord): add backup.create and updates.* to the write bridge

Backs mentat's operations:create-backup/trigger-update commands.
Owner tier, no confirmation phrase (matches server.restart/stop/start's
existing precedent -- these routes use task(), which has no
confirmation-phrase mechanism)."
git push origin issue/215-write-bridge
```

---

### Task 2: mentat — unblock `write-execute`/`write-preview` in `adapterClient.js`

*(Unchanged from Revision 1 — no audit findings against this task.)*

**Files:**
- Modify: `src/adapterClient.js`
- Test: existing adapter-client route tests (find via `grep -rl "MISSING_ROUTES" test/`)

- [ ] **Step 1: Write the failing test**

```js
test("write-execute and write-preview are no longer MISSING_ROUTES", () => {
  assert.equal(isRouteMissing("write-execute"), false);
  assert.equal(isRouteMissing("write-preview"), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/adapterClient*.test.js`
Expected: FAIL.

- [ ] **Step 3: Remove the two entries from `MISSING_ROUTES`**

In `src/adapterClient.js`, remove `"write-execute", "write-preview",` from the `MISSING_ROUTES` set. Add a comment immediately above:

```js
// write-execute/write-preview removed 2026-09-22 (operator decision, see
// docs/design/write-command-reconciliation-l1-design-2026-09-22.md and
// the tracked issue it links): these routes are real once
// dune-awakening-selfhost-docker#1026 merges. Gating on
// DUNE_DISCORD_WRITES_ENABLED (writesEnabled(), writes.js) is the real
// kill switch for this feature going forward, not a version-compatibility
// flag.
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/adapterClient*.test.js`
Expected: PASS.

- [ ] **Step 5: Run the full mentat suite**

Run: `npm test`
Expected: no regressions (check for any other test asserting the old `MISSING_ROUTES` contents by name).

- [ ] **Step 6: Commit**

```bash
git add src/adapterClient.js test/adapterClient*.test.js
git commit -m "feat(write): unblock write-execute/write-preview now that Core's routes are real"
```

---

### Task 3: mentat — the write-action table (`src/writeActions.js`, new file)

**Files:**
- Create: `src/writeActions.js`
- Test: `test/writeActions.test.js`

**Interfaces:**
- Produces: `export const WRITE_ACTIONS` (array, **28 entries** — `[Audit fix: QA, CRITICAL]` Revision 1 claimed 27 and its own test asserted 27; the literal table has 7 player + 2 base + 4 server + 4 map + 6 carepackage + 2 guild + 2 operations + 1 bot = 28), each shaped `{ group, name, action, tier, confirmPhrase, params, desc }`. `group` is the real Discord top-level subcommand-group name (`player`, `base`, `server`, `map`, `carepackage`, `guild`, `operations`, `bot`).
- `bot.self-update`'s `tier` field is the literal string `"host-operator"` — **`[Audit fix: Security, CRITICAL]`** a sentinel value `canWrite()` never grants to any Discord role or guild-ownership check, so a bug that accidentally routed this one action through the generic per-guild tier system fails closed (rejected for everyone), not open. Its real authorization check is a dedicated identity comparison in Task 4, never `canWrite()`.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { WRITE_ACTIONS } from "../src/writeActions.js";

test("WRITE_ACTIONS: exactly 28 entries (25 Core actions + 2 new Core actions covering 3 sub-cases + self-update), no duplicate names within a group", () => {
  assert.equal(WRITE_ACTIONS.length, 28);
  const seen = new Set();
  for (const entry of WRITE_ACTIONS) {
    const key = `${entry.group}:${entry.name}`;
    assert.ok(!seen.has(key), `duplicate command: ${key}`);
    seen.add(key);
  }
});

test("WRITE_ACTIONS: every entry has a real Core action name, is bot.self-update, or resolves its action dynamically", () => {
  const staticActions = WRITE_ACTIONS.filter((e) => e.action !== null && e.action !== "bot.self-update").map((e) => e.action);
  const expectedStatic = [
    "player.kick", "player.ban", "player.unban", "player.warn", "player.give-item", "player.clear-backpack", "player.fill-water",
    "base.refill-generators", "base.refill-water",
    "server.restart", "server.stop", "server.start", "server.restart-service",
    "map.spawn", "map.despawn", "map.respawn", "map.teleport",
    "carepackage.grant", "carepackage.grant-all", "carepackage.enable", "carepackage.disable", "carepackage.scan", "carepackage.history-clear",
    "guild.add", "guild.remove",
    "backup.create"
    // NOTE: "updates.apply-game"/"updates.fix-steamcmd" are intentionally
    // absent from this static list -- trigger-update's `action` field is
    // `null` in the table, resolved dynamically via `resolveAction(params)`
    // (see Step 3). This is exactly the shape Revision 1's own test got
    // wrong (asserted both update actions as static strings, which the
    // table as designed cannot produce), caught by the Layer 1 QA hat.
  ];
  assert.deepEqual([...staticActions].sort(), [...expectedStatic].sort());

  const triggerUpdate = WRITE_ACTIONS.find((e) => e.name === "trigger-update");
  assert.equal(triggerUpdate.action, null);
  assert.equal(typeof triggerUpdate.resolveAction, "function");
  assert.equal(triggerUpdate.resolveAction({ type: "game" }), "updates.apply-game");
  assert.equal(triggerUpdate.resolveAction({ type: "steamcmd" }), "updates.fix-steamcmd");

  const selfUpdate = WRITE_ACTIONS.find((e) => e.action === "bot.self-update");
  assert.ok(selfUpdate);
});

test("WRITE_ACTIONS: server.stop is the only entry requiring dual confirmation", () => {
  const dualConfirm = WRITE_ACTIONS.filter((e) => e.requiresDualConfirmation === true);
  assert.equal(dualConfirm.length, 1);
  assert.equal(dualConfirm[0].action, "server.stop");
});

test("WRITE_ACTIONS: bot.self-update has the host-operator tier sentinel and group bot", () => {
  const entry = WRITE_ACTIONS.find((e) => e.action === "bot.self-update");
  assert.equal(entry.group, "bot");
  assert.equal(entry.tier, "host-operator");
  // No typed confirmPhrase (see writeHandler.js's self-update branch
  // comment) -- the host-operator identity check is the real gate.
  assert.equal(entry.confirmPhrase, null);
});

test("WRITE_ACTIONS: no entry uses group 'player' or 'server' with a name that collides with an existing read subcommand", () => {
  // Regression guard for the Layer 1 Architect hat's CRITICAL finding --
  // these two groups are MERGED into existing ones, not new siblings.
  const existingPlayerSubcommands = new Set(["link", "verify", "characters", "enable", "disable", "default", "unlink", "faction", "whoami", "inventory", "storage", "find"]);
  // [Audit fix: QA, HIGH round 2] This set previously listed only 8 of the
  // 10 real server subcommands -- missing readiness-detail/services-detail
  // (confirmed directly against src/commands.js's real "server" group
  // builder) -- meaning a colliding new write-action name would have
  // silently passed this regression guard.
  const existingServerSubcommands = new Set(["health", "status", "summary", "readiness", "readiness-detail", "services", "services-detail", "maintenance", "coriolis", "atlas"]);
  for (const entry of WRITE_ACTIONS.filter((e) => e.group === "player")) {
    assert.ok(!existingPlayerSubcommands.has(entry.name), `player:${entry.name} collides with an existing read subcommand`);
  }
  for (const entry of WRITE_ACTIONS.filter((e) => e.group === "server")) {
    assert.ok(!existingServerSubcommands.has(entry.name), `server:${entry.name} collides with an existing read subcommand`);
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/writeActions.test.js`
Expected: FAIL — `src/writeActions.js` does not exist.

- [ ] **Step 3: Write the table**

Create `src/writeActions.js`:

```js
// Single source of truth for mentat's real write commands -- both Discord
// command registration (commands.js) and dispatch (writeHandler.js) read
// from this table, so the two can never drift the way the old WRITE_COMMANDS
// array and its separate, hand-duplicated commands.js builder already have.
export const WRITE_ACTIONS = Object.freeze([
  // --- player (merged into the EXISTING "player" subcommand group --
  // verified no name collision with its read subcommands, see test above) ---
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

  // --- base (genuinely new group) ---
  { group: "base", name: "refill-generators", action: "base.refill-generators", tier: "admin", confirmPhrase: null,
    desc: "Refill a base's generators.", params: [{ name: "baseId", type: "integer", desc: "Base ID", required: true }] },
  { group: "base", name: "refill-water", action: "base.refill-water", tier: "admin", confirmPhrase: null,
    desc: "Refill a base's water.", params: [{ name: "baseId", type: "integer", desc: "Base ID", required: true }] },

  // --- server (merged into the EXISTING "server" subcommand group --
  // verified no name collision with its read subcommands, see test above) ---
  { group: "server", name: "restart", action: "server.restart", tier: "owner", confirmPhrase: null,
    desc: "Restart the game server.", params: [] },
  { group: "server", name: "stop", action: "server.stop", tier: "owner", confirmPhrase: null, requiresDualConfirmation: true,
    desc: "Stop the game server. Requires a second, different owner-tier admin to confirm.", params: [] },
  { group: "server", name: "start", action: "server.start", tier: "admin", confirmPhrase: null,
    desc: "Start the game server.", params: [] },
  { group: "server", name: "restart-service", action: "server.restart-service", tier: "admin", confirmPhrase: null,
    desc: "Restart a specific game service.", params: [
      { name: "service", type: "string", desc: "Service name (gateway/survival-1/overmap)", required: true }] },

  // --- map (genuinely new group) ---
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

  // --- carepackage (genuinely new group) ---
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

  // --- guild (genuinely new group) ---
  { group: "guild", name: "add", action: "guild.add", tier: "admin", confirmPhrase: null,
    desc: "Add a player to a guild.", params: [
      { name: "guildId", type: "string", desc: "Guild ID", required: true },
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "roleId", type: "string", desc: "Guild role ID", required: false }] },
  { group: "guild", name: "remove", action: "guild.remove", tier: "admin", confirmPhrase: null,
    desc: "Remove a player from a guild.", params: [
      { name: "guildId", type: "string", desc: "Guild ID", required: true },
      { name: "playerId", type: "string", desc: "Player ID", required: true }] },

  // --- operations (genuinely new group, backed by Task 1's new Core actions) ---
  { group: "operations", name: "create-backup", action: "backup.create", tier: "owner", confirmPhrase: null,
    desc: "Create a database backup.", params: [] },
  { group: "operations", name: "trigger-update", action: null, tier: "owner", confirmPhrase: null,
    desc: "Trigger a game or SteamCMD update.", params: [
      { name: "type", type: "string", desc: "Update type: game or steamcmd", required: true, choices: ["game", "steamcmd"] }],
    resolveAction: (params) => (params.type === "steamcmd" ? "updates.fix-steamcmd" : "updates.apply-game") },

  // --- bot (genuinely new group; self-update never calls Core -- see writeSelfUpdate.js) ---
  { group: "bot", name: "self-update", action: "bot.self-update", tier: "host-operator", confirmPhrase: null,
    desc: "Restart the bot on the latest deployed code (replays the deploy pipeline's test-gated safety checks). Restricted to the configured bot host operator.", params: [] }
]);

export function findWriteAction(group, name) {
  return WRITE_ACTIONS.find((e) => e.group === group && e.name === name) || null;
}
```

- [ ] **Step 4: Run to verify tests pass**

Run: `node --test test/writeActions.test.js`
Expected: PASS — **do not proceed to Task 4 until this genuinely passes.** `[Audit fix: QA, CRITICAL]` Revision 1's own headline tests here were wrong against its own table (an off-by-one count and an assertion shape the table cannot produce) — this is exactly the kind of thing that must be caught by actually running the tests, not assumed correct because the plan says so.

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
- Consumes: `WRITE_ACTIONS`/`findWriteAction` (Task 3), `adapterClient.writePreview(actor, body, guildId)`/`writeExecute(actor, body, guildId)` (existing), `AdapterHttpError` (existing), `canWrite()` (existing).
- Produces: `mapWriteError(error)` (exported from `writeErrorMapping.js`) — returns `{ title, description }` for a Discord embed, covering **all 12** real Core error codes. `handleWriteCommand()`'s return shape changes: replaces `status: "pending-upstream"` with either a real preview response or a real error.

- [ ] **Step 1: Write the failing test for error mapping — all 12 codes**

Create `test/writeErrorMapping.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { AdapterHttpError } from "../src/adapterClient.js";
import { mapWriteError } from "../src/writeErrorMapping.js";

function coreError(status, code, message) {
  return new AdapterHttpError(`Adapter write-execute returned HTTP ${status}.`, { status, route: "write-execute", body: { ok: false, code, error: message } });
}

test("mapWriteError: maps every one of the 12 real Core write-bridge error codes to a specific message", () => {
  // [Audit fix: QA, MEDIUM] Revision 1 only tested 8 of 10 documented
  // codes, contradicting the design's own "one dedicated test per row"
  // promise -- unknown_write_action/invalid_parameters and
  // nonce_action_mismatch/invalid_actor_signature are added here. The
  // design doc's table itself was later corrected from "10" to the real
  // 12 distinct codes (one row bundles stale_actor_signature/
  // invalid_actor_signature) -- this test's case list already covers all
  // 12; only the surrounding prose's stale "10" count needed fixing.
  //
  // [Audit fix: QA, MEDIUM round 3] Several rows' MOCK Core message text
  // happened to already satisfy that row's own expectedPattern
  // (nonce_not_found's mock literally said "expired"; second_confirmation_
  // required's mock literally said "second"; etc.) -- meaning the
  // assertion would still pass even if the corresponding MESSAGES table
  // entry in writeErrorMapping.js were deleted entirely and the code fell
  // through to the generic fallback (which just echoes Core's raw
  // message). That doesn't prove the MESSAGES lookup is what produced the
  // match. Every mock message below for a row with a real (non-null)
  // MESSAGES entry is now deliberately generic/unrelated wording, so a
  // pass can only happen if the real MESSAGES[code] text is what's
  // actually returned. `invalid_parameters` is the one deliberate
  // exception -- its MESSAGES entry is `null` (pass-through by design),
  // so its mock message intentionally *is* what's expected back verbatim.
  const cases = [
    ["writes_disabled", "core says nope", 403, /disabled/i],
    ["not_authorized", "core says denied", 403, /permission/i],
    // [Audit fix: QA round 3, found by actually RUNNING this test against
    // the real code, not just reading it] The real MESSAGES text says
    // "isn't available", not "not available" -- the original pattern
    // never matched it and this row was silently broken from the start,
    // regardless of any tautology question. Caught only by execution.
    ["unknown_write_action", "core says huh", 400, /isn't available/i],
    ["invalid_parameters", "bad params", 400, /bad params/i],
    ["nonce_not_found", "core says gone", 410, /expired/i],
    ["nonce_actor_mismatch", "core says nope-2", 403, /wasn't issued to you|not issued to you/i],
    ["nonce_action_mismatch", "core says wrong-action", 409, /internal error|action does not match|mismatch/i],
    ["second_confirmation_required", "core says wait", 202, /second/i],
    ["second_confirmation_same_actor", "core says no-same-actor", 403, /different administrator/i],
    ["stale_actor_signature", "core says old", 403, /role info expired|run the command again/i],
    ["invalid_actor_signature", "core says bad-sig", 403, /could not be verified|run the command again/i],
    ["write_backend_unavailable", "core says down", 503, /temporarily unavailable/i]
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
// section 3, all 12 codes) to a specific Discord message -- never a
// generic "something went wrong" for a code this bot actually knows about.
import { duneEmbed } from "./embedFormat.js";

const MESSAGES = {
  writes_disabled: "Write commands are disabled on this console.",
  not_authorized: "You don't have permission for this action.",
  unknown_write_action: "This command isn't available on the connected Core instance yet.",
  invalid_parameters: null, // uses the real error string from Core
  nonce_not_found: "This confirmation expired. Please run the command again.",
  nonce_actor_mismatch: "This confirmation wasn't issued to you.",
  nonce_action_mismatch: "Internal error: the action does not match what was previewed. Please run the command again.",
  // [Audit fix: QA round 3 sweep] This code was tested (writeErrorMapping.
  // test.js) but had no MESSAGES entry -- the test only passed because the
  // fallback branch happened to echo Core's own mock message text back,
  // which coincidentally matched the test's /second/i pattern. A REAL
  // Core response's exact wording isn't guaranteed to match that pattern.
  second_confirmation_required: "Your confirmation was accepted. A second, different owner-tier admin must click Confirm on this same message to complete it.",
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
  // [Audit fix: Security, HIGH] Every reply carrying this fallback (raw
  // Core error text) is ephemeral by design (Task 5) EXCEPT server.stop,
  // which never reaches this branch (every state it can produce has a
  // named code above) -- see the design doc's Sanitization note for why
  // this is an accepted disclosure boundary, not an oversight.
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

- [ ] **Step 5: Write the failing test for the real dispatch flow, including a non-string param**

Create `test/writeHandler.test.js` (check `ls test/writeHandler*` first — extend if one already exists):

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWriteCommand } from "../src/writeHandler.js";

function fakeAdapterClient({ previewResult, previewError, executeResult, executeError, capture } = {}) {
  return {
    async writePreview(actor, body, guildId) {
      if (capture) capture.previewCall = { actor, body, guildId };
      if (previewError) throw previewError;
      return previewResult;
    },
    async writeExecute(actor, body, guildId) {
      if (executeError) throw executeError;
      return executeResult;
    }
  };
}

function fakeOwnerInteraction() {
  return { user: { id: "owner-1" }, member: { roles: new Set() }, guild: { ownerId: "owner-1" } };
}

// [Audit fix: QA, MEDIUM] Revision 1's test never asserted the actual
// request shape sent to Core -- only that the return value threaded
// through. This uses `capture` to prove the real action/params reach
// writePreview, directly contradicting the design's own "not a hand-wavy
// mock" standard if left unchecked.
test("handleWriteCommand: a real preview success returns needsConfirmation with the real Core nonce/expiresAt, and calls writePreview with the exact real action+params", async () => {
  const capture = {};
  const adapterClient = fakeAdapterClient({
    capture,
    previewResult: { ok: true, nonce: "real-nonce-123", expiresAt: Date.now() + 60000, preview: { action: "player.kick", confirmPhrase: null } }
  });
  const config = { discord: { writes: { enabled: true } } };
  const result = await handleWriteCommand({
    subcommand: "kick", group: "player",
    interaction: { ...fakeOwnerInteraction(), options: { getString: (name) => (name === "playerId" ? "Server#4242" : null), getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.nonce, "real-nonce-123");
  assert.ok(!("status" in result) || result.status !== "pending-upstream", "must not return the old stub status");
  assert.equal(capture.previewCall.body.action, "player.kick");
  assert.equal(capture.previewCall.body.params.playerId, "Server#4242");
});

test("handleWriteCommand: a preview rejection (e.g. not_authorized) returns a real error, no confirmation offered", async () => {
  const { AdapterHttpError } = await import("../src/adapterClient.js");
  const adapterClient = fakeAdapterClient({
    previewError: new AdapterHttpError("HTTP 403", { status: 403, route: "write-preview", body: { ok: false, code: "not_authorized", error: "nope" } })
  });
  const config = { discord: { writes: { enabled: true } } };
  const result = await handleWriteCommand({
    subcommand: "kick", group: "player",
    interaction: { ...fakeOwnerInteraction(), options: { getString: () => "Server#4242", getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, false);
  assert.ok(!result.needsConfirmation);
  assert.match(result.error, /permission/i);
});

// [Audit fix: QA, HIGH] Revision 1 had zero coverage for non-string
// params -- every proposed test used player.kick (string-only params).
// 6 of 28 real commands use integer/number params; this proves
// collectParams() reads them via the correct accessor, not getString.
test("handleWriteCommand: integer params (base.refill-generators's baseId) are read via getInteger, not getString", async () => {
  const capture = {};
  const adapterClient = fakeAdapterClient({
    capture,
    previewResult: { ok: true, nonce: "n", expiresAt: Date.now() + 60000, preview: { action: "base.refill-generators", confirmPhrase: null } }
  });
  const config = { discord: { writes: { enabled: true } } };
  await handleWriteCommand({
    subcommand: "refill-generators", group: "base",
    interaction: {
      ...fakeOwnerInteraction(),
      options: {
        getString: () => { throw new Error("must not call getString for an integer param"); },
        getInteger: (name) => (name === "baseId" ? 42 : null),
        getNumber: () => null
      }
    },
    adapterClient, config
  });
  assert.equal(capture.previewCall.body.params.baseId, 42);
});

test("handleWriteCommand: number params (map.teleport's x/y/z/yaw) are read via getNumber", async () => {
  const capture = {};
  const adapterClient = fakeAdapterClient({
    capture,
    previewResult: { ok: true, nonce: "n", expiresAt: Date.now() + 60000, preview: { action: "map.teleport", confirmPhrase: null } }
  });
  const config = { discord: { writes: { enabled: true } } };
  await handleWriteCommand({
    subcommand: "teleport", group: "map",
    interaction: {
      ...fakeOwnerInteraction(),
      options: {
        getString: (name) => (name === "playerId" ? "Server#4242" : null),
        getInteger: () => null,
        getNumber: (name) => ({ x: 1.5, y: 2.5, z: 3.5, yaw: 90 }[name] ?? null)
      }
    },
    adapterClient, config
  });
  assert.equal(capture.previewCall.body.params.x, 1.5);
  assert.equal(capture.previewCall.body.params.yaw, 90);
});

test("handleWriteCommand: bot.self-update is rejected for a non-host-operator even at 'owner' Discord tier, and never reaches adapterClient", async () => {
  const config = { discord: { writes: { enabled: true }, botOperatorUserId: "the-real-operator" } };
  const adapterClient = fakeAdapterClient({});
  const result = await handleWriteCommand({
    subcommand: "self-update", group: "bot",
    interaction: { ...fakeOwnerInteraction(), user: { id: "some-guild-owner-not-the-operator" }, options: { getString: () => null, getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /host operator|not authorized/i);
});

test("handleWriteCommand: bot.self-update is disabled entirely when DUNE_BOT_OPERATOR_DISCORD_USER_ID is unset", async () => {
  const config = { discord: { writes: { enabled: true } } }; // no botOperatorUserId
  const adapterClient = fakeAdapterClient({});
  const result = await handleWriteCommand({
    subcommand: "self-update", group: "bot",
    interaction: { ...fakeOwnerInteraction(), options: { getString: () => null, getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, false);
});

// [Audit fix: Security, MEDIUM round 3] Proves the 9 remaining legacy
// group="write" stub subcommands still work exactly as they always have
// -- never routed into findWriteAction (which has no "write"-group
// entries) and never reaching adapterClient at all.
test("handleWriteCommand: a legacy group='write' stub subcommand (e.g. maintenance-note) still returns the scaffolded status, never calling adapterClient", async () => {
  const config = { discord: { writes: { enabled: true } } };
  const adapterClient = fakeAdapterClient({});
  let previewCalled = false;
  adapterClient.writePreview = async () => { previewCalled = true; return {}; };
  const result = await handleWriteCommand({
    subcommand: "maintenance-note", group: "write",
    interaction: { ...fakeOwnerInteraction(), options: { getString: (name) => (name === "note" ? "test note" : null), getInteger: () => null, getNumber: () => null } },
    adapterClient, config
  });
  assert.equal(result.ok, true);
  assert.equal(result.needsConfirmation, true);
  assert.equal(result.status, "pending-upstream");
  assert.equal(previewCalled, false, "a legacy stub subcommand must never call adapterClient.writePreview()");
});

test("handleWriteCommand: group='write' subcommand names superseded by a real command (e.g. 'restart') are NOT in LEGACY_WRITE_STUBS", async () => {
  const { LEGACY_WRITE_STUBS } = await import("../src/writeHandler.js");
  const supersededNames = new Set(["backup", "restart", "update"]);
  for (const stub of LEGACY_WRITE_STUBS) {
    assert.ok(!supersededNames.has(stub.name), `${stub.name} was superseded by a real command and must be removed from both LEGACY_WRITE_STUBS and commands.js's write group (Task 7 Step 3)`);
  }
  assert.equal(LEGACY_WRITE_STUBS.length, 9);
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `node --test test/writeHandler.test.js`
Expected: FAIL.

- [ ] **Step 7a: Move `actorFromInteraction` from `commands.js` to `rbac.js`**

`[Audit fix: UI/UX, CRITICAL, round 2]` Every actor payload sent to Core in this task (and in Task 5) must be built via this real, already-correct, already-used helper — never a hand-built, incomplete object (an earlier draft of this plan used `{ userId, username, guildOwnerId }`, missing `roleIds`/`channelId`/`guildId`, fields `actorSignature.js`'s real HMAC signing needs). It currently lives in `commands.js`, which this task's own `writeHandler.js` is imported BY (`commands.js` → `writeHandler.js`) — importing it back from `commands.js` here would be circular. `rbac.js` is this codebase's own already-established fix for exactly this shape of problem (both `writes.js` and `commands.js` already import from it).

`[Audit fix: Architect/QA, MEDIUM round 4]` — found only by actually assembling this move and running it: `actorFromInteraction`'s real body (`src/commands.js:793`) calls `extractRoleIds(interaction)` (`src/commands.js:885`, exported but otherwise private to that file). Moving only `actorFromInteraction` and leaving `extractRoleIds` behind in `commands.js` reintroduces the exact circular import this step exists to avoid (`rbac.js`'s own module header explicitly states it "must NOT import commands.js"). This codebase already has established precedent for this exact situation: `src/writes.js` keeps its own private copy of `extractRoleIds` (`writes.js:132`) rather than importing `commands.js`'s — do the same here.

Cut `actorFromInteraction`'s real function body (`src/commands.js`, currently ~line 793) into `src/rbac.js`. It calls `extractRoleIds(interaction)` — copy that function's body (`src/commands.js:885`) into `rbac.js` too, as a private (non-exported) helper, matching `writes.js`'s existing precedent rather than importing it from `commands.js`. Leave `commands.js`'s own `extractRoleIds` export untouched (other real callers there still use it) — this creates a third private copy of the same small function, joining `writes.js`'s existing one, which is an accepted, already-established pattern in this codebase for breaking exactly this class of circular import, not a new problem. Replace `actorFromInteraction`'s old location in `commands.js` with a re-export: `export { actorFromInteraction } from "./rbac.js";` (so every existing caller in `commands.js` keeps working unchanged). Run `node --test test/commands.test.js` to confirm the move didn't break anything.

- [ ] **Step 7: Rewrite `handleWriteCommand` to call Core for real, with the host-operator gate for self-update, the preserved legacy stub branch, and audit events throughout**

`[Audit fix: Security, MEDIUM round 3]` A Round 3 re-verification found that Revision 1/2/3's full-body replacement of `writeHandler.js` silently deleted the entire `WRITE_COMMANDS` lookup and stub-response logic, with nothing put in its place for `group === "write"` — contradicting the design doc's own explicit statement (section 2, "Accepted, undocumented-until-now architectural gap") that the 12 legacy entries "keep their existing hand-written... builder untouched." Task 7 still leaves the real `commands.js` `write` group registered (per its own Step 3 text), so every one of those 12 subcommands would silently start returning `"Unknown write command: write X"` instead of either their intended scaffolded-stub response (9 of them) or working correctly under their new, real location (3 of them: `restart`→`/dune server restart-service`, `backup`→`/dune operations create-backup`, `update`→`/dune operations trigger-update`). Fixed two ways, together: (a) below, `LEGACY_WRITE_STUBS` restores the exact pre-existing stub behavior for the 9 subcommands with no real backing feature yet, verbatim from the real, current `src/writeHandler.js`; (b) Task 7 Step 3 (below) removes the 3 superseded subcommand names from the real `write` group builder, per the design doc's own explicit "removed, not kept as a second command" principle (design doc line 149) — extended consistently to `backup`/`update`, not just `restart`, since all three now have a real, non-duplicate new home.

Replace `src/writeHandler.js`'s body:

```js
import { randomUUID } from "node:crypto";
import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";
import { findWriteAction, WRITE_ACTIONS } from "./writeActions.js";
import { mapWriteError } from "./writeErrorMapping.js";
import { buildConfirmationEmbed, buildConfirmationRow, registerRealPendingConfirmation, confirmationTimeoutMs, pendingConfirmationCount, createPendingConfirmation, writeTimeoutAuditEvent } from "./writeConfirmation.js";
import { actorFromInteraction } from "./rbac.js";

export { WRITE_ACTIONS };

// [Audit fix: Security, MEDIUM round 3] The 9 remaining WRITE_COMMANDS
// entries with no real backing feature anywhere (design doc section 2) --
// copied verbatim from the real, current src/writeHandler.js, MINUS the 3
// entries superseded by a real new command elsewhere ("backup", "restart",
// "update" -- see Task 7 Step 3, which removes exactly these 3 from the
// real commands.js "write" group builder). These keep returning the exact
// same "scaffolded, awaiting upstream contract" response they always have
// -- this design does not touch their behavior at all, only where the
// code that produces it lives.
export const LEGACY_WRITE_STUBS = Object.freeze([
  { group: "write", name: "maintenance-note", action: "maintenance:set-note", risk: "low", tier: "admin",
    desc: "Set a maintenance note for operators.", params: [{ name: "note", type: "string", desc: "Maintenance note text", required: true, maxLength: 500 }] },
  { group: "write", name: "maintenance-window", action: "maintenance:set-window", risk: "low", tier: "admin",
    desc: "Set a maintenance window.", params: [
      { name: "start", type: "string", desc: "Start time (ISO 8601)", required: true },
      { name: "duration", type: "integer", desc: "Duration in minutes", required: true, min: 1, max: 1440 }] },
  { group: "write", name: "alert-channel", action: "notifications:set-alert-channel", risk: "low", tier: "admin",
    desc: "Set the alert channel for readiness/service notifications.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "alert-threshold", action: "notifications:set-threshold", risk: "medium", tier: "admin",
    desc: "Set alert thresholds.", params: [
      { name: "metric", type: "string", desc: "Metric (readiness/services/population)", required: true },
      { name: "condition", type: "string", desc: "Condition (lt/gt/eq)", required: true },
      { name: "value", type: "integer", desc: "Threshold value", required: true }] },
  { group: "write", name: "digest-schedule", action: "notifications:set-digest-schedule", risk: "low", tier: "admin",
    desc: "Set the digest schedule interval.", params: [{ name: "minutes", type: "integer", desc: "Interval in minutes", required: true, min: 5, max: 1440 }] },
  { group: "write", name: "post-schedule", action: "schedule:set-post-schedule", risk: "low", tier: "admin",
    desc: "Set the scheduled post type.", params: [{ name: "type", type: "string", desc: "status/status-summary/readiness/services/none", required: true }] },
  { group: "write", name: "add-channel", action: "schedule:add-channel", risk: "medium", tier: "admin",
    desc: "Add a channel for scheduled posts.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "remove-channel", action: "schedule:remove-channel", risk: "medium", tier: "admin",
    desc: "Remove a channel from scheduled posts.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "cache", action: "operations:clear-cache", risk: "medium", tier: "owner",
    desc: "Clear server caches.", params: [{ name: "type", type: "string", desc: "Cache type (steam/maps/derived)", required: true }] }
]);

function findLegacyWriteStub(group, subcommand) {
  if (group !== "write") return null;
  return LEGACY_WRITE_STUBS.find((c) => c.name === subcommand) || null;
}

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

  // Legacy stub path, checked BEFORE findWriteAction: the 9 remaining
  // maintenance/notifications/schedule/clear-cache entries are group
  // "write" specifically, which findWriteAction (Task 3's real-action
  // table) never resolves -- WRITE_ACTIONS has no "write"-group entries at
  // all. Preserves the exact pre-existing behavior (createPendingConfirmation,
  // no kind field -- distinguishing it from registerRealPendingConfirmation's
  // "real"/"self-update" entries in Task 5's confirm-button dispatch).
  const legacyDef = findLegacyWriteStub(group, subcommand);
  if (legacyDef) {
    if (!canWrite(interaction, config, legacyDef.tier, db, guildId)) {
      const requiresOwner = legacyDef.tier === "owner";
      return {
        ok: false,
        error: requiresOwner
          ? "Not authorized for write operations. This action requires owner-tier access, which belongs only to this Discord server's real owner."
          : "Not authorized for write operations. Requires admin-tier access (a mapped Admin role, or the real Discord server owner)."
      };
    }
    const idempotencyKey = generateIdempotencyKey();
    const confirmation = requireConfirmation({ action: legacyDef.action, target: legacyDef.tier, risk: legacyDef.risk });
    const { embed, row } = createPendingConfirmation({
      idempotencyKey,
      action: legacyDef.action,
      tier: legacyDef.tier,
      risk: legacyDef.risk,
      userId: interaction?.user?.id,
      onTimeout: (entry) => console.log(JSON.stringify(writeTimeoutAuditEvent(entry, idempotencyKey)))
    });
    return {
      ok: true,
      action: legacyDef.action,
      tier: legacyDef.tier,
      risk: legacyDef.risk,
      idempotencyKey,
      needsConfirmation: true,
      confirmationMessage: confirmation.message,
      confirmationEmbed: embed,
      confirmationRow: row,
      status: "pending-upstream",
      message: "Write command scaffolded. Awaiting upstream write-adapter contract implementation."
    };
  }

  const def = findWriteAction(group, subcommand);
  if (!def) return { ok: false, error: `Unknown write command: ${group} ${subcommand}` };

  // bot.self-update: a dedicated host-operator identity check, NEVER
  // canWrite()'s per-guild tier system. [Audit fix: Security, CRITICAL]
  // mentat is multi-tenant -- "owner" tier is scoped per-guild, but
  // self-update restarts the ONE shared bot process serving every tenant.
  // def.tier is the sentinel "host-operator", which canWrite() can never
  // grant, so this action is authorized ONLY by this exact check.
  if (def.action === "bot.self-update") {
    const operatorId = config?.discord?.botOperatorUserId;
    if (!operatorId || interaction.user?.id !== operatorId) {
      return { ok: false, error: "Not authorized. This action is restricted to the configured bot host operator." };
    }
    // No typed confirmation phrase: the host-operator identity check above
    // already narrows this to exactly one person, and the confirm-button
    // click (Task 5) already requires a second, deliberate action -- a
    // typed phrase would need a Discord modal (a different interaction
    // type than every other command's button flow) for marginal benefit
    // given the identity check already does the real narrowing. Simplified
    // out during this plan's own self-review rather than half-implemented.
    console.log(JSON.stringify(writeAuditEvent({ actor: actorFromInteraction(interaction), action: def.action, capability: def.action, idempotencyKey: "n/a", result: "triggered" })));
    const key = randomUUID();
    const expiresAt = Date.now() + confirmationTimeoutMs();
    const pendingCount = pendingConfirmationCount();
    registerRealPendingConfirmation({ nonce: key, action: def.action, tier: def.tier, userId: interaction.user.id, expiresAt, confirmPhrase: def.confirmPhrase, kind: "self-update" });
    return {
      ok: true, needsConfirmation: true, action: def.action, tier: def.tier, isSelfUpdate: true,
      confirmationEmbed: buildConfirmationEmbed({
        action: def.action, tier: def.tier, risk: "high", expiresAt, confirmPhrase: def.confirmPhrase,
        extraWarning: pendingCount > 0 ? `${pendingCount} other pending confirmation(s) will be lost.` : null
      }),
      confirmationRow: buildConfirmationRow(key)
    };
  }

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
  // [Audit fix: Security, CRITICAL round 2] actorFromInteraction (rbac.js,
  // moved there in Step 7a) builds the COMPLETE actor payload -- userId,
  // username, guildId, channelId, roleIds, guildOwnerId -- that Core's
  // actorSignature.js HMAC verification needs. A hand-built partial actor
  // (just userId/username/guildOwnerId) was this plan's own bug through
  // Revision 2: every write/preview and write/execute call would have sent
  // Core an incomplete actor, not just the dual-confirmation path.
  const actor = actorFromInteraction(interaction);

  let preview;
  try {
    preview = await adapterClient.writePreview(actor, { action, params }, guildId);
  } catch (error) {
    const { description } = mapWriteError(error);
    console.log(JSON.stringify(writeAuditEvent({ actor, action, capability: action, idempotencyKey: "n/a", result: "preview-rejected", detail: { error: description } })));
    return { ok: false, error: description };
  }

  const nonce = preview.nonce;
  const expiresAt = preview.expiresAt;
  registerRealPendingConfirmation({ nonce, action, tier: def.tier, userId: interaction.user.id, expiresAt, confirmPhrase: preview.preview?.confirmPhrase, kind: "real" });
  console.log(JSON.stringify(writeAuditEvent({ actor, action, capability: action, idempotencyKey: nonce, result: "preview-ok" })));

  return {
    ok: true,
    needsConfirmation: true,
    action,
    tier: def.tier,
    nonce,
    expiresAt,
    confirmationEmbed: buildConfirmationEmbed({ action, tier: def.tier, risk: def.tier === "owner" ? "high" : "medium", expiresAt, confirmPhrase: preview.preview?.confirmPhrase }),
    confirmationRow: buildConfirmationRow(nonce)
  };
}
```

- [ ] **Step 8: Extend `writeConfirmation.js` — `registerRealPendingConfirmation` with `kind` + a real expiry sweep, and `buildConfirmationEmbed` with the expiry countdown**

In `src/writeConfirmation.js`, add near the existing `createPendingConfirmation`:

```js
// [Audit fix: Architect, HIGH] Real and self-update confirmations, unlike
// the legacy stub flow, previously had no expiry timer at all -- an
// unclicked one sat in the shared Map forever. Every kind now gets a
// scheduled cleanup, matching the legacy flow's own existing pattern.
//
// [Audit fix: UI/UX, CRITICAL round 3] This signature previously did NOT
// destructure or store `secondConfirmationPending` at all -- Task 5 Step 3
// calls this SAME function with `secondConfirmationPending: true` when
// re-registering after Core's 202, but a plain object-destructuring
// parameter silently drops any property not named here. The stored entry
// never actually carried the flag, `entry.secondConfirmationPending` read
// `undefined` forever, and the entire ownership-gate exception in Task 5
// Step 3 (which branches on exactly that field) could never fire -- a
// FOURTH structural reason a second admin could never complete a dual
// confirmation, on top of the three Round 2 already found and fixed.
export function registerRealPendingConfirmation({ nonce, action, tier, userId, expiresAt, confirmPhrase, kind, secondConfirmationPending = false }) {
  if (typeof userId !== "string" || userId.length === 0) {
    throw new Error("registerRealPendingConfirmation: userId is required.");
  }
  const timer = setTimeout(() => { pendingConfirmations.delete(nonce); }, Math.max(0, expiresAt - Date.now()));
  timer.unref?.();
  pendingConfirmations.set(nonce, { action, tier, userId, expiresAt, confirmPhrase, kind, timer, isReal: true, secondConfirmationPending });
  return nonce;
}
```

Update `buildConfirmationEmbed` (`[Audit fix: UI/UX, HIGH]` — the design promised a rendered expiry countdown; the real function never accepted or rendered `expiresAt` at all):

```js
export function buildConfirmationEmbed({ action, tier, risk, target, expiresAt, confirmPhrase, extraWarning }) {
  const fields = [
    { name: "Action", value: `\`${action}\``, inline: true },
    { name: "Tier", value: `\`${tier}\``, inline: true },
    { name: "Risk", value: `\`${risk}\``, inline: true },
    ...(target ? [{ name: "Target", value: String(target).slice(0, 1024) }] : []),
    ...(expiresAt ? [{ name: "Expires", value: `<t:${Math.floor(expiresAt / 1000)}:R>` }] : []),
    ...(confirmPhrase ? [{ name: "Type to confirm", value: `\`${confirmPhrase}\`` }] : []),
    ...(extraWarning ? [{ name: "⚠️ Warning", value: extraWarning }] : [])
  ];
  return duneEmbed({
    title: "⚠️ Confirm Write Action",
    color: "warning",
    description: "This will be visible to operators. Nothing has been executed yet.",
    fields
  });
}
```

- [ ] **Step 9: Run to verify tests pass**

Run: `node --test test/writeHandler.test.js test/writeErrorMapping.test.js`
Expected: PASS.

- [ ] **Step 10: Run the full mentat suite**

Run: `npm test`
Expected: existing tests referencing the OLD stub behavior or `buildConfirmationEmbed`'s old parameter shape will fail — fix each to assert the new real behavior.

- [ ] **Step 11: Commit**

```bash
git add src/writeHandler.js src/writeConfirmation.js src/writeErrorMapping.js test/writeHandler.test.js test/writeErrorMapping.test.js test/writeConfirmation.test.js
git commit -m "feat(write): replace the permanent stub with real write/preview calls, full error mapping, and the host-operator gate for self-update"
```

---

### Task 5: mentat — wire the confirm button to `write/execute`, dual-confirmation, and forced-public visibility

**Files:**
- Modify: `src/writeConfirmation.js`
- Test: `test/writeConfirmation.test.js`

**Interfaces:**
- Consumes: `registerRealPendingConfirmation` (Task 4), `adapterClient.writeExecute` (existing), `mapWriteError`/`buildWriteErrorEmbed` (Task 4), `actorFromInteraction` (Task 4 Step 7a moves this to `src/rbac.js`, with a re-export left in `commands.js` — the bot's own real, already-used helper that builds a complete, fresh actor payload from a live interaction; **`[Audit fix: UI/UX, CRITICAL, round 2]`** every actor sent to Core in this task uses this, never a hand-built or stale one).
- Produces: `handleWriteButtonInteraction(interaction, adapterClient)` — accepts `adapterClient`. Every caller (`grep -rn "handleWriteButtonInteraction" src/"`) is updated to pass it and to force `ephemeral: false` on the initial reply for any `requiresDualConfirmation` action.

- [ ] **Step 1: Write the failing tests**

Add to `test/writeConfirmation.test.js`:

```js
test("handleWriteButtonInteraction: confirm calls adapterClient.writeExecute with the real nonce and shows success", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n1", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000, kind: "real" });
  let executeCalledWith = null;
  const adapterClient = { writeExecute: async (actor, body) => { executeCalledWith = { actor, body }; return { ok: true }; } };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n1", user: { id: "u1" }, update: async (payload) => updates.push(payload) };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient);
  assert.equal(handled, true);
  assert.equal(executeCalledWith.body.nonce, "n1");
  assert.equal(executeCalledWith.body.action, "player.kick");
  assert.equal(updates.length, 1);
});

test("handleWriteButtonInteraction: a 202 second_confirmation_required response shows the waiting state, non-ephemeral, instructing a second admin to click THIS message (not 'run the command yourself', which does not work)", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n2", action: "server.stop", tier: "owner", userId: "u1", expiresAt: Date.now() + 300000, kind: "real" });
  const adapterClient = { writeExecute: async () => ({ ok: true, code: "second_confirmation_required", nonce: "n2", expiresAt: Date.now() + 300000 }) };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n2", user: { id: "u1" }, update: async (p) => updates.push(p) };
  await handleWriteButtonInteraction(interaction, adapterClient);
  assert.equal(updates[0].ephemeral, false, "the waiting-state message must be forced non-ephemeral so a second admin can see it");
  assert.match(JSON.stringify(updates[0]), /second|waiting/i);
  assert.match(JSON.stringify(updates[0]), /click.*confirm|click the confirm/i);
  assert.doesNotMatch(JSON.stringify(updates[0]), /run.*\/dune server stop yourself|run the command/i, "must not repeat the round-1 advice that doesn't actually work");
});

// [Audit fix: UI/UX, CRITICAL, round 2] This is the test that would have
// caught all three of round 2's structural breaks: a genuinely different
// second admin clicking the same message must actually be let through
// (not rejected as "not yours"), must have THEIR OWN real identity sent
// to Core (not the first admin's), and the action must actually complete.
test("handleWriteButtonInteraction: a genuinely different second admin can complete the dual-confirmation by clicking the same message", async () => {
  resetPendingConfirmations();
  // Simulates the state AFTER the first admin's click already got a 202
  // and re-registered with secondConfirmationPending: true (see Step 3).
  registerRealPendingConfirmation({ nonce: "n4", action: "server.stop", tier: "owner", userId: "first-admin", expiresAt: Date.now() + 300000, kind: "real", secondConfirmationPending: true });
  let executeCalledWith = null;
  const adapterClient = { writeExecute: async (actor, body) => { executeCalledWith = { actor, body }; return { ok: true }; } };
  const updates = [];
  const secondAdminInteraction = {
    isButton: () => true, customId: "write:confirm:n4",
    user: { id: "second-admin", username: "second" },
    guildId: "g1", channelId: "c1", member: { roles: { cache: new Map() } },
    update: async (p) => updates.push(p)
  };
  const handled = await handleWriteButtonInteraction(secondAdminInteraction, adapterClient);
  assert.equal(handled, true, "a genuinely different admin must not be rejected as 'not yours'");
  assert.equal(executeCalledWith.actor.userId, "second-admin", "Core must be told the REAL, current clicker's identity, never the first admin's");
  assert.match(JSON.stringify(updates[0]), /executed|success/i);
});

test("handleWriteButtonInteraction: the SAME admin cannot provide both confirmations -- rejected client-side before ever calling Core", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n5", action: "server.stop", tier: "owner", userId: "first-admin", expiresAt: Date.now() + 300000, kind: "real", secondConfirmationPending: true });
  let executeCalled = false;
  const adapterClient = { writeExecute: async () => { executeCalled = true; return { ok: true }; } };
  const replies = [];
  const sameAdminInteraction = { isButton: () => true, customId: "write:confirm:n5", user: { id: "first-admin" }, reply: async (p) => replies.push(p) };
  const handled = await handleWriteButtonInteraction(sameAdminInteraction, adapterClient);
  assert.equal(handled, true);
  assert.equal(executeCalled, false, "Core must never be called -- this is rejected client-side, matching Core's own second_confirmation_same_actor check");
  assert.match(JSON.stringify(replies[0]), /different administrator/i);
});

test("handleWriteButtonInteraction: writeExecute throwing a mapped error shows the specific error, not a generic failure", async () => {
  resetPendingConfirmations();
  registerRealPendingConfirmation({ nonce: "n3", action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000, kind: "real" });
  const { AdapterHttpError } = await import("../src/adapterClient.js");
  const adapterClient = { writeExecute: async () => { throw new AdapterHttpError("HTTP 410", { status: 410, route: "write-execute", body: { ok: false, code: "nonce_not_found", error: "gone" } }); } };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n3", user: { id: "u1" }, update: async (p) => updates.push(p) };
  await handleWriteButtonInteraction(interaction, adapterClient);
  assert.match(JSON.stringify(updates[0]), /expired/i);
});

test("handleWriteButtonInteraction: a customId key containing a colon is not truncated", async () => {
  // [Audit fix: Security/QA, MEDIUM] a naive split(":") would silently
  // truncate this key -- prove the real (indexOf-based) parsing doesn't.
  resetPendingConfirmations();
  const keyWithColon = "abc:def-123";
  registerRealPendingConfirmation({ nonce: keyWithColon, action: "player.kick", tier: "admin", userId: "u1", expiresAt: Date.now() + 60000, kind: "real" });
  const adapterClient = { writeExecute: async (actor, body) => { assert.equal(body.nonce, keyWithColon); return { ok: true }; } };
  const interaction = { isButton: () => true, customId: `write:confirm:${keyWithColon}`, user: { id: "u1" }, update: async () => {} };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient);
  assert.equal(handled, true);
});

// [Audit fix: Security/Architect, MEDIUM round 3] A legacy stub entry
// (created via the pre-existing createPendingConfirmation(), which never
// sets a `kind` field -- unlike registerRealPendingConfirmation()'s
// "real"/"self-update" entries) must confirm into the same scaffolded
// response it always has, and must NEVER reach adapterClient.writeExecute
// with a bogus, non-Core action name.
test("handleWriteButtonInteraction: a legacy stub confirmation (no kind field) reports the scaffolded status, never calling adapterClient", async () => {
  resetPendingConfirmations();
  // createPendingConfirmation must already be imported at the top of this
  // test file -- it's the pre-existing legacy registration function this
  // suite tested before this plan; not new to Task 5.
  createPendingConfirmation({ idempotencyKey: "n6", action: "maintenance:set-note", tier: "admin", risk: "low", userId: "u1", onTimeout: () => {} });
  let executeCalled = false;
  const adapterClient = { writeExecute: async () => { executeCalled = true; return { ok: true }; } };
  const updates = [];
  const interaction = { isButton: () => true, customId: "write:confirm:n6", user: { id: "u1" }, update: async (p) => updates.push(p) };
  const handled = await handleWriteButtonInteraction(interaction, adapterClient);
  assert.equal(handled, true);
  assert.equal(executeCalled, false, "a legacy stub entry must never reach adapterClient.writeExecute");
  assert.match(JSON.stringify(updates[0]), /not executed|scaffolded|awaiting upstream/i);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/writeConfirmation.test.js`
Expected: FAIL.

- [ ] **Step 3: Fix `customId` parsing and rewrite the confirm branch**

In `src/writeConfirmation.js`, replace the positional-destructure parsing near the top of `handleWriteButtonInteraction`:

```js
  const raw = String(interaction.customId || "");
  const firstColon = raw.indexOf(":");
  const secondColon = firstColon === -1 ? -1 : raw.indexOf(":", firstColon + 1);
  if (firstColon === -1 || secondColon === -1) return false;
  const prefix = raw.slice(0, firstColon);
  const action = raw.slice(firstColon + 1, secondColon);
  const idempotencyKey = raw.slice(secondColon + 1); // everything after the second colon, verbatim -- may itself contain colons
  if (prefix !== CUSTOM_ID_PREFIX) return false;
```

(Remove the old `const parts = ...split(":"); if (parts[0] !== CUSTOM_ID_PREFIX) return false; const [, action, idempotencyKey] = parts;` block this replaces.)

**`[Audit fix: UI/UX, CRITICAL, round 2]` Next, find the existing "not yours" ownership gate** (`if (interaction.user?.id !== entry.userId) { await interaction.reply({ embeds: [buildNotYoursEmbed()], ephemeral: true }); return true; }`, running unconditionally right after the `entry` lookup, before any action-specific branch). **This is the first of three structural reasons a second admin could never complete a dual confirmation** — it rejected them outright, before the code even reached the `confirm` branch below. Replace it with:

```js
  const isDualConfirmSecondStep = entry.secondConfirmationPending === true;
  if (interaction.user?.id !== entry.userId) {
    if (!isDualConfirmSecondStep) {
      // Normal case: a nonce belongs to exactly the actor who requested it.
      await interaction.reply({ embeds: [buildNotYoursEmbed()], ephemeral: true });
      return true;
    }
    // A genuinely different admin clicking a dual-confirmation's SECOND
    // step is exactly the expected, correct case -- fall through. Every
    // reference to "the actor" from this point on must use THIS
    // interaction's own real, current identity (actorFromInteraction),
    // never entry.userId (the FIRST admin) -- see the confirm branch below.
  } else if (isDualConfirmSecondStep) {
    // The SAME admin who gave the first confirmation cannot also give the
    // second -- reject client-side, mirroring Core's own
    // second_confirmation_same_actor check, per the design's own stated
    // requirement (never actually implemented until this fix).
    await interaction.reply({
      embeds: [duneEmbed({ title: "🔒 A Different Administrator Is Required", color: "error", description: "You already provided the first confirmation. A different, owner-tier administrator must provide the second one by clicking this same button." })],
      ephemeral: true
    });
    return true;
  }
```

Replace the `if (action === "confirm") { ... }` block with (note: `actor` is now built fresh from `interaction`, the ACTUAL clicker, for every path — never `entry.userId`):

```js
  if (action === "confirm") {
    const isSelfUpdate = entry.action === "bot.self-update";
    // [Audit fix: Security/Architect, MEDIUM round 3] entries created by
    // the OLD, untouched createPendingConfirmation() (writeHandler.js's
    // restored LEGACY_WRITE_STUBS branch, Task 4 Step 7) carry no `kind`
    // field at all -- only registerRealPendingConfirmation() (real/
    // self-update paths) sets one. Without this check, a legacy stub's
    // confirm click would fall through to the "real" branch below and
    // call adapterClient.writeExecute() with a bogus, never-registered
    // Core action name (e.g. "maintenance:set-note"), producing a
    // confusing Core-side error instead of the intended, harmless
    // scaffolded response this subcommand has always returned.
    const isLegacyStub = !entry.kind;
    clearPendingConfirmation(idempotencyKey);

    if (isLegacyStub) {
      await interaction.update({ embeds: [buildScaffoldedEmbed({ action: entry.action })], components: [] });
      return true;
    }

    if (isSelfUpdate) {
      const { runSelfUpdate } = await import("./writeSelfUpdate.js");
      console.log(JSON.stringify(writeAuditEvent({ actor: actorFromInteraction(interaction), action: entry.action, capability: entry.action, idempotencyKey, result: "confirmed" })));
      await interaction.update({ embeds: [duneEmbed({ title: "🔄 Self-Update Starting", color: "warning", description: "Restarting on the latest deployed code. I'll post the result here once it's done." })], components: [] });
      runSelfUpdate({ interactionToken: interaction.token, applicationId: interaction.applicationId, channelId: interaction.channelId });
      return true;
    }

    // [Audit fix: UI/UX, CRITICAL, round 2] the actual, current clicker's
    // real actor payload -- roleIds/guildId/channelId/username, everything
    // actorSignature.js's real HMAC signing needs -- built via the bot's
    // own existing, already-correct helper. Using entry.userId (the
    // ORIGINAL admin, captured at registration) here was the second of
    // three structural reasons dual-confirmation could never complete:
    // Core would see the same actor identity on both calls regardless of
    // who physically clicked, and reject the second one itself.
    const actor = actorFromInteraction(interaction);
    try {
      const result = await adapterClient.writeExecute(actor, { nonce: idempotencyKey, action: entry.action });
      if (result?.code === "second_confirmation_required") {
        // Re-register the SAME nonce, marking it pending a second,
        // different confirmer -- entry.userId stays the FIRST admin's ID
        // (needed so the ownership-gate logic above can tell them apart
        // from whoever clicks next), and secondConfirmationPending is what
        // actually enables that gate's exception. Previously referenced
        // but never set anywhere -- dead code, closed here.
        registerRealPendingConfirmation({ nonce: idempotencyKey, action: entry.action, tier: entry.tier, userId: entry.userId, expiresAt: result.expiresAt, kind: "real", secondConfirmationPending: true });
        await interaction.update({
          embeds: [duneEmbed({ title: "⏳ Waiting on a Second Administrator", color: "warning", description: "Your confirmation was accepted. A second, different owner-tier admin must click **Confirm** on this same message to complete it." })],
          components: [buildConfirmationRow(idempotencyKey)],
          ephemeral: false
        });
        return true;
      }
      console.log(JSON.stringify(writeAuditEvent({ actor, action: entry.action, capability: entry.action, idempotencyKey, result: "executed" })));
      await interaction.update({
        embeds: [duneEmbed({ title: "✅ Write Executed", color: "success", description: `\`${entry.action}\` completed.` })],
        components: []
      });
    } catch (error) {
      console.log(JSON.stringify(writeAuditEvent({ actor, action: entry.action, capability: entry.action, idempotencyKey, result: "execute-failed", detail: { error: mapWriteError(error).description } })));
      await interaction.update({ embeds: [buildWriteErrorEmbed(error)], components: [] });
    }
    return true;
  }
```

`actorFromInteraction` was already moved to `rbac.js` in Task 4 Step 7a (avoiding a real circular import: `commands.js` → `writeHandler.js` → `writeConfirmation.js` → `commands.js`) — import it from there. In `writeConfirmation.js`, add: `import { buildWriteErrorEmbed, mapWriteError } from "./writeErrorMapping.js"; import { actorFromInteraction } from "./rbac.js"; import { writeAuditEvent } from "./writes.js";`. Update the function signature: `export async function handleWriteButtonInteraction(interaction, adapterClient) {`.

Run `node --test test/commands.test.js` after the move to confirm the re-export didn't break any existing caller.

- [ ] **Step 4: Force non-ephemeral on the INITIAL reply too, for `requiresDualConfirmation` actions**

Find where `commands.js` sends the initial write-command reply (the `deferReply`/`editReply` call site around the `group === "write"` / new `findWriteAction` branch). Change it so that when `payload.needsConfirmation && WRITE_ACTIONS`'s matching entry has `requiresDualConfirmation: true`, the reply is sent with `ephemeral: false` instead of `config.discord.defaultEphemeral` — the FIRST admin's own confirmation prompt must also be public, not just the later "waiting on a second admin" state, since a second admin needs to be able to see the whole thread from the start.

- [ ] **Step 5: Update every caller of `handleWriteButtonInteraction`**

Run: `grep -rn "handleWriteButtonInteraction(" src/` — pass `adapterClient` (already in scope at the interaction-handling dispatch site) as the second argument everywhere it's called.

- [ ] **Step 6: Run to verify tests pass**

Run: `node --test test/writeConfirmation.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full mentat suite**

Run: `npm test`

- [ ] **Step 8: Commit**

```bash
git add src/writeConfirmation.js src/commands.js src/index.js test/writeConfirmation.test.js
git commit -m "feat(write): wire the confirm button to real write/execute

Includes the stop dual-confirmation state forced non-ephemeral (Layer 1
UI/UX CRITICAL finding: the bot's own default-ephemeral setting would
have made the dual-confirmation mechanism invisible to any second admin),
a discoverability instruction for a second admin arriving later, and
colon-safe customId parsing (Layer 1 Security/QA MEDIUM finding)."
```

---

### Task 6: mentat — bot self-update, gated by host-operator identity, with a deploy lock and two-layer reporting

**Files:**
- Create: `scripts/lib/deploy-core.sh`
- Modify: `scripts/deploy-post-receive.sh`
- Create: `scripts/self-update.sh`
- Create: `src/writeSelfUpdate.js`
- Modify: `src/config.js` (new `DUNE_BOT_OPERATOR_DISCORD_USER_ID` env var)
- Modify: `src/index.js` (new-process startup marker-file check)
- Test: `test/deploy-hook.bats` (must stay green), new `test/self-update.bats`, `test/writeSelfUpdate.test.js`, `test/config.test.js` (new env var)

**Interfaces:**
- Produces: `deploy_core::sync_test_install_restart(work_dir, service_name)` (bash) — acquires `runtime/deploy.lock`, returns 0 on full success, non-zero on any guardrail failure, **never restarts if it returns non-zero**, releases the lock on any exit path (`trap ... EXIT`). `runSelfUpdate({ interactionToken, applicationId, channelId })` (`src/writeSelfUpdate.js`) — writes a pending-marker file, spawns `scripts/self-update.sh` via `systemd-run --scope` (escaping the bot's own cgroup) with the webhook URL written to a short-lived 0600 temp file, only that file's path passed via `--setenv`/`env` (never the URL itself, and never via `argv`).

- [ ] **Step 1: Write the failing bats test for the extracted library, actually observing restart behavior**

Create `test/self-update.bats` (check `test/deploy-hook.bats` first for the real bats setup/helper pattern used):

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

  # [Audit fix: QA, CRITICAL] Revision 1's tests both passed
  # --skip-restart, meaning the restart branch was never reached in
  # EITHER test -- the "never restart on test-gate failure" property was
  # entirely unobserved. Fixed by putting fake sudo/systemctl scripts on
  # PATH ahead of the real ones and counting real invocations, instead of
  # skipping the branch.
  export FAKE_BIN="$(mktemp -d)"
  cat > "$FAKE_BIN/sudo" <<'EOF'
#!/usr/bin/env bash
echo "sudo $*" >> "$FAKE_BIN_LOG"
exit 0
EOF
  chmod +x "$FAKE_BIN/sudo"
  cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_BIN_LOG"
if [ "$1" = "is-active" ]; then echo "active"; fi
exit 0
EOF
  chmod +x "$FAKE_BIN/systemctl"
  export FAKE_BIN_LOG="$WORK_DIR/fake-bin.log"
  export PATH="$FAKE_BIN:$PATH"

  source "${BATS_TEST_DIRNAME}/../scripts/lib/deploy-core.sh"
}

teardown() {
  rm -rf "$WORK_DIR" "$FAKE_BIN"
}

@test "deploy_core::sync_test_install_restart returns 0 and DOES restart when tests pass" {
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -eq 0 ]
  [ -f "$FAKE_BIN_LOG" ]
  grep -q "systemctl restart $SERVICE_NAME" "$FAKE_BIN_LOG"
}

@test "deploy_core::sync_test_install_restart returns non-zero and NEVER restarts when the test gate fails" {
  echo '{"scripts":{"test":"exit 1"}}' > package.json
  git add package.json
  git commit -qm "break tests"
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -ne 0 ]
  [[ "$output" == *"aborting"* ]]
  if [ -f "$FAKE_BIN_LOG" ]; then
    ! grep -q "systemctl restart" "$FAKE_BIN_LOG"
  fi
}

@test "deploy_core::sync_test_install_restart refuses to run when the real lock directory is already held" {
  # [Audit fix: Security/DBA/QA, CRITICAL round 2 -- corroborated
  # independently by all three hats] The original version of this test
  # flocked an unrelated path ($WORK_DIR/../deploy.lock, a plain file) that
  # has nothing to do with the real lock primitive
  # (`mkdir "${work_dir}/runtime/deploy.lock"`, a directory, checked
  # directly against $work_dir/runtime), and wrapped the entire assertion
  # body in `( ... ) || true`, which silently converts any assertion
  # failure inside the subshell into a passing test. This version
  # pre-creates the REAL lock directory the function itself checks, and
  # has no swallow -- it can actually fail.
  mkdir -p "$WORK_DIR/runtime/deploy.lock"
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -ne 0 ]
  [[ "$output" == *"already in progress"* ]]
  if [ -f "$FAKE_BIN_LOG" ]; then
    ! grep -q "systemctl restart" "$FAKE_BIN_LOG"
  fi
  rmdir "$WORK_DIR/runtime/deploy.lock"
}

@test "deploy_core::sync_test_install_restart returns non-zero when the post-restart health check fails" {
  # [Audit fix: UI/UX, CRITICAL round 2] The function previously returned 0
  # unconditionally after attempting a restart, regardless of whether the
  # NEW process actually came up -- a crashed/failed-to-start process would
  # still produce a false-positive "success" result, which self-update.sh
  # (Step 8) would have reported to Discord as "✅ Self-update complete."
  cat > "$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >> "$FAKE_BIN_LOG"
if [ "$1" = "is-active" ]; then echo "failed"; exit 3; fi
exit 0
EOF
  chmod +x "$FAKE_BIN/systemctl"
  run deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"
  [ "$status" -ne 0 ]
}

@test "deploy_core::webhook_report keeps the webhook URL out of curl's argv entirely, using a -K config file instead" {
  # [Audit fix: QA, MEDIUM round 3] Round 3 found the curl-argv-leak fix
  # (Round 2) had zero test coverage anywhere -- neither self-update.sh
  # (no sourceable structure to test) nor this file exercised it. Extracting
  # the function into deploy-core.sh (Step 3) makes this test possible.
  cat > "$FAKE_BIN/curl" <<'EOF'
#!/usr/bin/env bash
echo "curl $*" >> "$FAKE_BIN_LOG"
prev=""
for arg in "$@"; do
  if [ "$prev" = "-K" ]; then
    cp "$arg" "$FAKE_CURL_CONFIG_CAPTURE"
  fi
  prev="$arg"
done
exit 0
EOF
  chmod +x "$FAKE_BIN/curl"
  export FAKE_CURL_CONFIG_CAPTURE="$WORK_DIR/captured-curl-config"
  export DISCORD_WEBHOOK_URL="https://discord.com/api/v10/webhooks/app123/super-secret-token-456"

  run deploy_core::webhook_report "test message"
  [ "$status" -eq 0 ]

  # The secret URL must never appear in curl's own argv (what ps/proc would show).
  run grep -c "super-secret-token-456" "$FAKE_BIN_LOG"
  [ "$output" -eq 0 ]
  # But it must genuinely have reached curl -- via the -K config file's content.
  [ -f "$FAKE_CURL_CONFIG_CAPTURE" ]
  run grep -c "super-secret-token-456" "$FAKE_CURL_CONFIG_CAPTURE"
  [ "$output" -eq 1 ]
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `bats test/self-update.bats`
Expected: FAIL — `scripts/lib/deploy-core.sh` does not exist.

- [ ] **Step 3: Extract the shared library, with a lock**

Read `scripts/deploy-post-receive.sh` in full first. Create `scripts/lib/deploy-core.sh`:

```bash
#!/usr/bin/env bash
# Shared deploy logic used by BOTH scripts/deploy-post-receive.sh (the real
# git-push-triggered hook) and scripts/self-update.sh (Discord-triggered,
# see src/writeSelfUpdate.js). Extracted so there is exactly one copy of
# the test-gated safety logic. Acquires a lock so a concurrent git-push
# deploy and a Discord-triggered self-update (or two self-update triggers)
# can never interleave against the same working directory.
deploy_core::sync_test_install_restart() {
  local work_dir="$1"
  local service_name="$2"
  local lock_file="${work_dir}/runtime/deploy.lock"

  mkdir -p "$(dirname "$lock_file")"
  if ! mkdir "$lock_file" 2>/dev/null; then
    echo "ERROR: a deploy is already in progress (lock held at $lock_file) -- refusing to run concurrently."
    return 1
  fi
  trap 'rmdir "'"$lock_file"'" 2>/dev/null' EXIT

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

  echo "Restarting $service_name..."
  sudo systemctl restart "$service_name" 2>/dev/null || systemctl --user restart "$service_name" 2>/dev/null || true
  sleep 3
  # [Audit fix: UI/UX, CRITICAL round 2] This used to log a warning on a
  # failed health check but return 0 (success) unconditionally regardless
  # -- meaning a crashed/failed-to-start new process still reported as a
  # successful deploy to every caller (deploy-post-receive.sh's exit code,
  # and self-update.sh's Discord webhook message). Now fails closed.
  if systemctl is-active "$service_name" 2>/dev/null | grep -q active; then
    echo "Deployment complete -- service is active."
  else
    echo "ERROR: service failed to become active after restart -- treating as a failed deploy."
    return 1
  fi

  return 0
}

# [Audit fix: QA, MEDIUM round 3] Extracted here (rather than left as a
# private function inside scripts/self-update.sh) specifically so it can
# be sourced and tested directly by test/self-update.bats -- self-update.sh
# itself has no sourceable-without-executing structure (it runs the real
# deploy pipeline at its own top level), so a function defined only there
# had no test coverage at all for the curl-argv-leak fix (see report()'s
# own history: [Audit fix: Security/Cloud-Security, HIGH round 2]). Reads
# DISCORD_WEBHOOK_URL from the CALLER's environment (bash functions see
# the caller's global variables dynamically, not lexically) -- self-update.sh
# sets it before sourcing this file and calling this function.
deploy_core::webhook_report() {
  local message="$1"
  if [ -n "${DISCORD_WEBHOOK_URL:-}" ]; then
    # The webhook URL embeds a bearer-style interaction token -- passing it
    # as a curl argv element would put it in `ps auxww`/`/proc/<pid>/cmdline`
    # for the life of the curl child process. Kept out of argv entirely via
    # a curl config file (`-K`), which curl reads directly.
    local curl_config
    curl_config="$(mktemp)"
    chmod 600 "$curl_config"
    {
      printf 'url = "%s"\n' "$DISCORD_WEBHOOK_URL"
      printf 'silent\n'
      printf 'show-error\n'
      printf 'max-time = 10\n'
      printf 'request = "POST"\n'
      printf 'header = "Content-Type: application/json"\n'
    } > "$curl_config"
    curl -K "$curl_config" \
      -d "$(printf '{"content":%s}' "$(printf '%s' "$message" | node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(0,"utf8")))')")" \
      >/dev/null 2>&1 || true
    rm -f "$curl_config"
  fi
}
```

- [ ] **Step 4: Run to verify the new tests pass**

Run: `bats test/self-update.bats`
Expected: PASS — this genuinely observes restart behavior now, closing the QA hat's CRITICAL finding.

- [ ] **Step 5: Refactor `deploy-post-receive.sh` to call the shared function**

Replace the deploy steps in the `while read` loop (from `git fetch deploy ...` through the health-check block) with:

```bash
  git fetch deploy "$DEPLOY_BRANCH" 2>&1 || { echo "ERROR: git fetch failed"; exit 1; }
  git reset --hard deploy/"$DEPLOY_BRANCH" 2>&1 || { echo "ERROR: git reset failed"; exit 1; }
  echo "Current: $(git log --oneline -1)"

  source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-core.sh"
  if ! deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"; then
    exit 1
  fi
```

Keep everything else (the pre-existing dirty-tree guard before the fetch, the slash-command re-registration block, and the post-restart security smoke test) exactly as-is.

- [ ] **Step 6: Run the existing deploy-hook test suite to verify no regression**

Run: `bats test/deploy-hook.bats`
Expected: PASS.

- [ ] **Step 7: Add `DUNE_BOT_OPERATOR_DISCORD_USER_ID` to config**

In `src/config.js`, alongside the existing env-var parsing:

```js
botOperatorUserId: optionalEnv(env, "DUNE_BOT_OPERATOR_DISCORD_USER_ID") || null,
```

(Placed under `config.discord`, matching where `handleWriteCommand` reads `config.discord.botOperatorUserId` in Task 4. Check the exact existing `optionalEnv`/`config.discord` shape in `config.js` and match its established pattern rather than inventing a new one.)

Add a test to `test/config.test.js`:

```js
test("config: botOperatorUserId is null when DUNE_BOT_OPERATOR_DISCORD_USER_ID is unset, set otherwise", () => {
  const withoutIt = loadConfig({ env: {} });
  assert.equal(withoutIt.discord.botOperatorUserId, null);
  const withIt = loadConfig({ env: { DUNE_BOT_OPERATOR_DISCORD_USER_ID: "12345" } });
  assert.equal(withIt.discord.botOperatorUserId, "12345");
});
```

(Match `loadConfig`'s real signature/call convention — check `config.test.js`'s existing tests for the exact pattern before writing this.)

- [ ] **Step 8: Write `scripts/self-update.sh`, with marker-file + systemd-run escape**

```bash
#!/usr/bin/env bash
# Discord-triggered replay of the deploy pipeline (see
# docs/design/write-command-reconciliation-l1-design-2026-09-22.md section
# 4a). Invoked by src/writeSelfUpdate.js's runSelfUpdate() via
# `systemd-run --scope`, so this process (and anything it forks) is NOT a
# member of acp-bot.service's own cgroup -- KillMode=control-group on that
# unit would otherwise kill this script in the same signal that kills the
# process it's restarting, silently breaking the report-back mechanism on
# the fast, successful path (Layer 1 Network hat finding).
#
# Does NOT fetch/reset from the deploy remote -- operates on whatever is
# already checked out at WORK_DIR (see design doc section 4a for why).
set -u

WORK_DIR="${WORK_DIR:-/home/bot/arrakis-control-panel}"
SERVICE_NAME="${SERVICE_NAME:-acp-bot.service}"
# [Audit fix: Security, HIGH round 3] The webhook URL is read from a
# short-lived 0600 temp file, not directly from the environment. `systemd-run`
# (writeSelfUpdate.js's primary, non-fallback path) submits the unit to the
# systemd MANAGER over D-Bus -- an env var set on the systemd-run CLIENT
# process (Node's own `spawn(..., { env })`) never actually reaches the
# scope it creates; only `--setenv=KEY=VALUE` on systemd-run's own argv
# does, and putting the secret itself there would leak it via
# `ps auxww`/`/proc/<pid>/cmdline` for systemd-run's own (client) process
# lifetime -- the exact leak this design already closed for curl (see
# deploy_core::webhook_report() in lib/deploy-core.sh). Passing only a
# temp file PATH via --setenv/env is safe
# (a path isn't sensitive) and matches this codebase's own established
# `_FILE` secret-handling convention (Requirement 24).
DISCORD_WEBHOOK_URL_FILE="${DISCORD_WEBHOOK_URL_FILE:-}"
DISCORD_WEBHOOK_URL=""
if [ -n "$DISCORD_WEBHOOK_URL_FILE" ]; then
  # [Audit fix: Security, MEDIUM round 4] A trap, not just an inline rm/rmdir
  # right after reading -- if this script exits/is killed at ANY point
  # before reaching the explicit cleanup below (a bug in an earlier line,
  # a signal), the 0600 secret file would otherwise be orphaned on disk
  # indefinitely with no reaper. Registered before the file is even read,
  # so it covers the read step itself failing too.
  trap 'rm -f "$DISCORD_WEBHOOK_URL_FILE" 2>/dev/null; rmdir "$(dirname "$DISCORD_WEBHOOK_URL_FILE")" 2>/dev/null || true' EXIT
  if [ -f "$DISCORD_WEBHOOK_URL_FILE" ]; then
    DISCORD_WEBHOOK_URL="$(cat "$DISCORD_WEBHOOK_URL_FILE")"
  fi
  rm -f "$DISCORD_WEBHOOK_URL_FILE"
  rmdir "$(dirname "$DISCORD_WEBHOOK_URL_FILE")" 2>/dev/null || true
  trap - EXIT
fi
MARKER_FILE="$WORK_DIR/runtime/self-update-pending.json"

source "$(dirname "${BASH_SOURCE[0]}")/lib/deploy-core.sh"

# report()'s implementation moved to deploy_core::webhook_report()
# (scripts/lib/deploy-core.sh, Step 3) so it can be sourced and tested
# directly by test/self-update.bats -- this script has no
# sourceable-without-executing structure of its own.

# Written BEFORE the restart, so the NEW process (started by
# deploy_core's own systemctl restart) can find it on its own startup and
# report success itself -- a second, independent reporting layer that
# survives even if THIS script's own webhook post (below) is killed
# alongside the old process despite the systemd-run escape (belt and
# braces, not a single point of failure).
mkdir -p "$(dirname "$MARKER_FILE")"
DISCORD_WEBHOOK_URL="$DISCORD_WEBHOOK_URL" node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({ webhookUrl: process.env.DISCORD_WEBHOOK_URL || '', triggeredAt: Date.now() }))" "$MARKER_FILE"

if deploy_core::sync_test_install_restart "$WORK_DIR" "$SERVICE_NAME"; then
  deploy_core::webhook_report "✅ Self-update complete. \`$(cd "$WORK_DIR" && git log --oneline -1)\` is now live."
else
  rm -f "$MARKER_FILE" # deploy_core already returns non-zero for either a failed test gate OR a failed post-restart health check -- either way, no confirmed-good new process exists for the marker to describe
  deploy_core::webhook_report "🛑 Self-update aborted or failed -- either the test gate failed (previous code is still running) or the restarted process did not come up healthy. Check the self-update log on the host for details."
  exit 1
fi
```

- [ ] **Step 9: Write the failing test for `writeSelfUpdate.js`**

Create `test/writeSelfUpdate.test.js`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runSelfUpdate, __setSpawnImplForTests, __setHasCommandImplForTests, __resetHasCommandImplForTests } from "../src/writeSelfUpdate.js";

// [Audit fix: Security, HIGH round 3] systemd-run submits the unit to the
// systemd MANAGER over D-Bus -- Node's own spawn(..., { env }) only
// affects the systemd-run CLIENT process, never the scope it creates. The
// webhook URL itself must never appear in systemd-run's own argv either
// (that would leak it via ps/proc for systemd-run's own process lifetime).
// The real fix: write the URL to a short-lived 0600 temp file and pass
// only that file's PATH via --setenv -- this test proves both halves.
test("runSelfUpdate: invokes systemd-run with --setenv=DISCORD_WEBHOOK_URL_FILE=<path>, never the URL itself in argv or in options.env directly", async () => {
  let capturedCommand = null;
  let capturedArgs = null;
  let capturedOptions = null;
  __setSpawnImplForTests((command, args, options) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return { unref: () => {}, pid: 12345 };
  });
  __setHasCommandImplForTests(() => true);

  const result = runSelfUpdate({ interactionToken: "tok", applicationId: "app", channelId: "chan" });

  assert.equal(capturedCommand, "systemd-run");
  assert.ok(Array.isArray(capturedArgs));
  assert.ok(capturedArgs.some((a) => a === "--scope"));
  const setenvArg = capturedArgs.find((a) => a.startsWith("--setenv=DISCORD_WEBHOOK_URL_FILE="));
  assert.ok(setenvArg, "must pass the webhook-url file path via --setenv so it actually reaches the spawned scope");
  const argvString = capturedArgs.join(" ");
  assert.ok(!argvString.includes("tok"), "the interaction token must not appear anywhere in argv, including inside --setenv");
  assert.equal(capturedOptions.env.DISCORD_WEBHOOK_URL, undefined, "the raw URL must never be set directly as an env var passed to systemd-run's own argv-visible --setenv mechanism");
  const filePath = setenvArg.slice("--setenv=DISCORD_WEBHOOK_URL_FILE=".length);
  const fileContent = readFileSync(filePath, "utf8");
  assert.ok(fileContent.includes("tok"), "the real webhook URL must be recoverable from the temp file the path points at");
  assert.equal(result.pid, 12345);
  __resetHasCommandImplForTests();
});

// [Audit fix: Network, HIGH round 2] The design's prose described a
// systemd-run-unavailable fallback (plain detached spawn), but no round-1
// code actually implemented it. This test proves the fallback path is
// real, not just documented.
test("runSelfUpdate: falls back to a plain detached spawn when systemd-run is unavailable, still using the file-based webhook URL convention", async () => {
  let capturedCommand = null;
  let capturedArgs = null;
  let capturedOptions = null;
  __setSpawnImplForTests((command, args, options) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return { unref: () => {}, pid: 54321 };
  });
  __setHasCommandImplForTests(() => false);

  const result = runSelfUpdate({ interactionToken: "tok2", applicationId: "app", channelId: "chan" });

  assert.equal(capturedCommand, "bash");
  assert.ok(Array.isArray(capturedArgs));
  assert.ok(!capturedArgs.some((a) => a === "systemd-run"));
  assert.equal(capturedOptions.detached, true);
  // The plain-spawn fallback is a direct child (no D-Bus hop), so passing
  // the file path via env (not the raw URL -- same file-based convention
  // as the systemd-run path, for consistency) is sufficient here too.
  const filePath = capturedOptions.env.DISCORD_WEBHOOK_URL_FILE;
  assert.ok(filePath, "must pass the webhook-url file path via env");
  const fileContent = readFileSync(filePath, "utf8");
  assert.ok(fileContent.includes("tok2"));
  assert.equal(result.pid, 54321);
  __resetHasCommandImplForTests();
});

// [Audit fix: Security, MEDIUM round 4] If self-update.sh never actually
// starts (spawnImpl throws synchronously here, or the OS can't find the
// binary), self-update.sh's own trap-based cleanup never runs -- proves
// runSelfUpdate() itself cleans up the 0600 webhook secret file in that
// case, rather than orphaning it on disk.
test("runSelfUpdate: cleans up the webhook temp file if spawning self-update.sh fails synchronously", async () => {
  let capturedWebhookFile = null;
  __setSpawnImplForTests((command, args, options) => {
    capturedWebhookFile = options.env.DISCORD_WEBHOOK_URL_FILE;
    throw new Error("spawn ENOENT");
  });
  __setHasCommandImplForTests(() => true);

  assert.throws(() => runSelfUpdate({ interactionToken: "tok3", applicationId: "app", channelId: "chan" }), /ENOENT/);

  assert.ok(capturedWebhookFile, "the test must have actually captured a real file path before the throw");
  assert.throws(() => readFileSync(capturedWebhookFile, "utf8"), /ENOENT/, "the webhook temp file must be deleted after a synchronous spawn failure");
  __resetHasCommandImplForTests();
});
```

- [ ] **Step 10: Run to verify it fails**

Run: `node --test test/writeSelfUpdate.test.js`
Expected: FAIL — module doesn't exist.

- [ ] **Step 11: Write `src/writeSelfUpdate.js`**

```js
import { spawn as realSpawn, execFileSync } from "node:child_process";
import { openSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let spawnImpl = realSpawn;
export function __setSpawnImplForTests(fn) { spawnImpl = fn; }
export function __resetSpawnImplForTests() { spawnImpl = realSpawn; }

function realHasCommand(cmd) {
  try {
    execFileSync("bash", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
let hasCommandImpl = realHasCommand;
export function __setHasCommandImplForTests(fn) { hasCommandImpl = fn; }
export function __resetHasCommandImplForTests() { hasCommandImpl = realHasCommand; }

const __dirname = dirname(fileURLToPath(import.meta.url));

// [Audit fix: Network, HIGH round 2] Round 1's design described a
// systemd-run-unavailable fallback (plain spawn) only in prose -- no code
// implemented it, and this exact scenario is plausible: systemd-run (no
// --user flag, deliberately -- it targets the SYSTEM manager instance so
// the escaped scope survives the bot's own process dying) may require
// root/polkit authorization the "bot" user does not have. That specific
// privilege question is still an open pre-implementation checklist item
// in the design doc (section 4a) -- this fallback exists so a missing or
// unauthorized systemd-run degrades to "self-update still runs, with a
// weaker report-back guarantee" rather than "self-update silently does
// nothing."
export function runSelfUpdate({ interactionToken, applicationId, channelId }) {
  const scriptPath = join(__dirname, "..", "scripts", "self-update.sh");
  const logPath = join(__dirname, "..", "runtime", `self-update-${Date.now()}.log`);
  const logFd = openSync(logPath, "a");

  const webhookUrl = applicationId && interactionToken
    ? `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`
    : "";

  // [Audit fix: Security, HIGH round 3] `systemd-run` submits the unit to
  // the systemd MANAGER over D-Bus -- an env var set on the spawn() call
  // below only affects the systemd-run CLIENT process itself, never the
  // scope it creates, so a plain `env: { DISCORD_WEBHOOK_URL }` would
  // never actually reach self-update.sh on this path. The correct
  // mechanism is `--setenv=KEY=VALUE` on systemd-run's own argv -- but
  // putting the raw URL (which embeds a bearer-style interaction token)
  // there would leak it via `ps auxww`/`/proc/<pid>/cmdline` for
  // systemd-run's own process lifetime, the exact leak already closed for
  // curl (see scripts/self-update.sh's report()). Instead: write the URL
  // to a short-lived, 0600 temp file and pass only that file's PATH
  // (never sensitive) via --setenv/env -- matching this codebase's own
  // established _FILE secret-handling convention (Requirement 24).
  // [Audit fix: Architect, LOW round 4] Deliberately under OS tmpdir(),
  // NOT $WORK_DIR/runtime/ (where the deploy lock and the self-update
  // marker file live) -- those two need repo-relative, predictable paths
  // because the marker specifically must survive a process restart and be
  // found again at a known location by the NEW process. This file's
  // entire lifetime is from this line to self-update.sh reading and
  // deleting it moments later, before any restart happens -- it has no
  // reason to live inside the deployed repo tree at all.
  const webhookFile = join(mkdtempSync(join(tmpdir(), "mentat-self-update-")), "webhook-url");
  writeFileSync(webhookFile, webhookUrl, { mode: 0o600 });
  const env = { ...process.env, DISCORD_WEBHOOK_URL_FILE: webhookFile };

  // [Audit fix: Security, MEDIUM round 4] self-update.sh's own trap-based
  // cleanup (scripts/self-update.sh) only runs if that script actually
  // starts executing. If spawnImpl throws synchronously (e.g. the "bash"
  // or "systemd-run" binary is missing) or the spawned process fails to
  // launch at all (an async "error" event -- e.g. ENOENT, or systemd-run
  // rejected by polkit before ever invoking bash), self-update.sh never
  // runs and never reaches its own cleanup -- the 0600 secret file would
  // otherwise be orphaned indefinitely with no reaper.
  function cleanupWebhookFileQuietly() {
    try { unlinkSync(webhookFile); } catch { /* already gone or never existed */ }
    try { rmdirSync(dirname(webhookFile)); } catch { /* not empty or already gone */ }
  }

  const useSystemdRun = hasCommandImpl("systemd-run");
  let child;
  try {
    if (useSystemdRun) {
      // systemd-run --scope: escapes acp-bot.service's own cgroup (see
      // scripts/self-update.sh's header for why this matters -- KillMode=
      // control-group would otherwise kill this script in the same signal
      // that kills the process it's restarting). --setenv carries only the
      // temp-file PATH into the spawned scope's real environment, not the
      // secret itself.
      child = spawnImpl("systemd-run", ["--uid", String(process.getuid?.() ?? "bot"), "--scope", `--setenv=DISCORD_WEBHOOK_URL_FILE=${webhookFile}`, "--", "bash", scriptPath], {
        stdio: ["ignore", logFd, logFd],
        env
      });
    } else {
      console.warn("writeSelfUpdate: systemd-run is unavailable -- falling back to a plain detached spawn. The fast-path webhook report-back in scripts/self-update.sh may be lost if this process is killed alongside the bot during its own restart; the startup marker-file check (src/index.js) is the fallback reporting path for this case.");
      // A plain, directly-spawned child inherits `env` normally (no D-Bus
      // hop), so this path already worked correctly even before this fix --
      // kept on the same file-based convention for consistency, not because
      // it was broken here too.
      child = spawnImpl("bash", [scriptPath], {
        stdio: ["ignore", logFd, logFd],
        env,
        detached: true
      });
    }
  } catch (error) {
    cleanupWebhookFileQuietly();
    throw error;
  }
  child.on?.("error", cleanupWebhookFileQuietly);
  child.unref?.();
  return { pid: child.pid, logPath };
}
```

- [ ] **Step 12: Run to verify it passes**

Run: `node --test test/writeSelfUpdate.test.js`
Expected: PASS.

- [ ] **Step 13: Wire the new-process marker-file check into `src/index.js`**

Near the bot's own startup sequence (after the Discord client is ready), add:

```js
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

function reportSelfUpdateCompletionIfPending() {
  const markerFile = join(process.cwd(), "runtime", "self-update-pending.json");
  if (!existsSync(markerFile)) return;
  try {
    const { webhookUrl, triggeredAt } = JSON.parse(readFileSync(markerFile, "utf8"));
    unlinkSync(markerFile);
    const ageMs = Date.now() - triggeredAt;
    if (ageMs > 15 * 60 * 1000) {
      console.warn("self-update marker found but the webhook token has likely expired (>15min old) -- not attempting the follow-up.");
      return;
    }
    if (!webhookUrl) return;
    fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: `✅ Self-update complete. Now running on the latest deployed code.` })
    }).catch(() => {});
  } catch {
    // marker file corrupt/unreadable -- nothing to report, don't crash startup over it
  }
}
```

Call `reportSelfUpdateCompletionIfPending()` once, early in the bot's real startup sequence (find the exact place `src/index.js` does its own "bot is ready" logging and call it there).

- [ ] **Step 14: Add `runtime/` to `.gitignore` if not already covered**

Run: `grep -n "^runtime" .gitignore || echo "runtime/" >> .gitignore`

- [ ] **Step 15: Run the full mentat suite**

Run: `npm test` and `bats test/*.bats`
Expected: no regressions, all new tests pass.

- [ ] **Step 16: Commit**

```bash
git add scripts/lib/deploy-core.sh scripts/deploy-post-receive.sh scripts/self-update.sh src/writeSelfUpdate.js src/config.js src/index.js test/self-update.bats test/writeSelfUpdate.test.js test/config.test.js .gitignore
git commit -m "feat(write): add bot self-update, gated by a dedicated host-operator identity

Fixes 4 Layer 1 audit findings against the original design: (1) CRITICAL
cross-tenant privilege escalation -- self-update now requires
DUNE_BOT_OPERATOR_DISCORD_USER_ID to match exactly, never the generic
per-guild owner tier a multi-tenant deployment grants per-guild; (2) the
detached child likely died in the same restart it triggered before it
could report success -- now escapes acp-bot.service's cgroup via
systemd-run --scope, plus a second, independent reporting layer (the new
process itself checks a marker file on startup); (3) the webhook token
moved from argv (visible via ps/proc) to env; (4) a lock file prevents a
concurrent git-push deploy and Discord-triggered self-update from racing
the same working directory. Bats tests now genuinely observe restart
behavior via stubbed sudo/systemctl, closing a tautology in the original
test design."
```

---

### Task 7: mentat — Discord command registration: merge into existing groups + real dispatch routing

**Files:**
- Modify: `src/commands.js`
- Test: `test/commands.test.js` (or the real existing command-registration test file — find via `grep -rln "buildDuneCommand" test/`)

**Interfaces:**
- Consumes: `WRITE_ACTIONS`/`findWriteAction` (Task 3).
- Produces: `buildDuneCommand()` gains 6 genuinely new top-level subcommand groups (`base`, `map`, `carepackage`, `guild`, `operations`, `bot`) and extends the 2 EXISTING groups (`player`, `server`) with new subcommands, generated mechanically from `WRITE_ACTIONS`; the existing `write` group loses its 3 superseded subcommands (`backup`, `restart`, `update`), keeping the 9 that remain genuinely deferred (`LEGACY_WRITE_STUBS`, Task 4). `executeDuneCommand` gains a real dispatch branch routing any `(group, subcommand)` pair `findWriteAction` recognizes to `handleWriteCommand`, regardless of whether that group is new or merged-into-existing.

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDuneCommand } from "../src/commands.js";
import { WRITE_ACTIONS, findWriteAction } from "../src/writeActions.js";

test("buildDuneCommand: registers every WRITE_ACTIONS entry as a subcommand of its real group -- merged into player/server, new for the rest", () => {
  const built = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  // type 2 = ApplicationCommandOptionType.SubcommandGroup (verified against
  // discord-api-types, the real dependency this codebase already uses).
  const registeredGroups = new Map(built.options.filter((o) => o.type === 2).map((g) => [g.name, g]));

  const groupNames = new Set(WRITE_ACTIONS.map((e) => e.group));
  for (const groupName of groupNames) {
    assert.ok(registeredGroups.has(groupName), `missing subcommand group: ${groupName}`);
    const registeredSubcommands = new Set(registeredGroups.get(groupName).options.map((s) => s.name));
    for (const entry of WRITE_ACTIONS.filter((e) => e.group === groupName)) {
      assert.ok(registeredSubcommands.has(entry.name), `group ${groupName} missing subcommand: ${entry.name}`);
    }
  }

  // [Audit fix: Architect, CRITICAL] player/server must have EXACTLY ONE
  // registered group each (the existing one, extended) -- not two.
  const allGroupNamesInPayload = built.options.filter((o) => o.type === 2).map((g) => g.name);
  assert.equal(allGroupNamesInPayload.filter((n) => n === "player").length, 1);
  assert.equal(allGroupNamesInPayload.filter((n) => n === "server").length, 1);

  // player/server must ALSO still have their pre-existing read subcommands
  // (proves this is a merge, not a silent replacement).
  const playerSubcommands = new Set(registeredGroups.get("player").options.map((s) => s.name));
  assert.ok(playerSubcommands.has("link"), "merging write subcommands into player must not drop its existing read subcommands");
  const serverSubcommands = new Set(registeredGroups.get("server").options.map((s) => s.name));
  assert.ok(serverSubcommands.has("health"), "merging write subcommands into server must not drop its existing read subcommands");
});

test("buildDuneCommand: total subcommand-group count stays under Discord's 25-group ceiling", () => {
  const built = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  const groupCount = built.options.filter((o) => o.type === 2).length;
  assert.ok(groupCount <= 25, `${groupCount} subcommand groups exceeds Discord's limit`);
});

test("executeDuneCommand dispatch: findWriteAction recognizes both a merged group (player) and a new group (base)", () => {
  assert.ok(findWriteAction("player", "kick"));
  assert.ok(findWriteAction("base", "refill-generators"));
  assert.equal(findWriteAction("player", "link"), null, "existing read subcommands are not write actions");
});

// [Audit fix: Security, MEDIUM round 3] The 3 legacy "write" group
// subcommands superseded by a real new command elsewhere (backup,
// restart, update) must be removed from the real write group builder, not
// left as a dead second name for the same action -- per the design doc's
// own explicit principle (line 149).
test("buildDuneCommand: the legacy 'write' group no longer registers the 3 superseded subcommand names, but keeps the 9 still-deferred ones", () => {
  const built = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  const registeredGroups = new Map(built.options.filter((o) => o.type === 2).map((g) => [g.name, g]));
  const writeSubcommands = new Set(registeredGroups.get("write").options.map((s) => s.name));
  for (const superseded of ["backup", "restart", "update"]) {
    assert.ok(!writeSubcommands.has(superseded), `write:${superseded} is superseded by a real new command and must be removed`);
  }
  for (const stillDeferred of ["maintenance-note", "maintenance-window", "alert-channel", "alert-threshold", "digest-schedule", "post-schedule", "add-channel", "remove-channel", "cache"]) {
    assert.ok(writeSubcommands.has(stillDeferred), `write:${stillDeferred} has no real backing feature yet and must stay registered`);
  }
  assert.equal(writeSubcommands.size, 9);
});

// [Audit fix: Architect, MEDIUM round 4] There are now THREE
// independently-maintained sources of "the 9 legacy write-group names":
// `LEGACY_WRITE_STUBS` (src/writeHandler.js), the real hand-written
// `.addSubcommand(...)` calls in commands.js's write group builder, and
// the hardcoded list in the test immediately above -- none of which were
// ever programmatically compared. A future edit to any ONE of them (a
// rename, an add, a removal) could pass all three test suites in
// isolation while `findLegacyWriteStub`'s name lookup silently breaks
// (dead code, or "Unknown write command" for a real Discord subcommand).
// This test cross-checks the first two directly against each other.
test("buildDuneCommand: the registered write-group names and LEGACY_WRITE_STUBS's names are exactly the same set", async () => {
  const { LEGACY_WRITE_STUBS } = await import("../src/writeHandler.js");
  const built = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  const registeredGroups = new Map(built.options.filter((o) => o.type === 2).map((g) => [g.name, g]));
  const writeSubcommands = new Set(registeredGroups.get("write").options.map((s) => s.name));
  const legacyStubNames = new Set(LEGACY_WRITE_STUBS.map((s) => s.name));
  assert.deepEqual([...writeSubcommands].sort(), [...legacyStubNames].sort(), "commands.js's write group and writeHandler.js's LEGACY_WRITE_STUBS have drifted apart");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/commands.test.js`
Expected: FAIL.

- [ ] **Step 3: Add a mechanical subcommand-adder and call it once per group, merging into `player`/`server`**

In `src/commands.js`, add near the top:

```js
import { WRITE_ACTIONS, findWriteAction } from "./writeActions.js";

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

function addWriteSubcommands(groupBuilder, groupName) {
  for (const entry of WRITE_ACTIONS.filter((e) => e.group === groupName)) {
    groupBuilder.addSubcommand((c) => {
      c.setName(entry.name).setDescription(entry.desc);
      for (const param of entry.params) addOptionToSubcommand(c, param);
      return c;
    });
  }
  return groupBuilder;
}
```

**Merge into the existing `player` group builder** (find its real `.addSubcommandGroup((g) => g.setName("player")...)` call in `buildDuneCommand`, per this plan's own research: it currently chains `.addSubcommand(...)` calls for `link`/`verify`/etc.).

`[Audit fix: Architect, MEDIUM round 2]` — the existing callback is **expression-bodied** (`(g) => g.setName("player").addSubcommand(...).addSubcommand(...)` — a single chained expression with an implicit return, no `{ }` block, no explicit `return`). You cannot "add a line inside" an expression body; it must first become a block body. Concretely, given the real existing shape (illustrative — match the actual chain length/subcommand names found in the file):

```js
// BEFORE (expression-bodied, implicit return):
.addSubcommandGroup((g) => g.setName("player").setDescription("...")
  .addSubcommand((s) => s.setName("link")...)
  .addSubcommand((s) => s.setName("verify")...)
  // ...remaining existing .addSubcommand(...) calls, unchanged...
)

// AFTER (converted to a block body -- same chain, now with braces and an explicit return, plus the new call):
.addSubcommandGroup((g) => {
  g.setName("player").setDescription("...")
    .addSubcommand((s) => s.setName("link")...)
    .addSubcommand((s) => s.setName("verify")...);
    // ...remaining existing .addSubcommand(...) calls, unchanged, still chained off g...
  addWriteSubcommands(g, "player");
  return g;
})
```

Apply the same conversion (expression body → block body, existing chain preserved verbatim, `addWriteSubcommands(g, "player")` appended, explicit `return g;` added) to the real callback in `src/commands.js` — do not rewrite or reorder any of the existing `.addSubcommand(...)` calls, only wrap them and append.

**Merge into the existing `server` group builder** the same way — convert its expression body to a block body identically, preserve its existing subcommand chain verbatim, then append `addWriteSubcommands(g, "server");` and `return g;`.

**Remove the 3 superseded subcommands from the existing `write` group builder** `[Audit fix: Security, MEDIUM round 3]` — per the design doc's own explicit principle (line 149: "`operations:restart-service` is removed from `WRITE_COMMANDS`, not kept as a second command... shipping two command names for one action is a real, avoidable source of confusion, not a feature"), applied consistently to all 3 subcommands that now have a real new home, not just `restart`: find the existing `write` group builder's three `.addSubcommand(...)` calls whose `.setName(...)` is `"backup"`, `"restart"`, and `"update"` respectively (the real file's callback parameter is named `c`, not `s` — match by the literal subcommand name passed to `.setName(...)`, not the lambda parameter identifier) — matching `src/writeHandler.js`'s real, current `WRITE_COMMANDS` entries of the same names — and delete exactly those 3 `.addSubcommand(...)` calls from the chain, leaving the other 9 (`maintenance-note`, `maintenance-window`, `alert-channel`, `alert-threshold`, `digest-schedule`, `post-schedule`, `add-channel`, `remove-channel`, `cache`) untouched — these 9 are exactly `LEGACY_WRITE_STUBS` (Task 4 Step 7). After this change the `write` group has 9 subcommands, not 12; `restart-service` now lives only at `/dune server restart-service`, `create-backup`/`trigger-update` only at `/dune operations create-backup`/`/dune operations trigger-update`.

**Add the 6 genuinely-new groups** — after the existing `if (includeWriteGroup) { ... }` block (which stays, now covering the 9 remaining legacy stub commands after the removal above), add:

```js
  if (includeWriteGroup) {
    for (const groupName of ["base", "map", "carepackage", "guild", "operations", "bot"]) {
      builder.addSubcommandGroup((g) => {
        g.setName(groupName).setDescription(`Write commands: ${groupName} (gated behind DUNE_DISCORD_WRITES_ENABLED).`);
        addWriteSubcommands(g, groupName);
        return g;
      });
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test test/commands.test.js`
Expected: PASS.

- [ ] **Step 5: Add the real dispatch branch — checked before the final "Unknown command" fallback**

In `executeDuneCommand`, find the existing `else if (group === "write") { payload = await handleWriteCommand(...); }` branch and the final `else { payload = { ok: false, error: ... } }` fallback. Add a NEW branch between them:

```js
    // ── new real write-command groups (issue: write command reconciliation) ──
    // Table-driven, not group-name-driven [Audit fix: Architect, CRITICAL]:
    // this recognizes BOTH genuinely-new groups (base/map/carepackage/
    // guild/operations/bot) and write subcommands merged into the
    // EXISTING player/server groups, uniformly, via one lookup -- no
    // hardcoded list of "which group names are write-capable" to keep in
    // sync as new actions are added.
    else if (findWriteAction(group, subcommand)) {
      payload = await handleWriteCommand({ subcommand, group, interaction, adapterClient, config, guildId, db });
    }
```

Also update the EXISTING `group === "write"` branch to pass `group` too (it currently only passes `subcommand`): `payload = await handleWriteCommand({ subcommand, group, interaction, adapterClient, config, guildId, db });` — confirm `const group = interaction.options.getSubcommandGroup() || "";` is already in scope at this call site (it is, per this plan's own research into the real file).

- [ ] **Step 6: Run to verify tests pass, and confirm the OLD player/server read commands still dispatch correctly**

Run: `node --test test/commands.test.js`
Expected: PASS. Also run the full existing command-dispatch test suite (`npm test` broadly, or whatever specifically covers `executeDuneCommand`'s existing `player:link`/`server:health`-style branches) to confirm merging write subcommands into these two groups didn't disturb their existing dispatch — the new `findWriteAction` branch must sit AFTER every existing specific `key === "..."` branch, never intercepting an existing read command.

- [ ] **Step 7: Verify the built command JSON is valid discord.js output (no live registration)**

Run: `node -e 'import("./src/commands.js").then(m => { const json = m.buildDuneCommand({includeWriteGroup:true}).toJSON(); console.log("groups:", json.options.filter(o=>o.type===2).length); })'`
Expected: runs without throwing, prints a group count ≤ 25.

- [ ] **Step 8: Commit**

```bash
git add src/commands.js test/commands.test.js
git commit -m "feat(write): register the new write commands, merged into existing player/server groups where they'd otherwise collide

Fixes 2 Layer 1 audit CRITICAL findings: the original design proposed
NEW player/server subcommand groups that collide with the two EXISTING
groups of those names (breaking Discord's atomic command-registration
call for the whole bot), and had no dispatch routing at all for the new
group names (every new command would have been 'Unknown command').
Dispatch now checks the shared WRITE_ACTIONS table directly rather than
hardcoding which group names are write-capable."
```

---

### Task 8: mentat — governance documentation: RFC, roadmap, tracked issue, stale in-code claim, CHANGELOG

**Files:**
- Modify: `docs/upstream-write-adapter-rfc.md`
- Modify: `docs/r1-r2-release-roadmap.md`
- Modify: `src/writeConfirmation.js` (module header)
- Modify: `src/writeHandler.js` (module header)
- Modify: `test/r1R2ReleaseRoadmap.test.js`
- Modify: `CHANGELOG.md`

**Interfaces:** none (documentation/test-text only).

- [ ] **Step 1: File the tracked issue first**

Run: `gh issue create --repo Project-Arrakis/mentat --title "Override upstream-write-adapter-rfc.md and r1-r2-release-roadmap.md gates for the write-command reconciliation" --label security --body "<link docs/design/write-command-reconciliation-l1-design-2026-09-22.md, state the operator's 2026-09-22 decision, list the scope this covers (27 real actions + self-update) and what remains genuinely deferred>"`

Record the returned issue number — reference it in Step 2 and Step 3's doc text below (replace `<issue>` with the real number).

- [ ] **Step 2: Update the RFC's Status section**

In `docs/upstream-write-adapter-rfc.md`, add immediately after the existing `## Status` heading's first paragraph:

```markdown
**Update (2026-09-22, operator decision, tracked in #<issue>):** the "do not implement" gate above is overridden for the 27 real write commands listed in `docs/design/write-command-reconciliation-l1-design-2026-09-22.md` (Core's real, audited `dune-awakening-selfhost-docker`#215/#1026 actions, plus bot self-update). This RFC's original concern — a public write-capable adapter contract for arbitrary third-party bots — remains unresolved and is a separate question from this operator's own single Core+bot deployment choosing to use its own, now-real write bridge. The 8 actions with no real backing feature anywhere (`maintenance:*`/`notifications:*`/`schedule:*`) and `operations:clear-cache` remain genuinely blocked, unrelated to the upstream-contract question this RFC is about.
```

- [ ] **Step 3: Update the roadmap's R2 Entry Criteria section**

`[Audit fix: GRC, HIGH]` — Revision 1 missed this document entirely; its own R2 Entry Criteria explicitly name "service restart as the first write command" and "player moderation" as blocked, which is exactly what this plan ships. Read `docs/r1-r2-release-roadmap.md` in full first, then add, immediately after its R2 Entry Criteria list:

```markdown
**Update (2026-09-22, operator decision, tracked in #<issue>):** the entry criteria above are overridden for the scope in `docs/design/write-command-reconciliation-l1-design-2026-09-22.md` — service restart and player moderation, specifically named as blocked above, are now implemented. This is the same override recorded in `docs/upstream-write-adapter-rfc.md`; both documents' gates covered the same underlying decision from two different angles. The remaining, still-genuinely-blocked scope (maintenance/notifications/schedule stub actions, clear-cache) is unaffected.
```

- [ ] **Step 4: Update `test/r1R2ReleaseRoadmap.test.js`**

Read the test's current assertion (it checks the doc's text is unchanged, e.g. "still contains 'must not add commands that mutate server state'"). Update it to assert the POST-override text instead — it should now assert that the override note from Step 3 is present, not that the pre-override blocking language is still the doc's last word on the subject. Do not delete this test's underlying purpose (catching *unintended* future drift in this doc) — only update what "the correct current state" means.

- [ ] **Step 5: Run to verify it passes**

Run: `node --test test/r1R2ReleaseRoadmap.test.js`

- [ ] **Step 6: Fix the stale safety-boundary comment in `writeConfirmation.js`**

`[Audit fix: GRC, HIGH]` — this exact file's own header makes a direct, in-file claim ("NEVER calls adapterClient.writePreview()...") that becomes false the moment Task 5 ships. Replace the module header comment:

```js
// Write Confirmation UI — builds the Discord button-based confirmation
// prompt and routes the resulting button interactions to Core's real
// write/execute (see docs/design/write-command-reconciliation-l1-design-2026-09-22.md).
// bot.self-update is the one exception: it never calls Core at all (see
// writeSelfUpdate.js) and is gated by a dedicated host-operator identity
// check, not the generic per-guild tier system every other command uses.
```

- [ ] **Step 7: Fix `writeHandler.js`'s stale module header**

```js
// Write Command Handler — validates, confirms, audits write operations.
// 27 real actions (docs/design/write-command-reconciliation-l1-design-2026-09-22.md)
// call Core's real write/preview -> write/execute, or (bot.self-update
// only) a dedicated local restart mechanism. The 12 original
// maintenance/notifications/schedule/cache scaffold entries remain
// stubbed (no real backing feature anywhere -- see that design doc
// section 5). All commands still require DUNE_DISCORD_WRITES_ENABLED=true.
```

- [ ] **Step 8: Add a CHANGELOG entry**

`[Audit fix: GRC, LOW]` — Revision 1 omitted this entirely despite `CHANGELOG.md` being actively maintained for changes much smaller than this one. Add an `## Unreleased` (or the repo's real current heading — check `CHANGELOG.md`'s actual top section first) entry:

```markdown
### Added

- **27 real Discord write commands** wired to Core's write bridge (`dune-awakening-selfhost-docker`#215/#1026): player moderation (kick/ban/unban/warn/give-item/clear-backpack/fill-water), base management, server control (restart/stop/start/restart-service — stop requires a second, different owner-tier admin to confirm), map control, care packages, guild membership, and operations (backup/game-update/steamcmd-fix). Overrides `docs/upstream-write-adapter-rfc.md` and `docs/r1-r2-release-roadmap.md`'s prior "do not implement" gates for this scope — see #<issue>.
- **Bot self-update** (`/dune bot self-update`), restricted to a single, explicitly-configured host-operator Discord user ID (`DUNE_BOT_OPERATOR_DISCORD_USER_ID`) — never the generic per-guild owner tier, since this bot is multi-tenant and self-update restarts the one shared process. Reuses the existing git-push deploy pipeline's test-gated safety guardrails.
```

- [ ] **Step 9: Run the full mentat suite one more time**

Run: `npm test` and `bats test/*.bats`

- [ ] **Step 10: Commit**

```bash
git add docs/upstream-write-adapter-rfc.md docs/r1-r2-release-roadmap.md test/r1R2ReleaseRoadmap.test.js src/writeConfirmation.js src/writeHandler.js CHANGELOG.md
git commit -m "docs(write): record the operator's override of both governing gates, fix stale in-code safety-boundary claims, add CHANGELOG entry

Layer 1 GRC hat found docs/r1-r2-release-roadmap.md is a SECOND,
test-enforced gate that explicitly blocks 'service restart' and 'player
moderation' by name -- exactly this plan's first two moves -- and was
missed entirely in the first design revision. Also fixes
writeConfirmation.js's own module header, which claimed confirming a
write action 'NEVER calls adapterClient.writePreview()/writeExecute()'
-- a direct, in-file false claim once this same file is rewired."
```

---

### Task 9: Re-verify against Core's real branch, push, open the mentat PR, verify CI

- [ ] **Step 1: Re-diff `writeActions.js` against Core's then-current tables**

`[Audit fix: GRC/Architect, MEDIUM]` — before marking this PR ready (not before every commit): fetch the current tip of Core's `issue/215-write-bridge` (or wherever it has landed by then) and re-run `writeActions.js`'s own consistency tests against the real, current `WRITE_ACTION_ROUTES`/`WRITE_ACTION_MIN_TIER` shapes. A drift here produces a misleading Discord UI (wrong tier gate, wrong/missing confirm phrase), not a security bypass (Core enforces server-side regardless) — but should be caught and fixed before this leaves draft, not discovered in production.

- [ ] **Step 2: Fetch and check for divergence before pushing**

Run: `git fetch origin && git log --oneline HEAD..origin/docs/write-command-reconciliation`
Expected: no output.

- [ ] **Step 3: Push**

Run: `git push origin docs/write-command-reconciliation`

- [ ] **Step 4: Update PR #395's body**

Run: `gh pr edit 395 --repo Project-Arrakis/mentat --title "feat(write): wire mentat to Core's real write bridge" --body "<comprehensive body: what changed, the 28 commands, the self-update host-operator gate and its safety-guardrail reuse, dependency on dune-awakening-selfhost-docker#1026 merging first, the tracked governance-override issue, test output, and the Layer 1 audit findings this revision fixes>"`

Remove `--draft` only once CI is green AND the re-audit (below) confirms the fixes above.

- [ ] **Step 5: Check CI**

Run: `gh run list --repo Project-Arrakis/mentat --branch docs/write-command-reconciliation --limit 5`
Fix any failure the same way Task 1-8's own test steps would have caught it locally.

---

## Plan Self-Review Notes (Revision 2)

- Every CRITICAL and HIGH finding from the Layer 1 eight-hat audit against Revision 1 is fixed inline above, at its exact location, marked `[Audit fix: <hat>, <severity>]`.
- A second, narrower re-audit of Tasks 3-8 (the changed sections) is required before implementation begins — per the plan of record agreed with the user, this happens as a separate step after this revision, not folded into this document.
- Every task's tests use a fake/injected `adapterClient`, `spawn`, or stubbed shell command (`sudo`/`systemctl`) — no task requires a live Core instance, a live Discord connection, or a live systemd unit to pass its own test suite.
- The existing `write` group (12 stub entries) and its hand-written builder are never modified — confirmed by Task 7 Step 3 explicitly preserving that block untouched.
- Task 3's own tests are the load-bearing regression guard against Revision 1's exact QA-hat-found bugs (wrong count, wrong action-name assertion) — Step 4 explicitly says not to proceed until they're run and genuinely pass.
