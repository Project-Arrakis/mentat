import assert from "node:assert/strict";
import { test } from "node:test";
import { formatCalculatorEmbed } from "../src/embedFormat.js";
import { calculateCraftingPlan, applyOnHandCredit, estimateDuration } from "../src/craftingCalculator.js";

test("formatCalculatorEmbed: plain request (no on-hand) reproduces the v1-style output and includes the discoverability tip", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const durations = estimateDuration(plan, { stationCount: 1 });
  const embed = formatCalculatorEmbed(plan, durations, { onHandEntries: [] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /33,750|33750/, "must show pooled total water");
  assert.match(text, /Tip/, "plain response must include the discoverability tip");
  assert.doesNotMatch(text, /\(goal\)/, "plain response title must not have the (goal) suffix");
});

test("formatCalculatorEmbed: with on-hand values, title gets (goal) suffix and tip is omitted", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 2000 }], { quantity: 25 });
  const durations = estimateDuration(credited, { stationCount: 1 });
  const embed = formatCalculatorEmbed(credited, durations, { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /\(goal\)/);
  assert.doesNotMatch(text, /Tip/, "a response already using on-hand values must not repeat the discoverability tip");
});

test("formatCalculatorEmbed: max-completable line uses the warning emoji when short of the goal, success emoji when sufficient", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const shortCredit = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 40 }], { quantity: 25 });
  const shortEmbed = formatCalculatorEmbed(shortCredit, estimateDuration(shortCredit, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 40 }] });
  assert.match(JSON.stringify(shortEmbed.data ?? shortEmbed), /⚠️/);

  const sufficientCredit = applyOnHandCredit(plan, [
    { node: "titanium_ore", quantity: 2000 },
    { node: "stravidium_fiber", quantity: 25 }
  ], { quantity: 25 });
  const sufficientEmbed = formatCalculatorEmbed(sufficientCredit, estimateDuration(sufficientCredit, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }, { node: "stravidium_fiber", quantity: 25 }] });
  assert.match(JSON.stringify(sufficientEmbed.data ?? sufficientEmbed), /✅/);
});

test("formatCalculatorEmbed: leftover line shown for multi-output items when leftover > 0", () => {
  const plan = calculateCraftingPlan("low_grade_lubricant", 12, { stationTier: "medium" });
  const embed = formatCalculatorEmbed(plan, estimateDuration(plan, { stationCount: 1 }), { onHandEntries: [] });
  assert.match(JSON.stringify(embed.data ?? embed), /leftover/i);
});

test("formatCalculatorEmbed: crafting-contract footer shown only when active", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large", craftingContract: true });
  const embed = formatCalculatorEmbed(plan, estimateDuration(plan, { stationCount: 1 }), { onHandEntries: [] });
  assert.match(JSON.stringify(embed.data ?? embed), /Crafting Contract active/);
});

test("formatCalculatorEmbed: shows both the original goal and effectiveQuantity when target-item-itself on-hand credit was applied", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 20, { stationTier: "large" }); // effectiveQuantity, per Step A
  const credited = applyOnHandCredit(plan, [], { quantity: 25, targetItemOnHand: 5 });
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), { onHandEntries: [{ node: "plastanium_ingot", quantity: 5 }] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /Goal: 25/);
  assert.match(text, /Already have: 5/);
  assert.match(text, /Still need to produce: 20/);
});

test("formatCalculatorEmbed: omits the goal/effectiveQuantity line entirely when no target-item credit was given", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 40 }], { quantity: 25 });
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 40 }] });
  assert.doesNotMatch(JSON.stringify(embed.data ?? embed), /Already have:/);
});
