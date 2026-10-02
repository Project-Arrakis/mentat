import assert from "node:assert/strict";
import { test } from "node:test";
import { handleCalculatorAutocomplete } from "../src/commands.js";

function mockAutocompleteInteraction({ focusedName, focusedValue = "", item = null }) {
  const responded = [];
  return {
    isAutocomplete: () => true,
    commandName: "dune",
    options: {
      getSubcommandGroup: () => "data",
      getSubcommand: () => "calculator",
      getFocused: (full) => (full ? { name: focusedName, value: focusedValue } : focusedValue),
      getString: (name) => (name === "item" ? item : null)
    },
    respond: async (choices) => { responded.push(...choices); },
    _responded: responded
  };
}

test("item autocomplete: case-insensitive substring match against the 15 known items", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "item", focusedValue: "plast" });
  await handleCalculatorAutocomplete(interaction);
  assert.ok(interaction._responded.some((c) => c.value === "plastanium_ingot"));
});

test("on-hand-N autocomplete: with item already selected, suggests only that item's own tree nodes", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "on-hand-1", focusedValue: "", item: "plastanium_ingot" });
  await handleCalculatorAutocomplete(interaction);
  const values = interaction._responded.map((c) => c.value);
  assert.ok(values.includes("titanium_ore"));
  assert.ok(values.includes("stravidium_fiber"));
  assert.ok(!values.includes("copper_ore"), "must not suggest a node outside plastanium's own tree");
});

test("on-hand-N autocomplete: with no item selected yet, returns a single non-selectable placeholder, not an empty list", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "on-hand-1", focusedValue: "", item: null });
  await handleCalculatorAutocomplete(interaction);
  assert.equal(interaction._responded.length, 1);
  assert.match(interaction._responded[0].name, /select an item first/i);
});

// CRAFTING_RECIPES is a plain frozen object, so `!CRAFTING_RECIPES[selectedItem]`
// resolves inherited Object.prototype members ("constructor", "toString", etc.)
// as truthy and bypasses the "no item selected" guard, letting recipeTreeNodes()
// throw uncaught -- a silent-hang bug (no interaction.respond() ever called),
// distinct from the direct-command-path crash of the same underlying defect.
// Confirmed via /code-review high on PR #417.
for (const poisonedKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  test(`on-hand-N autocomplete: prototype-property item "${poisonedKey}" falls back to the placeholder, not an uncaught throw`, async () => {
    const interaction = mockAutocompleteInteraction({ focusedName: "on-hand-1", focusedValue: "", item: poisonedKey });
    await handleCalculatorAutocomplete(interaction);
    assert.equal(interaction._responded.length, 1);
    assert.match(interaction._responded[0].name, /select an item first/i);
  });
}

test("autocomplete response never exceeds Discord's 25-choice cap", async () => {
  const interaction = mockAutocompleteInteraction({ focusedName: "item", focusedValue: "" }); // empty query matches all 15
  await handleCalculatorAutocomplete(interaction);
  assert.ok(interaction._responded.length <= 25);
});
