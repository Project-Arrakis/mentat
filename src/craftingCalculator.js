// src/craftingCalculator.js
//
// Pure traversal/rounding/modifier logic -- zero Discord.js, zero network,
// zero database. This is a direct, cited port of dune.gaming.tools' own
// verified algorithm (see docs/calculator-architecture.md's Verified
// Reference Algorithm section for the decompiled source and citation) --
// do not re-derive the rounding/modifier rules independently.

import { CRAFTING_RECIPES, LEAF_RESOURCES } from "./craftingData.js";

export const MIN_QUANTITY = 1;
export const MAX_QUANTITY = 100000;

function validateQuantity(value, { min, max, label }) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max} (got "${value}").`);
  }
  return value;
}

function costFactor(craftingContractActive) {
  return craftingContractActive ? 0.75 : 1;
}

function ingredientPerCraft(rawQuantity, craftingContractActive) {
  return Math.ceil(rawQuantity * costFactor(craftingContractActive));
}

function craftsNeeded(requiredQuantity, outputPerCraft) {
  return Math.ceil(requiredQuantity / outputPerCraft);
}

// Resolve which variant to use for `recipe` at `stationTier`. The root
// request (the item the caller directly asked for) is strict: if there's
// no variant at the exact requested tier, it's a rejectable error, never a
// silent fallback (see calculator-design.md's Error Handling table).
//
// A NESTED craftable input is different: the reference site (and
// calculator-design.md's own worked example -- Plastanium Ingot at Large
// nests Stravidium Fiber, which only has a Medium Chemical Refinery
// variant, since "Large Chemical Refinery" isn't a real placeable) resolves
// each nested item at whatever real tier it actually has, not the parent's
// requested tier -- there is no "Large" Stravidium Fiber to silently
// require. This is reported transparently (the nested node's own `station`/
// `stationTier` reflect the tier actually used), so it is not the "silent
// fallback" the root-level rule forbids -- it's the only tier that exists
// for that item.
function resolveVariant(recipe, stationTier, { allowTierFallback }) {
  let variant = recipe.variants[stationTier];
  let resolvedTier = stationTier;
  if (!variant && allowTierFallback) {
    const fallbackTier = Object.keys(recipe.variants)[0];
    if (fallbackTier !== undefined) {
      resolvedTier = fallbackTier;
      variant = recipe.variants[fallbackTier];
    }
  }
  if (!variant) {
    const available = Object.keys(recipe.variants).join(", ");
    throw new Error(`${recipe.displayName} has no recipe variant at this tier ("${stationTier}") -- available tiers: ${available}.`);
  }
  return { variant, resolvedTier };
}

// Exported for direct unit testing of the cycle guard against a synthetic
// recipe graph (see test/craftingCalculator.test.js) without needing to
// mutate the real, frozen CRAFTING_RECIPES. `recipes` defaults to the real
// data for every production call site.
export function walkRecipeTree(itemKey, quantity, stationTier, craftingContract, recipes = CRAFTING_RECIPES, visiting = new Set()) {
  if (visiting.has(itemKey)) {
    throw new Error(`Circular recipe dependency detected involving "${itemKey}".`);
  }
  const recipe = recipes[itemKey];
  if (!recipe) {
    throw new Error(`Unknown item: "${itemKey}".`);
  }
  // Root call (empty `visiting`) is strict -- no tier fallback. A nested
  // call (non-empty `visiting`, since the caller always adds itself before
  // recursing) may fall back to whatever tier the nested item actually has.
  const allowTierFallback = visiting.size > 0;
  const { variant, resolvedTier: effectiveTier } = resolveVariant(recipe, stationTier, { allowTierFallback });

  const crafts = craftsNeeded(quantity, recipe.outputPerCraft);
  const leftover = crafts * recipe.outputPerCraft - quantity;

  const directInputs = variant.inputs.map((input) => ({
    resource: input.resource,
    quantity: ingredientPerCraft(input.quantity, craftingContract) * crafts,
    craftable: input.craftable
  }));

  const nestedCrafts = {};
  const nextVisiting = new Set(visiting).add(itemKey);
  for (const input of directInputs) {
    if (!input.craftable) continue;
    const nested = walkRecipeTree(input.resource, input.quantity, stationTier, craftingContract, recipes, nextVisiting);
    nestedCrafts[input.resource] = nested;
    // Merge the nested plan's own nestedCrafts up (supports depth > 1,
    // even though today's data is depth-1 only -- see the architecture
    // doc's Dependency Graph note on not hardcoding a depth limit).
    Object.assign(nestedCrafts, nested.nestedCrafts);
  }

  // Pool every resource across this level and every nested level into one
  // total per distinct resource -- see the design doc's Step 2 pooling
  // requirement. A resource is "raw" here if it's not itself a key in
  // nestedCrafts (i.e. it wasn't further crafted at this level).
  const pooledTotals = new Map();
  const addToPool = (resource, quantity) => {
    pooledTotals.set(resource, (pooledTotals.get(resource) || 0) + quantity);
  };
  for (const input of directInputs) {
    if (input.craftable) continue; // raw leaf under THIS item, pool it
    addToPool(input.resource, input.quantity);
  }
  for (const nested of Object.values(nestedCrafts)) {
    for (const input of nested.directInputs) {
      if (input.craftable) continue;
      addToPool(input.resource, input.quantity);
    }
  }

  const totalTimeSeconds = crafts * variant.craftTimeSeconds
    + Object.values(nestedCrafts).reduce((sum, n) => sum + n.crafts * n.variantCraftTimeSeconds, 0);

  return {
    itemKey,
    quantity,
    stationTier: effectiveTier,
    craftingContract,
    station: variant.station,
    craftTimeSeconds: variant.craftTimeSeconds,
    variantCraftTimeSeconds: variant.craftTimeSeconds, // used by the parent's totalTimeSeconds reduce above
    crafts,
    leftover,
    directInputs,
    nestedCrafts,
    totalRawMaterials: [...pooledTotals.entries()].map(([resource, quantity]) => ({ resource, quantity })),
    totalTimeSeconds
  };
}

export function calculateCraftingPlan(itemKey, quantity, { stationTier = "large", craftingContract = false } = {}) {
  validateQuantity(quantity, { min: MIN_QUANTITY, max: MAX_QUANTITY, label: "quantity" });
  return walkRecipeTree(itemKey, quantity, stationTier, craftingContract);
}
