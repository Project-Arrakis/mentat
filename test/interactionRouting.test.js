import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

// mentat#332 (comprehensive wizard security audit finding): src/index.js's
// InteractionCreate handler used to unconditionally `return` right after
// calling handleWriteButtonInteraction(), never checking its return value --
// silently swallowing EVERY button interaction whose customId that function
// doesn't own (it only returns true for the "write:"-prefixed space).
//
// src/index.js registers this handler inline via client.on(...) against a
// real discord.js Client -- there's no exported, standalone function to
// call directly in a unit test without a heavier Discord-gateway test
// harness this repo doesn't have. Matching this codebase's own established
// precedent for exactly this situation (see
// discordBotSettingsRoutes.test.js's source-pattern assertions against
// server.js), this test pins the fix at the source level: the handler must
// check handleWriteButtonInteraction()'s return value and fall through
// when it's false, not blindly return.
test("InteractionCreate's button handling checks handleWriteButtonInteraction()'s return value and falls through on false", async () => {
  const src = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

  assert.match(
    src,
    // Task 5 (write-command-reconciliation): handleWriteButtonInteraction()
    // now takes adapterClient as a required second argument -- this pattern
    // is deliberately not anchored to specific trailing arguments (still
    // captures the call regardless of what they're named), only to the
    // "capture the return value" shape mentat#332's fix actually cares about.
    /const handled\s*=\s*await handleWriteButtonInteraction\(interaction\s*,[^)]*\)/,
    "must capture handleWriteButtonInteraction()'s return value, not discard it"
  );
  // [Final-review fix, IMPORTANT 3] config and db are NOT optional extras:
  // handleWriteButtonInteraction() uses canWrite(interaction, config, tier,
  // db, guildId) to verify that whoever clicks a PUBLIC dual-confirmation
  // waiting-state message actually holds the action's tier. Passing them is
  // what makes that check able to return anything but false, so a caller
  // that silently dropped them would re-open the gap (any member could
  // destroy a pending second-step confirmation) while still "working".
  assert.match(
    src,
    /await handleWriteButtonInteraction\(interaction\s*,\s*adapterClient\s*,\s*config\s*,\s*db\s*\)/,
    "must pass config and db through so the second-confirmation tier check can actually run"
  );
  assert.match(
    src,
    /if\s*\(\s*handled\s*\)\s*return;/,
    "must only return early when handleWriteButtonInteraction() actually handled the interaction"
  );

  // Regression guard: the OLD, buggy shape (unconditional return right
  // after the call, no variable capturing the result) must not reappear.
  const buttonBlockStart = src.indexOf("interaction.isButton?.()");
  assert.ok(buttonBlockStart !== -1, "isButton?.() branch must still exist");
  const nextFewLines = src.slice(buttonBlockStart, buttonBlockStart + 300);
  assert.doesNotMatch(
    nextFewLines,
    /await handleWriteButtonInteraction\(interaction\);\s*\n\s*return;/,
    "must not unconditionally return right after calling handleWriteButtonInteraction() -- that silently swallows every other button's customId"
  );
});
