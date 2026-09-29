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

  // The success (✅) emoji requires ALL real shortfall to be zero, not just
  // maxCompletable reaching the goal -- see the "qualified vs unqualified"
  // tests below for the case where crediting only some ingredients still
  // reaches the goal via maxCompletable but leaves other real shortfall.
  const sufficientEntries = [
    { node: "titanium_ore", quantity: 2000 },
    { node: "stravidium_fiber", quantity: 25 },
    { node: "water", quantity: 100000 },
    { node: "stravidium_mass", quantity: 1000 }
  ];
  const sufficientCredit = applyOnHandCredit(plan, sufficientEntries, { quantity: 25 });
  const sufficientEmbed = formatCalculatorEmbed(sufficientCredit, estimateDuration(sufficientCredit, { stationCount: 1 }), { onHandEntries: sufficientEntries });
  assert.match(JSON.stringify(sufficientEmbed.data ?? sufficientEmbed), /✅/);
});

// [Final-review fix 3 follow-up] the qualified line must never claim
// on-hand items are "enough"/✅ when real shortfall remains -- that's a
// contradiction in terms, not just an unqualified success claim. Use an
// info-only ℹ️ line instead whenever any real shortfall line is nonzero.
test("formatCalculatorEmbed: qualified line never claims success (✅/'enough') when real shortfall remains", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  // Only titanium_ore is credited (hugely) -- water and stravidium_mass are
  // never credited at all, so real shortfall remains for both.
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 2000 }], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 25, "sanity check: maxCompletable reaches the full goal");
  assert.ok([...credited.shortfall.values()].some((v) => v > 0), "sanity check: real shortfall remains for uncredited ingredients");
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /ℹ️/);
  assert.doesNotMatch(text, /✅.*enough|enough.*✅/i, "must not pair a success emoji with an 'enough' claim while shortfall remains");
  assert.match(text, /gather the remaining shortfall/i, "the line must direct the player to the real shortfall, not claim completion");
});

// [Final-review fix 3 follow-up] crediting ONLY the target item itself (no
// ingredient credit at all) still reaches maxCompletable.units===quantity
// via targetItemOnHand, but every ingredient's shortfall is real and
// untouched -- the message must not claim on-hand items are "enough".
test("formatCalculatorEmbed: target-item-only credit does not claim on-hand items are enough when ingredient shortfall is untouched", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 20, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [], { quantity: 25, targetItemOnHand: 5 });
  assert.equal(credited.maxCompletable.units, 25, "sanity check: maxCompletable reaches the full goal via targetItemOnHand");
  assert.ok([...credited.shortfall.values()].every((v) => v > 0), "sanity check: every ingredient's shortfall is untouched");
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), { onHandEntries: [] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.doesNotMatch(text, /✅.*enough|enough.*✅/i, "must not claim on-hand items are enough when no ingredient was credited at all");
  assert.match(text, /ℹ️/);
});

// [Final-review fix 3] `maxCompletable` only reflects CREDITED nodes -- if a
// player credits only ONE ingredient among several the item actually needs,
// `maxCompletable.units` can still reach the full goal (uncredited nodes are
// treated as unconstrained supply) even though the Shortfall table right
// below still lists real, nonzero shortfall for the ingredients they never
// credited. The ✅ line must say so, not claim the goal is fully done.
test("formatCalculatorEmbed: qualifies the success line when real shortfall remains despite maxCompletable covering the goal", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  // Only titanium_ore is credited (hugely) -- water and stravidium_mass are
  // never credited at all, so real shortfall remains for both.
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 2000 }], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 25, "sanity check: maxCompletable reaches the full goal");
  assert.ok([...credited.shortfall.values()].some((v) => v > 0), "sanity check: real shortfall remains for uncredited ingredients");
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }] });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /ℹ️/);
  assert.match(text, /gather the remaining shortfall/i, "the line must be qualified, not claim the goal is fully done");
});

test("formatCalculatorEmbed: keeps the unqualified success line when no shortfall remains at all", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [
    { node: "titanium_ore", quantity: 2000 },
    { node: "stravidium_fiber", quantity: 25 },
    { node: "water", quantity: 100000 },
    { node: "stravidium_mass", quantity: 1000 }
  ], { quantity: 25 });
  assert.equal(credited.maxCompletable.units, 25, "sanity check: maxCompletable reaches the full goal");
  assert.ok([...credited.shortfall.values()].every((v) => v === 0), "sanity check: no real shortfall remains anywhere");
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), {
    onHandEntries: [
      { node: "titanium_ore", quantity: 2000 },
      { node: "stravidium_fiber", quantity: 25 },
      { node: "water", quantity: 100000 },
      { node: "stravidium_mass", quantity: 1000 }
    ]
  });
  const text = JSON.stringify(embed.data ?? embed);
  assert.match(text, /✅ You can complete all 25 requested\./);
  assert.doesNotMatch(text, /gather the remaining shortfall/i);
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

// [Final-review fix 4] In on-hand-credit mode, the Nested Craft section used
// to render the nested item's raw, UNADJUSTED per-craft ingredient amounts,
// directly contradicting the Shortfall section above it for the same
// ingredient (e.g. Shortfall: "Stravidium Mass 0 -- fully covered" vs Nested
// Craft: "Stravidium Mass 75"). The nested section must no longer print
// per-ingredient rows in on-hand mode at all -- just a header pointing back
// at the Shortfall table.
test("formatCalculatorEmbed: nested craft section does not contradict the shortfall section in on-hand mode", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  // Credit stravidium_mass generously -- this fully covers the raw
  // ingredient the nested Stravidium Fiber craft needs, so the Shortfall
  // line for it reads "fully covered." The prior, buggy Nested Craft
  // section would still show the raw, uncredited 75-needed figure for the
  // same resource in the same response.
  const credited = applyOnHandCredit(plan, [{ node: "stravidium_mass", quantity: 1000 }], { quantity: 25 });
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), { onHandEntries: [{ node: "stravidium_mass", quantity: 1000 }] });
  const description = embed.data.description;
  assert.match(description, /Stravidium Mass\s+0 \(1,000 on hand — fully covered\)/, "Shortfall line must show the real, credited number");
  const nestedSection = description.slice(description.indexOf("Nested Craft"));
  assert.doesNotMatch(nestedSection, /Stravidium Mass/, "the Nested Craft section must not repeat a raw, uncredited number for an ingredient the Shortfall section already reports");
  assert.match(nestedSection, /Nested Craft: 25× Stravidium Fiber, Medium Chemical Refinery/);
});

// [Final-review fix 4] A raw resource pooled across multiple levels of the
// tree (Water, shared between the root Plastanium craft and its nested
// Stravidium Fiber craft) must appear exactly once in the whole embed in
// on-hand mode -- in the Shortfall section, never repeated under the Nested
// Craft section.
test("formatCalculatorEmbed: a pooled resource shared across levels (Water) appears exactly once in on-hand mode", () => {
  const plan = calculateCraftingPlan("plastanium_ingot", 25, { stationTier: "large" });
  const credited = applyOnHandCredit(plan, [{ node: "titanium_ore", quantity: 2000 }], { quantity: 25 });
  const embed = formatCalculatorEmbed(credited, estimateDuration(credited, { stationCount: 1 }), { onHandEntries: [{ node: "titanium_ore", quantity: 2000 }] });
  const description = embed.data.description;
  const waterMentions = description.match(/Water/g) ?? [];
  assert.equal(waterMentions.length, 1, `expected Water to appear exactly once, found ${waterMentions.length}: ${description}`);
});
