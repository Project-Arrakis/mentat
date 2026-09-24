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

// mentat#404: server.stop used to be the only entry with
// `requiresDualConfirmation: true`. It was removed because this bot derives
// owner tier exclusively from real Discord guild ownership -- exactly one
// account per guild -- so "a second, DIFFERENT owner-tier admin" could never
// exist and the action was unusable through Discord. The client-side
// second-step machinery in writeConfirmation.js went with it, so re-adding
// this flag to an entry would NOT restore a working flow on its own. This
// test is now a regression guard against exactly that.
test("WRITE_ACTIONS: no entry requires dual confirmation (mentat#404)", () => {
  const dualConfirm = WRITE_ACTIONS.filter((e) => e.requiresDualConfirmation === true);
  assert.deepEqual(dualConfirm, []);
});

test("WRITE_ACTIONS: server.stop's description no longer promises a second confirmer", () => {
  const stop = WRITE_ACTIONS.find((e) => e.action === "server.stop");
  assert.ok(stop);
  assert.equal(stop.tier, "owner", "still owner-tier gated -- only the SECOND confirmation was dropped");
  assert.doesNotMatch(stop.desc, /second|different .*admin|dual/i);
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
