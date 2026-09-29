import assert from "node:assert/strict";
import { test } from "node:test";
import { GAME_ITEM_CATALOG, GAME_ITEM_CATALOG_BY_ID } from "../src/gameItemCatalog.js";

test("GAME_ITEM_CATALOG parses and has a sane nonzero entry count", () => {
  assert.ok(Array.isArray(GAME_ITEM_CATALOG));
  assert.ok(GAME_ITEM_CATALOG.length > 2000, `expected >2000 entries, got ${GAME_ITEM_CATALOG.length}`);
});

test("GAME_ITEM_CATALOG has zero duplicate ids after dedup", () => {
  const ids = GAME_ITEM_CATALOG.map((e) => e.id);
  const uniqueIds = new Set(ids);
  assert.equal(uniqueIds.size, ids.length, `${ids.length - uniqueIds.size} duplicate id(s) found -- Task 1's dedup step must have been skipped or done wrong`);
});

test("every entry has the required fields", () => {
  for (const entry of GAME_ITEM_CATALOG) {
    assert.equal(typeof entry.id, "string", `entry missing string id: ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.name, "string", `entry ${entry.id} missing string name`);
    assert.equal(typeof entry.category, "string", `entry ${entry.id} missing string category`);
  }
});

test("GAME_ITEM_CATALOG_BY_ID is a real Map, not a plain object, and round-trips every entry", () => {
  assert.ok(GAME_ITEM_CATALOG_BY_ID instanceof Map);
  assert.equal(GAME_ITEM_CATALOG_BY_ID.size, GAME_ITEM_CATALOG.length);
  for (const entry of GAME_ITEM_CATALOG) {
    assert.equal(GAME_ITEM_CATALOG_BY_ID.get(entry.id), entry);
  }
});

// The exact prototype-pollution class already found twice in this codebase
// (FINDING-CALC-3/S-2, and its repeat on PR #417) -- confirm a Map-based
// lookup correctly returns undefined for these instead of an inherited
// Object.prototype member.
for (const poisonedKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  test(`GAME_ITEM_CATALOG_BY_ID.get("${poisonedKey}") returns undefined, not an inherited prototype member`, () => {
    assert.equal(GAME_ITEM_CATALOG_BY_ID.get(poisonedKey), undefined);
  });
}

test("a known real item (Silicone Block's game id) resolves correctly", () => {
  const entry = GAME_ITEM_CATALOG_BY_ID.get("Silicone");
  assert.ok(entry, "expected 'Silicone' (Silicone Block's real game id) to be in the catalog");
  assert.equal(entry.name, "Silicone Block");
});
