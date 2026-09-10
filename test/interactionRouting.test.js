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
    /const handled\s*=\s*await handleWriteButtonInteraction\(interaction\)/,
    "must capture handleWriteButtonInteraction()'s return value, not discard it"
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
