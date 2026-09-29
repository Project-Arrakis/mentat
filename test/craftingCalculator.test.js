import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCraftingPlan, walkRecipeTree, applyOnHandCredit, resolveEffectiveOnHandCredit, estimateDuration, recipeTreeNodes, bestAvailableTier, MIN_QUANTITY, MAX_QUANTITY } from "../src/craftingCalculator.js";

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

// walkRecipeTree's `recipes` param (default CRAFTING_RECIPES) is a plain object,
// so a bare bracket-access lookup resolves inherited Object.prototype members
// ("constructor", "toString", etc.) as truthy instead of throwing "Unknown item"
// -- confirmed via /code-review high on PR #417, currently unreachable via the
// one production call path (commands.js always calls recipeTreeNodes() first,
// which has its own guard) but real for any future/direct caller of
// calculateCraftingPlan()/walkRecipeTree(), and for the synthetic-recipe-graph
// test callers this function is explicitly exported to support.
for (const poisonedKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  test(`walkRecipeTree: prototype-property item key "${poisonedKey}" rejects instead of resolving`, () => {
    assert.throws(() => walkRecipeTree(poisonedKey, 5, "large", false), /Unknown item/);
  });
}

// bestAvailableTier() -- picks the largest tier an item actually has, used as
// the default when station-tier is omitted. Verified 2026-09-29 directly
// against dune.gaming.tools' placeables listing: no "Large Chemical
// Refinery" exists in the game at all (only Ore Refinery has all 3 tiers),
// so every Chemical-Refinery-only item's correct default is Medium, not
// Large. Every one of the 15 real items is covered here, not just samples,
// since a wrong default for even one item is a real player-facing bug.
test("bestAvailableTier: the 6 Ore Refinery items (all 3 tiers or Large+Medium) default to large", () => {
  for (const key of ["copper_ingot", "iron_ingot", "steel_ingot", "aluminum_ingot", "duraluminum_ingot", "plastanium_ingot"]) {
    assert.equal(bestAvailableTier(key), "large", `${key} should default to large`);
  }
});

test("bestAvailableTier: the 9 Chemical Refinery items (no Large variant exists in the game) default to medium", () => {
  for (const key of ["stravidium_fiber", "cobalt_paste", "silicone_block", "small_fuel_cell", "medium_fuel_cell", "large_fuel_cell", "spice_fuel_cell", "low_grade_lubricant", "industrial_lubricant"]) {
    assert.equal(bestAvailableTier(key), "medium", `${key} should default to medium (no Large Chemical Refinery exists)`);
  }
});

test("bestAvailableTier: unknown item throws", () => {
  assert.throws(() => bestAvailableTier("not_a_real_item"), /Unknown item/);
});

for (const poisonedKey of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
  test(`bestAvailableTier: prototype-property item key "${poisonedKey}" rejects instead of resolving`, () => {
    assert.throws(() => bestAvailableTier(poisonedKey), /Unknown item/);
  });
}

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

test("applyOnHandCredit: crediting a flat ingredient directly -- subtraction only, no cascade", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 40 }], { quantity: 25 });
  assert.equal(credited.shortfall.get("titanium_ore"), 100 - 40);
  assert.equal(credited.maxCompletable.units, 10, "40 titanium ore / 4 per craft = 10 completable");
  assert.equal(credited.maxCompletable.limitingNode, "titanium_ore");
});

test("applyOnHandCredit: crediting the intermediate craftable itself -- cascades down", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "stravidium_fiber", quantity: 8 }], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 8, "8 stravidium fiber on hand -> 8 plastanium completable (1:1 ratio)");
  assert.equal(credited.maxCompletable.limitingNode, "stravidium_fiber");
  // Important #5: the cascade must actually reduce the pooled shortfall of
  // stravidium_fiber's OWN inputs proportionally (8/25 of fiber's total
  // requirement is offset), not just move maxCompletable -- a broken
  // cascade could still pass the assertions above.
  assert.equal(credited.shortfall.get("water"), 33750 - 8 * 100, "fiber's own Water per craft (100) * 8 offset crafts");
  assert.equal(credited.shortfall.get("stravidium_mass"), 75 - 8 * 3, "fiber's own Stravidium Mass per craft (3) * 8 offset crafts");
});

test("applyOnHandCredit: crediting a leaf resource underneath the intermediate -- no cascade upward, pooled subtraction only (worked example)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "stravidium_mass", quantity: 60 }], { quantity: 25 });
  assert.equal(credited.shortfall.get("stravidium_mass"), 75 - 60);
  assert.equal(credited.maxCompletable.units, 20, "60 stravidium mass / 3 per plastanium = 20 completable");
  assert.equal(credited.maxCompletable.limitingNode, "stravidium_mass");
});

test("applyOnHandCredit: chain-aware max completable, intermediate as the limiting node over a much larger raw-ingredient supply (worked example)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [
    { node: "stravidium_fiber", quantity: 8 },
    { node: "titanium_ore", quantity: 2000 }
  ], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 8);
  assert.equal(credited.maxCompletable.limitingNode, "stravidium_fiber");
});

test("applyOnHandCredit: target-item-itself credit combined with insufficient ingredient supply", () => {
  // 5 of 25 already done (resolved by the caller into effectiveQuantity=20
  // and targetItemOnHand=5 BEFORE calculateCraftingPlan/applyOnHandCredit
  // are ever called -- this test exercises applyOnHandCredit's own
  // combination formula directly).
  const plan = calculateCraftingPlan("plastanium_ingot", 20, { stationTier: "large" }); // effectiveQuantity
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 40 }], { quantity: 25, targetItemOnHand: 5 });
  // supply-constrained: 40/4 = 10; maxCompletable = min(25, 5 + 10) = 15
  assert.equal(credited.maxCompletable.units, 15);
  assert.equal(credited.effectiveQuantity, 20);
});

test("applyOnHandCredit: on-hand quantity bound re-validated independently (finding S-1)", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  for (const bad of [-1, MAX_QUANTITY + 1, 1.5, NaN]) {
    assert.throws(() => applyOnHandCredit(plan, [{ node: "copper_ore", quantity: bad }], { quantity: 5 }), Error);
  }
});

test("applyOnHandCredit: a node not in the plan's tree rejects with a clear error", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  assert.throws(() => applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 5 }], { quantity: 5 }), /not an ingredient/i);
});

test("applyOnHandCredit: a node key of '__proto__' is rejected as unknown, never resolved against Object.prototype (finding S-2)", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  assert.throws(() => applyOnHandCredit(plan, [{ node: "__proto__", quantity: 5 }], { quantity: 5 }), /not an ingredient/i);
  assert.equal(Object.prototype.polluted, undefined, "must never actually pollute Object.prototype");
});

test("applyOnHandCredit: no on-hand values at all -- maxCompletable is undefined, not a computed 0", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [], { quantity: 5 });
  assert.equal(credited.maxCompletable, undefined);
});

test("applyOnHandCredit: multi-output recipe, undercounting direction (Critical #1) -- 1 Silicone Block can't start a 4-per-craft recipe", () => {
  const plan = calculateCraftingPlan("industrial_lubricant", 10, { stationTier: "medium" });
  const credited = applyOnHandCredit(plan, [{ node: "silicone_block", quantity: 1 }], { quantity: 10 });
  assert.equal(credited.maxCompletable.units, 0, "1 of 4 needed per craft can't complete even one craft, so 0 output units, not floor(1/4*10)=2");
});

test("applyOnHandCredit: multi-output recipe, full-requirement boundary (Critical #1) -- capped at the requested quantity, not the raw craft output", () => {
  const plan = calculateCraftingPlan("spice_fuel_cell", 11, { stationTier: "medium" });
  const credited = applyOnHandCredit(plan, [{ node: "water", quantity: 400 }], { quantity: 11 });
  // 400 water / 200 per craft = 2 full crafts = 20 raw output units, but
  // capped at the requested 11 -- not 20.
  assert.equal(credited.maxCompletable.units, 11);
});

test("applyOnHandCredit: multi-output recipe, partial supply (Critical #1)", () => {
  const plan = calculateCraftingPlan("spice_fuel_cell", 11, { stationTier: "medium" });
  const credited = applyOnHandCredit(plan, [{ node: "water", quantity: 200 }], { quantity: 11 });
  // 200 water / 200 per craft = 1 full craft = 10 output units.
  assert.equal(credited.maxCompletable.units, 10);
});

test("applyOnHandCredit: crediting an intermediate AND a leaf beneath it combine, they don't compete via min() (Critical #2, worked example)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [
    { node: "stravidium_fiber", quantity: 8 },
    { node: "stravidium_mass", quantity: 60 }
  ], { quantity: 25 });
  // 8 already-refined fiber + floor(60/3)=20 more fiber from the mass =
  // 28 fiber-equivalent, which covers all 25 needed -- not min(8,20)=8.
  assert.equal(credited.maxCompletable.units, 25);
});

test("applyOnHandCredit: crediting a leaf pooled across BOTH the root's own recipe and a nested intermediate's recipe (Water under Plastanium + Stravidium Fiber) -- round 2 regression", () => {
  // Water is consumed directly by Plastanium Ingot's own recipe (1250/craft)
  // AND by its nested Stravidium Fiber recipe (100/craft) -- pooled total
  // 1350/unit. A branch-based approach that routes Water into only the
  // root's own branch would silently ignore the nested 100/craft and
  // overstate completability (the dangerous direction for a player's
  // farming decision) -- this must resolve against the TRUE pooled total.
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "water", quantity: 20000 }], { quantity: 25 });
  // 20000 / 1350 = 14.81 -> 14 whole units completable.
  assert.equal(credited.maxCompletable.units, 14);

  const creditedPartial = applyOnHandCredit(plan, [{ node: "water", quantity: 31250 }], { quantity: 25 });
  // 31250 / 1350 = 23.15 -> 23, NOT 25 -- confirms this isn't silently
  // capped at the requested quantity by an under-counted per-unit rate.
  assert.equal(creditedPartial.maxCompletable.units, 23);
});

test("applyOnHandCredit: crediting an intermediate AND a SHARED (non-exclusive) leaf must NOT combine -- the intermediate's own check still binds (round 3 regression)", () => {
  // Water is shared between Plastanium Ingot's own recipe and its nested
  // Stravidium Fiber recipe (unlike Stravidium Mass, which is exclusive to
  // Fiber) -- crediting Fiber 8 alongside a large Water amount must NOT
  // trigger the same "combine" treatment as Fiber + Mass does. Fiber's own
  // check (n <= 8) must still bind independently, since Water's own
  // contribution is already fully captured by its own pooled check.
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [
    { node: "stravidium_fiber", quantity: 8 },
    { node: "water", quantity: 32950 }
  ], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 8, "Water is shared, not exclusive to Fiber -- must not let a huge Water credit paper over an insufficient Fiber credit");
  assert.equal(credited.maxCompletable.limitingNode, "stravidium_fiber");
});

test("applyOnHandCredit: crediting the target item itself through onHandEntries is rejected, not silently accepted (round 3 regression)", () => {
  // Task 7's Step A is supposed to filter this out before ever calling
  // applyOnHandCredit() -- this is the defense-in-depth backstop, same
  // posture as S-1/S-2/Important #1.
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  assert.throws(
    () => applyOnHandCredit(plan, [{ node: "plastanium_ingot", quantity: 10 }], { quantity: 25 }),
    /not an ingredient/i
  );
});

test("applyOnHandCredit: a duplicate on-hand node is rejected, not silently double-counted (Important #1)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  assert.throws(
    () => applyOnHandCredit(plan, [
      { node: "titanium_ore", quantity: 10 },
      { node: "titanium_ore", quantity: 20 }
    ], { quantity: 25 }),
    /duplicate/i
  );
});

test("applyOnHandCredit: quantity and targetItemOnHand are validated independently (Important #4)", () => {
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  for (const bad of [NaN, -1, 1.5]) {
    assert.throws(() => applyOnHandCredit(plan, [], { quantity: bad }), Error, `quantity=${bad} should throw`);
    assert.throws(() => applyOnHandCredit(plan, [], { quantity: 5, targetItemOnHand: bad }), Error, `targetItemOnHand=${bad} should throw`);
  }
});

test("applyOnHandCredit: empty on-hand entries + target-item credit -- supply term is unbounded, not zero (Important #2)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" }); // effectiveQuantity === quantity here
  const credited = applyOnHandCredit(plan, [], { quantity: 25, targetItemOnHand: 5 });
  assert.equal(credited.maxCompletable.units, 25, "no ingredient credit at all means the supply term is unbounded (Infinity), so units is capped only by quantity");
});

test("estimateDuration: single-station-type worked example (Copper Ingot x500) -- exactly one line, no phantom Chemical Refinery line", () => {
  const plan = calculateCraftingPlan("copper_ingot", 500, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 1 });
  assert.equal(durations.length, 1);
  assert.equal(durations[0].station, "Ore Refinery");
  assert.equal(durations[0].seconds, 500 * 3);
});

test("estimateDuration: two station families reported independently, never summed (Plastanium worked example)", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 1 });
  const ore = durations.find((d) => d.station === "Ore Refinery");
  const chem = durations.find((d) => d.station === "Chemical Refinery");
  assert.equal(ore.seconds, 25 * 20);
  assert.equal(chem.seconds, 25 * 10);
});

test("estimateDuration: stationCount divides crafts, rounding up", () => {
  const plan = calculateCraftingPlan("copper_ingot", 500, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 3 });
  assert.equal(durations[0].seconds, Math.ceil(500 / 3) * 3);
});

// [Final-review fix 2] `maxCompletable` measures whether on-hand MATERIAL
// supply is sufficient to reach the goal -- it says nothing about whether
// the root item's own crafting has actually happened. These two tests
// previously asserted the WRONG pre-fix behavior (a `topFullyCovered` special
// case in estimateDuration() zeroed the root's duration line any time
// `maxCompletable.units >= quantity`, even though real crafts, per
// `plan.crafts`, still needed to run). Inverted below to assert the real,
// correct behavior: root duration always reflects `plan.crafts`, regardless
// of how much raw material is on hand.
test("estimateDuration: root duration reflects real remaining crafts even when material supply is more than sufficient", () => {
  // Copper Ingot x5 @ large needs 2 copper_ore/craft = 10 total. Crediting
  // 100 copper_ore (a large excess) makes maxCompletable.units cover the
  // goal many times over, but the 5 root Copper Ingot crafts themselves
  // still have not happened -- the Duration line must still show them.
  const plan = calculateCraftingPlan("copper_ingot", 5, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "copper_ore", quantity: 100 }], { quantity: 5 });
  assert.ok(credited.maxCompletable.units >= 5, "sanity check: material supply covers (and exceeds) the goal");
  const durations = estimateDuration(credited, { stationCount: 1 });
  assert.equal(durations.length, 1, "5 real crafts still need to run at the Ore Refinery, even with material supply to spare");
  assert.equal(durations[0].station, "Ore Refinery");
  assert.equal(durations[0].craftsRemaining, 5);
  assert.equal(durations[0].seconds, 5 * 3);
});

test("estimateDuration: a partially-credited root (maxCompletable.units < quantity) still reports the FULL remaining craft count, not a partial reduction", () => {
  // Copper Ingot x10 @ large needs 2 copper_ore/craft = 20 total. Crediting
  // 19 (one short) leaves maxCompletable.units = 9 < quantity (10).
  const plan = calculateCraftingPlan("copper_ingot", 10, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "copper_ore", quantity: 19 }], { quantity: 10 });
  assert.equal(credited.maxCompletable.units, 9, "sanity check on the worked example's own arithmetic");
  const durations = estimateDuration(credited, { stationCount: 1 });
  assert.equal(durations.length, 1);
  assert.equal(durations[0].station, "Ore Refinery");
  assert.equal(durations[0].craftsRemaining, 10, "not fully covered -- the full planned craft count remains, never a partial reduction");
  assert.equal(durations[0].seconds, 10 * 3);
});

test("estimateDuration: exact-boundary full material credit (maxCompletable.units === quantity) still reports the real root craft count", () => {
  // Same recipe, credited with EXACTLY the 20 copper_ore needed (not a large
  // excess like the test above) -- material supply exactly meets the goal,
  // but the 10 root Copper Ingot crafts themselves still haven't run, so the
  // Duration line must still show all 10, not zero.
  const plan = calculateCraftingPlan("copper_ingot", 10, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "copper_ore", quantity: 20 }], { quantity: 10 });
  assert.equal(credited.maxCompletable.units, 10, "sanity check on the worked example's own arithmetic");
  const durations = estimateDuration(credited, { stationCount: 1 });
  assert.equal(durations.length, 1);
  assert.equal(durations[0].station, "Ore Refinery");
  assert.equal(durations[0].craftsRemaining, 10, "material supply meeting the goal exactly does not mean the crafting is done");
  assert.equal(durations[0].seconds, 10 * 3);
});

// resolveEffectiveOnHandCredit() -- Task 3 extraction of executeCalculator()'s
// own "Step A" logic (commands.js), so goal progress can reuse it without
// duplicating or (as an earlier design draft did) skipping it.
test("resolveEffectiveOnHandCredit: crediting the target item itself reduces effectiveQuantity, never calls calculateCraftingPlan with the raw target", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [{ node: "copper_ingot", quantity: 10 }], { stationTier: "large", craftingContract: false });
  assert.equal(credited.effectiveQuantity, 15);
  assert.equal(credited.quantity, 25);
});

test("resolveEffectiveOnHandCredit: target-item credit covering the whole goal returns a genuinely empty plan, not a phantom 1-unit plan", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [{ node: "copper_ingot", quantity: 25 }], { stationTier: "large", craftingContract: false });
  assert.equal(credited.effectiveQuantity, 0);
  assert.equal(credited.crafts, 0);
  assert.deepEqual(credited.directInputs, []);
  assert.deepEqual(credited.totalRawMaterials, []);
  assert.equal(credited.totalTimeSeconds, 0);
  assert.equal(credited.shortfall.size, 0);
  assert.equal(credited.maxCompletable.units, 25);
});

test("resolveEffectiveOnHandCredit: no on-hand entries at all returns the plain uncredited plan", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [], { stationTier: "large", craftingContract: false });
  assert.equal(credited.effectiveQuantity, 25);
  assert.equal(credited.crafts, 25);
});

test("resolveEffectiveOnHandCredit: ingredient credit (not the target item) applies applyOnHandCredit as before", () => {
  const credited = resolveEffectiveOnHandCredit("copper_ingot", 25, [{ node: "copper_ore", quantity: 40 }], { stationTier: "large", craftingContract: false });
  assert.ok(credited.shortfall.has("copper_ore"));
  assert.equal(credited.effectiveQuantity, 25);
});

test("resolveEffectiveOnHandCredit: an invalid station tier still throws the real 'no recipe variant' error even at effectiveQuantity 0", () => {
  assert.throws(
    () => resolveEffectiveOnHandCredit("stravidium_fiber", 5, [{ node: "stravidium_fiber", quantity: 5 }], { stationTier: "large", craftingContract: false }),
    /no recipe variant at this tier/i
  );
});

test("recipeTreeNodes: Copper Ingot (flat item) returns itself + copper ore only", () => {
  const nodes = recipeTreeNodes("copper_ingot").map((n) => n.key).sort();
  assert.deepEqual(nodes, ["copper_ingot", "copper_ore"].sort());
});

test("recipeTreeNodes: Plastanium Ingot (chained) returns itself, direct ingredients, and the nested craftable's own ingredients", () => {
  const nodes = recipeTreeNodes("plastanium_ingot").map((n) => n.key).sort();
  assert.deepEqual(nodes, ["plastanium_ingot", "water", "titanium_ore", "stravidium_fiber", "stravidium_mass"].sort());
});

test("recipeTreeNodes: Industrial-grade Lubricant, the verified worst case, returns exactly 6 nodes", () => {
  const nodes = recipeTreeNodes("industrial_lubricant");
  assert.equal(nodes.length, 6);
});

test("recipeTreeNodes: unknown item throws", () => {
  assert.throws(() => recipeTreeNodes("not_a_real_item"), /Unknown item/);
});
