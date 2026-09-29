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

// Every node-keyed structure below is a Map, never a plain object -- see
// docs/calculator-architecture.md's Shortfall Traversal Design citation
// for the prototype-pollution class this specifically prevents (finding
// S-2). A free-typed on-hand-N value that bypassed Discord's autocomplete
// could otherwise carry "__proto__"/"constructor"/"prototype" and resolve
// against real inherited properties instead of undefined.
//
// This is deliberately separate from buildBranchIndex() below: this
// function's pooled totals drive the `shortfall` map (how much of each
// resource is still needed, in that resource's own units); buildBranchIndex()
// drives `maxCompletable` (how many whole ROOT crafts a given on-hand
// quantity actually supports, which needs real per-craft/output-per-craft
// math, not a pooled ratio -- see its own comment for why).
function flattenPlanNodes(plan) {
  // Returns a Map<nodeKey, { pooledQuantity, isIntermediate }> covering the
  // target item itself, every intermediate craftable, and every raw leaf --
  // everything an on-hand-N value could legally name.
  const nodes = new Map();
  nodes.set(plan.itemKey, { pooledQuantity: plan.quantity, isIntermediate: false });
  for (const [resource, nested] of Object.entries(plan.nestedCrafts)) {
    nodes.set(resource, { pooledQuantity: nested.quantity, isIntermediate: true });
  }
  for (const entry of plan.totalRawMaterials) {
    nodes.set(entry.resource, { pooledQuantity: entry.quantity, isIntermediate: false });
  }
  return nodes;
}

// Builds the structure applyOnHandCredit() uses to convert an on-hand
// quantity into whole root-crafts, respecting each recipe's real
// outputPerCraft (Critical #1: a pooled-quantity/requested-quantity ratio
// silently assumes outputPerCraft===1, which is false for e.g. Spice-infused
// Fuel Cell at 10/craft, Low-grade Lubricant at 5/craft) and combining every
// credited node within the SAME dependency chain additively before that
// chain competes against any other, independent chain via min() (Critical
// #2: crediting both an intermediate and its own leaf input are substitutes
// along one chain, not two separate constraints).
//
// A "branch" is one direct input of the root item -- a raw leaf is its own
// one-node branch; a craftable input is a branch containing itself plus its
// own (today, always depth-1) leaf inputs. Real production data has no
// depth-2+ nesting (Task 1's own data-integrity test enforces this), so this
// intentionally does not recurse past one level -- same accepted-limitation
// posture as the cycle guard in walkRecipeTree(). outputPerCraft itself
// isn't part of the plan shape Task 2 returns, so it's derived from the
// identity crafts*outputPerCraft = quantity + leftover, which always holds
// exactly for both the root plan and any nested plan.
function buildBranchIndex(plan) {
  const branches = new Map();
  const index = new Map(); // Map<node, { branchNode, role: "self"|"leaf", perCraftQtyInIntermediate? }>

  for (const input of plan.directInputs) {
    const perCraftQtyAtRoot = input.quantity / plan.crafts;
    if (!input.craftable) {
      branches.set(input.resource, { type: "leaf", node: input.resource, perCraftQtyAtRoot });
      index.set(input.resource, { branchNode: input.resource, role: "self" });
      continue;
    }
    const nestedPlan = plan.nestedCrafts[input.resource];
    const intermediateOutputPerCraft = (nestedPlan.quantity + nestedPlan.leftover) / nestedPlan.crafts;
    const leafPerCraftQty = new Map();
    for (const nestedInput of nestedPlan.directInputs) {
      if (nestedInput.craftable) continue; // depth-1 only -- see accepted limitation above
      leafPerCraftQty.set(nestedInput.resource, nestedInput.quantity / nestedPlan.crafts);
    }
    branches.set(input.resource, { type: "intermediate", node: input.resource, perCraftQtyAtRoot, intermediateOutputPerCraft, leafPerCraftQty });
    index.set(input.resource, { branchNode: input.resource, role: "self" });
  }

  // A raw resource consumed both directly by the root AND nested inside a
  // craftable input (e.g. Water under both Duraluminum Ingot itself and its
  // nested Aluminum Ingot) has no single physically-correct branch to
  // resolve to -- there is no way to know which use a pooled on-hand credit
  // is "really" satisfying. Resolved deterministically in favor of the
  // direct-root use (never overwriting an index entry pass one already set)
  // -- a documented simplification, not a silent bug.
  for (const branch of branches.values()) {
    if (branch.type !== "intermediate") continue;
    for (const [leafNode, perCraftQtyInIntermediate] of branch.leafPerCraftQty.entries()) {
      if (index.has(leafNode)) continue;
      index.set(leafNode, { branchNode: branch.node, role: "leaf", perCraftQtyInIntermediate });
    }
  }

  return { branches, index };
}

export function applyOnHandCredit(plan, onHandEntries = [], { quantity, targetItemOnHand = 0 } = {}) {
  // [SECURITY, finding S-1 + Important #4] Re-validate every caller-supplied
  // number here, independently of whatever the Discord option layer already
  // checked -- same reasoning as calculateCraftingPlan()'s own quantity
  // re-validation.
  validateQuantity(quantity, { min: MIN_QUANTITY, max: MAX_QUANTITY, label: "quantity" });
  validateQuantity(targetItemOnHand, { min: 0, max: MAX_QUANTITY, label: "targetItemOnHand" });

  const seenNodes = new Set();
  for (const entry of onHandEntries) {
    if (!Number.isInteger(entry.quantity) || entry.quantity < 0 || entry.quantity > MAX_QUANTITY) {
      throw new Error(`On-hand quantity for "${entry.node}" must be a whole number between 0 and ${MAX_QUANTITY} (got "${entry.quantity}").`);
    }
    // [SECURITY, Important #1] Task 7's Discord-option layer is also meant
    // to reject a duplicate on-hand-N node, but per this file's own
    // defense-in-depth posture (see S-1/S-2), never trust a single caller
    // alone -- a duplicate here would otherwise silently double-subtract
    // from `shortfall` and double-count toward `maxCompletable`.
    if (seenNodes.has(entry.node)) {
      throw new Error(`Duplicate on-hand entry for "${entry.node}" -- each ingredient may only be credited once.`);
    }
    seenNodes.add(entry.node);
  }

  const nodeMap = flattenPlanNodes(plan); // Map, per finding S-2
  const shortfall = new Map();
  for (const [key, info] of nodeMap.entries()) {
    if (key === plan.itemKey) continue; // target item's own shortfall isn't tracked here -- see effectiveQuantity
    shortfall.set(key, info.pooledQuantity);
  }

  const { branches, index } = buildBranchIndex(plan); // both Maps, per finding S-2
  const rootOutputPerCraft = (plan.quantity + plan.leftover) / plan.crafts;
  const branchContribution = new Map(); // Map<branchNode, { units, entries: [node, ...] }>

  for (const entry of onHandEntries) {
    const located = index.get(entry.node); // Map.get -- never `index[entry.node]`
    if (!located) {
      throw new Error(`"${entry.node}" is not an ingredient of ${plan.itemKey}.`);
    }

    const currentShortfall = shortfall.get(entry.node) ?? 0;
    const newShortfall = Math.max(0, currentShortfall - entry.quantity);
    shortfall.set(entry.node, newShortfall);

    const info = nodeMap.get(entry.node);
    if (info.isIntermediate) {
      // Cascade: crediting an intermediate craftable proportionally reduces
      // its own (depth-1) raw inputs' pooled shortfall too, since that much
      // of the intermediate no longer needs to be crafted from scratch.
      // Never cascades upward past the intermediate itself.
      const nested = plan.nestedCrafts[entry.node];
      const creditRatio = currentShortfall === 0 ? 0 : (currentShortfall - newShortfall) / currentShortfall;
      for (const input of nested.directInputs) {
        if (input.craftable) continue;
        const reduction = Math.round(input.quantity * creditRatio);
        shortfall.set(input.resource, Math.max(0, (shortfall.get(input.resource) ?? 0) - reduction));
      }
    }

    // [Critical #1/#2 fix] Convert this entry's on-hand quantity into
    // "available units of its branch's own top-level node," accumulating
    // additively with any other credited node in the SAME branch (e.g. an
    // intermediate credited directly, plus its own leaf credited too) --
    // branches only ever compete against EACH OTHER via min() below, never
    // against sub-parts of themselves.
    const branch = branches.get(located.branchNode);
    const unitsOfBranchTop = located.role === "self"
      ? entry.quantity
      : Math.floor(entry.quantity / located.perCraftQtyInIntermediate) * branch.intermediateOutputPerCraft;

    const contribution = branchContribution.get(located.branchNode) ?? { units: 0, entries: [] };
    contribution.units += unitsOfBranchTop;
    contribution.entries.push(entry.node);
    branchContribution.set(located.branchNode, contribution);
  }

  // [Critical #1 fix] Whole-craft granularity: floor to full crafts of the
  // branch's own root-facing recipe line BEFORE multiplying back out by the
  // root's real outputPerCraft -- e.g. 1 Silicone Block on hand against
  // Industrial-grade Lubricant (needs 4/craft, outputs 10/craft) supports
  // ZERO completable units, not floor(1/4*10)=2.
  let supplyConstrainedUnits = Infinity;
  let limitingNode;
  for (const [branchNode, contribution] of branchContribution.entries()) {
    const branch = branches.get(branchNode);
    const rootCraftsSupportable = Math.floor(contribution.units / branch.perCraftQtyAtRoot);
    const rootUnitsSupportable = rootCraftsSupportable * rootOutputPerCraft;
    if (rootUnitsSupportable < supplyConstrainedUnits) {
      supplyConstrainedUnits = rootUnitsSupportable;
      limitingNode = contribution.entries.length === 1 ? contribution.entries[0] : branchNode;
    }
  }

  // [Important #2 fix] Always compute both terms -- when onHandEntries is
  // empty, supplyConstrainedUnits is still correctly Infinity (the loop
  // above never ran), so `targetItemOnHand + Infinity = Infinity` and
  // `Math.min(quantity, Infinity) = quantity` fall out correctly without a
  // separate branch for the empty-entries case.
  let maxCompletable;
  if (targetItemOnHand > 0 || onHandEntries.length > 0) {
    maxCompletable = {
      units: Math.min(quantity, targetItemOnHand + supplyConstrainedUnits),
      limitingNode
    };
  }

  return {
    ...plan,
    quantity,
    effectiveQuantity: plan.quantity,
    shortfall,
    maxCompletable
  };
}
