import assert from "node:assert/strict";
import { test } from "node:test";
import { CRAFTING_RECIPES, LEAF_RESOURCES, TIER_KEYS } from "../src/craftingData.js";

const ITEM_KEYS = Object.keys(CRAFTING_RECIPES);

test("CRAFTING_RECIPES has exactly 15 items", () => {
  assert.equal(ITEM_KEYS.length, 15);
});

test("every recipe variant has a source.url and source.verifiedAt", () => {
  for (const key of ITEM_KEYS) {
    const recipe = CRAFTING_RECIPES[key];
    assert.ok(recipe.source?.url, `${key} missing source.url`);
    assert.ok(recipe.source?.verifiedAt, `${key} missing source.verifiedAt`);
  }
});

test("every variant key is one of small/medium/large, matching the verified per-item tier availability", () => {
  const expectedTiers = {
    copper_ingot: ["small", "medium", "large"],
    iron_ingot: ["small", "medium", "large"],
    steel_ingot: ["small", "medium", "large"],
    aluminum_ingot: ["medium", "large"],
    duraluminum_ingot: ["medium", "large"],
    plastanium_ingot: ["medium", "large"],
    stravidium_fiber: ["medium"],
    cobalt_paste: ["small", "medium"],
    silicone_block: ["small", "medium"],
    small_fuel_cell: ["small", "medium"],
    medium_fuel_cell: ["small", "medium"],
    large_fuel_cell: ["medium"],
    spice_fuel_cell: ["medium"],
    low_grade_lubricant: ["small", "medium"],
    industrial_lubricant: ["small", "medium"]
  };
  for (const key of ITEM_KEYS) {
    const actualTiers = Object.keys(CRAFTING_RECIPES[key].variants).sort();
    const expected = [...expectedTiers[key]].sort();
    assert.deepEqual(actualTiers, expected, `${key} has tiers [${actualTiers}], expected [${expected}]`);
    for (const tierKey of actualTiers) {
      assert.ok(TIER_KEYS.includes(tierKey), `${key}'s tier key "${tierKey}" is not one of ${TIER_KEYS}`);
    }
  }
});

test("no recipe input has a zero or negative quantity", () => {
  for (const key of ITEM_KEYS) {
    for (const [tierKey, variant] of Object.entries(CRAFTING_RECIPES[key].variants)) {
      for (const input of variant.inputs) {
        assert.ok(input.quantity > 0, `${key}.${tierKey}'s input "${input.resource}" has quantity ${input.quantity}`);
      }
    }
  }
});

test("every input resolves to either a known leaf resource or another known recipe key -- no dangling references", () => {
  const leafKeys = new Set(Object.keys(LEAF_RESOURCES));
  for (const key of ITEM_KEYS) {
    for (const [tierKey, variant] of Object.entries(CRAFTING_RECIPES[key].variants)) {
      for (const input of variant.inputs) {
        const resolvesAsLeaf = leafKeys.has(input.resource);
        const resolvesAsRecipe = ITEM_KEYS.includes(input.resource);
        assert.ok(resolvesAsLeaf || resolvesAsRecipe, `${key}.${tierKey}'s input "${input.resource}" resolves to neither a leaf resource nor a known recipe`);
        assert.equal(input.craftable, resolvesAsRecipe, `${key}.${tierKey}'s input "${input.resource}" has craftable=${input.craftable} but resolvesAsRecipe=${resolvesAsRecipe}`);
      }
    }
  }
});

test("no recipe recurses in a cycle", () => {
  function hasCycle(itemKey, visiting = new Set()) {
    if (visiting.has(itemKey)) return true;
    const recipe = CRAFTING_RECIPES[itemKey];
    if (!recipe) return false; // leaf resource, not a cycle
    visiting.add(itemKey);
    for (const variant of Object.values(recipe.variants)) {
      for (const input of variant.inputs) {
        if (input.craftable && hasCycle(input.resource, visiting)) return true;
      }
    }
    visiting.delete(itemKey);
    return false;
  }
  for (const key of ITEM_KEYS) {
    assert.equal(hasCycle(key), false, `${key} participates in a cycle`);
  }
});

test("the 5 known chained items nest exactly as documented", () => {
  const chained = {
    steel_ingot: "iron_ingot",
    duraluminum_ingot: "aluminum_ingot",
    plastanium_ingot: "stravidium_fiber",
    low_grade_lubricant: "silicone_block",
    industrial_lubricant: "silicone_block"
  };
  for (const [parent, child] of Object.entries(chained)) {
    const hasNestedInput = Object.values(CRAFTING_RECIPES[parent].variants)
      .every((variant) => variant.inputs.some((i) => i.craftable && i.resource === child));
    assert.ok(hasNestedInput, `${parent} does not nest ${child} in every variant`);
  }
});

test("outputPerCraft matches the 3 known multi-output items, 1 for everything else", () => {
  const multiOutput = { spice_fuel_cell: 10, low_grade_lubricant: 5, industrial_lubricant: 10 };
  for (const key of ITEM_KEYS) {
    const expected = multiOutput[key] ?? 1;
    assert.equal(CRAFTING_RECIPES[key].outputPerCraft, expected, `${key} has outputPerCraft ${CRAFTING_RECIPES[key].outputPerCraft}, expected ${expected}`);
  }
});

test("CRAFTING_RECIPES is frozen (cannot be mutated at runtime)", () => {
  assert.throws(() => { CRAFTING_RECIPES.copper_ingot.tier = 999; }, TypeError);
});
