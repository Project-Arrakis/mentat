import assert from "node:assert/strict";
import { test } from "node:test";
import { CRAFTING_RECIPES, LEAF_RESOURCES } from "../src/craftingData.js";
import { RECIPE_KEY_TO_GAME_ITEM_ID, GAME_ITEM_ID_TO_RECIPE_KEY } from "../src/gameItemIdBridge.js";
import { GAME_ITEM_CATALOG_BY_ID } from "../src/gameItemCatalog.js";

const ALL_RECIPE_AND_LEAF_KEYS = [...Object.keys(CRAFTING_RECIPES), ...Object.keys(LEAF_RESOURCES)];

// "water" has no discrete inventory-item entry anywhere in the game's own
// catalog (verified against both the deduplicated vendored copy and the
// full 2,558-row source -- see src/gameItemIdBridge.js's own comment and
// task-2-report.md for the full search list). This is a confirmed,
// documented exception, not a gap to be silently tolerated -- tracked
// explicitly here so it can never regress into an accidental omission.
const UNMAPPABLE_LEAF_KEYS = new Set(["water"]);
const MAPPABLE_RECIPE_AND_LEAF_KEYS = ALL_RECIPE_AND_LEAF_KEYS.filter((key) => !UNMAPPABLE_LEAF_KEYS.has(key));

test("RECIPE_KEY_TO_GAME_ITEM_ID and GAME_ITEM_ID_TO_RECIPE_KEY are real Maps", () => {
  assert.ok(RECIPE_KEY_TO_GAME_ITEM_ID instanceof Map);
  assert.ok(GAME_ITEM_ID_TO_RECIPE_KEY instanceof Map);
});

test("every mappable CRAFTING_RECIPES/LEAF_RESOURCES key has a real, catalog-verified game item id", () => {
  for (const key of MAPPABLE_RECIPE_AND_LEAF_KEYS) {
    const gameItemId = RECIPE_KEY_TO_GAME_ITEM_ID.get(key);
    assert.ok(gameItemId, `${key} is missing from RECIPE_KEY_TO_GAME_ITEM_ID`);
    assert.ok(GAME_ITEM_CATALOG_BY_ID.has(gameItemId), `${key} -> "${gameItemId}" is not a real id in GAME_ITEM_CATALOG_BY_ID`);
  }
});

test("RECIPE_KEY_TO_GAME_ITEM_ID has no extra entries beyond the mappable CRAFTING_RECIPES + LEAF_RESOURCES keys", () => {
  assert.equal(RECIPE_KEY_TO_GAME_ITEM_ID.size, MAPPABLE_RECIPE_AND_LEAF_KEYS.length);
});

test("water is a documented exception, not silently missing", () => {
  assert.equal(RECIPE_KEY_TO_GAME_ITEM_ID.has("water"), false);
});

test("GAME_ITEM_ID_TO_RECIPE_KEY correctly round-trips every forward entry", () => {
  for (const [recipeKey, gameItemId] of RECIPE_KEY_TO_GAME_ITEM_ID) {
    assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.get(gameItemId), recipeKey);
  }
  assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.size, RECIPE_KEY_TO_GAME_ITEM_ID.size);
});

test("a non-recipe catalog item (e.g. a weapon) has no entry in the reverse map", () => {
  // "Silicone" IS a recipe item (Silicone Block) -- pick something that
  // definitely isn't: any real catalog id not in RECIPE_KEY_TO_GAME_ITEM_ID's values.
  const recipeGameItemIds = new Set(RECIPE_KEY_TO_GAME_ITEM_ID.values());
  const nonRecipeEntry = [...GAME_ITEM_CATALOG_BY_ID.keys()].find((id) => !recipeGameItemIds.has(id));
  assert.ok(nonRecipeEntry, "test setup problem: could not find any non-recipe catalog item");
  assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.get(nonRecipeEntry), undefined);
});

for (const poisonedKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  test(`GAME_ITEM_ID_TO_RECIPE_KEY.get("${poisonedKey}") returns undefined, not an inherited prototype member`, () => {
    assert.equal(GAME_ITEM_ID_TO_RECIPE_KEY.get(poisonedKey), undefined);
  });
  test(`RECIPE_KEY_TO_GAME_ITEM_ID.get("${poisonedKey}") returns undefined, not an inherited prototype member`, () => {
    assert.equal(RECIPE_KEY_TO_GAME_ITEM_ID.get(poisonedKey), undefined);
  });
}
