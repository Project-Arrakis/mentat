// index.test.js (mentat#372): a routing-shape test for index.js's new
// isModalSubmit?.() branch. index.js's own interaction listener is
// registered inline via client.on(Events.InteractionCreate, ...) and is
// not itself exported for direct unit testing -- confirmed by reading
// index.js directly (no exported handler function exists). Instead,
// this asserts the same "returns false for a customId/shape it doesn't
// own" contract every other handler in this dispatch chain already has
// a test for, proving neither of the two new handlers swallows an
// interaction meant for its sibling -- the exact bug class a routing
// wiring mistake in index.js would produce.
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
