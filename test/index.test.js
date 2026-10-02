// index.test.js (mentat#372): a handler-isolation test, NOT a real test
// of index.js's own wiring (Layer 2 QA-hat finding: an earlier version
// of this header implied it covered index.js's actual dispatch order,
// which it cannot). index.js's interaction listener is registered
// inline via client.on(Events.InteractionCreate, ...), has real
// import-time side effects (loadConfig(), loadRegistryAtStartup() with
// process.exit(1) on failure, new Client(...)), and is not itself
// exported for direct unit testing -- confirmed by reading index.js
// directly. What this file DOES verify: neither
// handleServiceButtonInteraction nor handleServiceModalSubmit swallows
// an interaction shaped for its sibling (the same "returns false for a
// customId/shape it doesn't own" contract every other handler in that
// dispatch chain already has a test for). What it CANNOT catch: a real
// wiring bug in index.js itself -- wrong branch order, or an earlier
// isButton?.()/isChatInputCommand?.() check swallowing a service
// interaction before either new handler is ever reached. Closing that
// gap needs index.js's InteractionCreate callback extracted into an
// exported, directly-testable function -- out of scope for this PR;
// should be filed as its own follow-up issue rather than left implicit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { handleServiceButtonInteraction, handleServiceModalSubmit } from "../src/serviceComponent.js";

test("handleServiceButtonInteraction returns false (not throws) for a modal-submit-shaped interaction", async () => {
  const db = createDatabase(":memory:");
  const modalShapedInteraction = { isButton: () => false, isModalSubmit: () => true, customId: "service:applymodal:water-seller" };
  const handled = await handleServiceButtonInteraction(modalShapedInteraction, db, {});
  assert.equal(handled, false);
});

test("handleServiceModalSubmit returns false (not throws) for a button-shaped interaction", async () => {
  const db = createDatabase(":memory:");
  const buttonShapedInteraction = { isButton: () => true, isModalSubmit: () => false, customId: "service:onduty:water-seller" };
  const handled = await handleServiceModalSubmit(buttonShapedInteraction, db, {});
  assert.equal(handled, false);
});
