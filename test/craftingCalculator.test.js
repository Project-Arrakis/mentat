import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCraftingPlan, walkRecipeTree, MIN_QUANTITY, MAX_QUANTITY } from "../src/craftingCalculator.js";

function totalOf(plan, resource) {
  return plan.totalRawMaterials.find((r) => r.resource === resource)?.quantity ?? 0;
}

test("non-nested recipe: Copper Ingot x5, large tier -- flat multiplication", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  assert.equal(plan.crafts, 5);
  assert.equal(totalOf(plan, "copper_ore"), 10);
  assert.equal(plan.leftover, 0);
});

test("nested recipe: Plastanium Ingot x25, large tier, no contract -- matches the verified worked example exactly", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large", craftingContract: false });
  assert.equal(plan.crafts, 25);
  assert.equal(totalOf(plan, "water"), 33750);
  assert.equal(totalOf(plan, "titanium_ore"), 100);
  assert.equal(totalOf(plan, "stravidium_mass"), 75);
  assert.equal(plan.totalTimeSeconds, 25 * 20 + 25 * 10);
  assert.ok(plan.nestedCrafts.stravidium_fiber, "must report the nested Stravidium Fiber craft");
  assert.equal(plan.nestedCrafts.stravidium_fiber.crafts, 25);
});

test("same recipe with craftingContract:true matches the verified worked example exactly -- ceiling rounding per ingredient per craft", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large", craftingContract: true });
  // Direct: water ceil(1250*0.75)=938 * 25 = 23450; nested: water ceil(100*0.75)=75 * 25 = 1875
  assert.equal(totalOf(plan, "water"), 23450 + 1875);
  assert.equal(totalOf(plan, "titanium_ore"), 3 * 25); // ceil(4*0.75)=3
  // Stravidium Mass unaffected by rounding: ceil(3*0.75)=ceil(2.25)=3, unchanged from the no-contract case
  assert.equal(totalOf(plan, "stravidium_mass"), 3 * 25);
});

test("multi-output recipe: Low-grade Lubricant x12 (output x5/craft) -- crafts=3, totalOut=15, leftover=3", () => {
  const plan = calculateCraftingPlan("low_grade_lubricant", 12, { stationTier: "medium" });
  assert.equal(plan.crafts, 3);
  assert.equal(plan.crafts * 5, 15);
  assert.equal(plan.leftover, 3);
});

test("quantity boundary: exactly 1 and exactly 100000 succeed", () => {
  assert.doesNotThrow(() => calculateCraftingPlan("copper_ingot", MIN_QUANTITY, { stationTier: "large" }));
  assert.doesNotThrow(() => calculateCraftingPlan("copper_ingot", MAX_QUANTITY, { stationTier: "large" }));
});

test("quantity boundary: 0, negative, over-max, non-integer, non-numeric all reject with a typed error", () => {
  for (const bad of [0, -1, MAX_QUANTITY + 1, 1.5, NaN, "25", null, undefined]) {
    assert.throws(() => calculateCraftingPlan("copper_ingot", bad, { stationTier: "large" }), Error, `quantity=${bad} should throw`);
  }
});

test("unknown item key rejects with a typed, catchable error", () => {
  assert.throws(() => calculateCraftingPlan("not_a_real_item", 5, {}), /Unknown item/);
});

test("station-tier with no known variant for the item returns an explicit error, never a silent fallback", () => {
  assert.throws(() => calculateCraftingPlan("plastanium_ingot", 5, { stationTier: "small" }), /no recipe variant at this tier/i);
  assert.throws(() => calculateCraftingPlan("stravidium_fiber", 5, { stationTier: "large" }), /no recipe variant at this tier/i);
});

test("nested craftable input uses the SAME tier as the parent when that tier genuinely exists for it (steel_ingot/large -> iron_ingot/large)", () => {
  const plan = calculateCraftingPlan("steel_ingot", 10, { stationTier: "large" });
  assert.equal(plan.nestedCrafts.iron_ingot.stationTier, "large", "iron_ingot has a real large variant and must use it, not silently fall back to another tier");
  // Cross-check the actual numbers too, not just the tier label: large-tier
  // steel needs Water x50/craft + Carbon Ore x2/craft + Iron Ingot x1/craft;
  // large-tier iron needs Water x25/craft + Iron Ore x3/craft (per
  // src/craftingData.js). Water is pooled from BOTH levels (steel's own
  // direct input plus iron_ingot's nested input), matching the same
  // additive-pooling behavior already verified by the Plastanium worked
  // example above -- 10*25 alone (ignoring steel's own water requirement)
  // would be wrong.
  const totalOf = (resource) => plan.totalRawMaterials.find((r) => r.resource === resource)?.quantity ?? 0;
  assert.equal(totalOf("carbon_ore"), 10 * 2);
  assert.equal(totalOf("iron_ore"), 10 * 3); // would be 10*4 or 10*5 if it wrongly fell back to medium/small
  assert.equal(totalOf("water"), 10 * 50 + 10 * 25);
});

test("nested tier resolution is exact-match-first, not first-declared-key: steel_ingot/small -> iron_ingot/small", () => {
  // iron_ingot's variants are declared large, medium, small (in that order)
  // in src/craftingData.js -- requesting steel_ingot at "large" alone can't
  // distinguish correct exact-match-first behavior from a regressed
  // always-use-first-declared-tier bug, since both happen to yield "large"
  // there. Requesting "small" instead makes the two behaviors diverge:
  // first-declared-key would wrongly produce "large", exact-match-first
  // correctly produces "small".
  const plan = calculateCraftingPlan("steel_ingot", 10, { stationTier: "small" });
  assert.equal(plan.nestedCrafts.iron_ingot.stationTier, "small", "iron_ingot has a real small variant and must use it, not fall back to its first-declared tier (large)");
  const totalOf = (resource) => plan.totalRawMaterials.find((r) => r.resource === resource)?.quantity ?? 0;
  // small-tier steel: Water 50, Carbon Ore 4/craft, Iron Ingot 1/craft;
  // small-tier iron: Water 25, Iron Ore 5/craft (per src/craftingData.js).
  assert.equal(totalOf("carbon_ore"), 10 * 4);
  assert.equal(totalOf("iron_ore"), 10 * 5); // would be 10*3 if it wrongly used iron_ingot's large variant
  assert.equal(totalOf("water"), 10 * 50 + 10 * 25);
});

test("a synthetic circular-dependency fixture throws rather than hanging or stack-overflowing", () => {
  // Constructed only within this test -- never added to real craftingData.js.
  // walkRecipeTree() takes `recipes` as its last parameter (defaulting to
  // the real CRAFTING_RECIPES for every production call site -- see Step 3),
  // specifically so this cycle guard is testable without needing the real,
  // deliberately-acyclic production data to contain a cycle.
  const cyclicRecipes = {
    item_a: { displayName: "A", outputPerCraft: 1, variants: { large: { station: "Test", craftTimeSeconds: 1, inputs: [{ resource: "item_b", quantity: 1, craftable: true }] } } },
    item_b: { displayName: "B", outputPerCraft: 1, variants: { large: { station: "Test", craftTimeSeconds: 1, inputs: [{ resource: "item_a", quantity: 1, craftable: true }] } } }
  };
  assert.throws(() => walkRecipeTree("item_a", 5, "large", false, cyclicRecipes), /circular/i);
});
