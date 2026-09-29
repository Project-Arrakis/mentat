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
function flattenPlanNodes(plan) {
  // Returns a Map<nodeKey, { pooledQuantity, isIntermediate }> covering the
  // target item itself, every intermediate craftable, and every raw leaf --
  // everything an on-hand-N value could legally name. `pooledQuantity` for a
  // raw leaf comes from `plan.totalRawMaterials`, which is ALREADY pooled
  // across every level of the tree (e.g. Water under both Plastanium Ingot's
  // own recipe AND its nested Stravidium Fiber recipe) -- this is what makes
  // reusing this exact structure at any candidate quantity (see
  // computeShortfallMap() below) correctly handle cross-level pooling by
  // construction, with no separate per-branch bookkeeping needed.
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

// Applies every on-hand credit against `plan`'s pooled node totals, cascading
// an intermediate craftable's own credit proportionally into its own
// (depth-1) raw inputs -- never upward past the intermediate itself. This is
// the one, single source of shortfall-subtraction truth: both the `shortfall`
// map applyOnHandCredit() returns AND the binary-search coverage oracle below
// call this same function, just against plans sized for different candidate
// quantities -- see docs/calculator-architecture.md's Shortfall Traversal
// Design citation. Throws if any `onHandEntries[].node` isn't anywhere in
// `plan`'s tree (finding S-2's "__proto__" case included, since a Map lookup
// for an unset key is always `undefined`, never `Object.prototype`).
function computeShortfallMap(plan, onHandEntries) {
  const nodeMap = flattenPlanNodes(plan); // Map, per finding S-2
  const shortfall = new Map();
  for (const [key, info] of nodeMap.entries()) {
    if (key === plan.itemKey) continue; // target item's own shortfall isn't tracked here -- see effectiveQuantity
    shortfall.set(key, info.pooledQuantity);
  }

  for (const entry of onHandEntries) {
    const info = nodeMap.get(entry.node); // Map.get -- never `nodeMap[entry.node]`
    if (!info) {
      throw new Error(`"${entry.node}" is not an ingredient of ${plan.itemKey}.`);
    }

    const currentShortfall = shortfall.get(entry.node) ?? 0;
    const newShortfall = Math.max(0, currentShortfall - entry.quantity);
    shortfall.set(entry.node, newShortfall);

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
  }

  return shortfall;
}

// Map<intermediateNode, Set<leafChildNode>> -- the recipe TREE SHAPE (which
// resources are craftable, which are leaves, which leaves belong to which
// intermediate) is invariant to quantity, so this is built once from
// whatever plan is on hand and reused across every candidate quantity the
// binary search below tries. depth-1 only, matching every other accepted
// limitation in this file (real data has no depth-2+ nesting -- Task 1's own
// data-integrity test enforces this).
function buildIntermediateChildMap(plan) {
  const children = new Map();
  for (const [resource, nested] of Object.entries(plan.nestedCrafts)) {
    const leafChildren = new Set();
    for (const input of nested.directInputs) {
      if (!input.craftable) leafChildren.add(input.resource);
    }
    children.set(resource, leafChildren);
  }
  return children;
}

// Returns the first on-hand entry (in onHandEntries order) whose credit does
// NOT fully cover quantity `n`'s requirement, or undefined if every entry is
// covered. This is the coverage oracle both isFullyCoveredAt() and
// applyOnHandCredit()'s own limitingNode lookup share.
//
// [Critical #2] An intermediate credited ALONGSIDE one of its own (depth-1)
// leaf inputs must have those two credits COMBINE, not compete: e.g.
// crediting Stravidium Fiber 8 (the intermediate) and Stravidium Mass 60 (its
// own leaf) together should read as "28 fiber-equivalent," not two
// independent constraints capped at 8. The naive fix -- just check every
// credited node's own shortfall map entry -- does NOT achieve this, because
// computeShortfallMap()'s cascade only flows DOWNWARD (intermediate credit
// reduces its leaf's shortfall) and never back UP (a leaf's own direct credit
// never reduces the intermediate's own tracked shortfall entry): hand-traced
// against the Fiber-8/Mass-60 example, Fiber's own shortfall entry stays at
// `quantity - 8` forever, which would wrongly cap coverage at 8 forever if
// checked directly. The algebraically-verified fix is to skip an
// intermediate's own shortfall check whenever one of its own leaf children is
// ALSO credited, and trust that leaf's own (cascade-adjusted) shortfall
// check instead -- for the depth-1, single-credited-leaf case this reduces to
// exactly `leafPooledQty * (1 - directIntermediateCredit / intermediatePooledQty) <= leafCredit`,
// which is the same combination formula the round-1 branch-index fix used,
// arrived at independently and confirmed algebraically equivalent (up to
// integer rounding) rather than assumed.
function findFirstBlockingEntry(itemKey, n, options, onHandEntries, intermediateChildren) {
  if (n <= 0) return undefined;
  const planAtN = calculateCraftingPlan(itemKey, n, options);
  const shortfallAtN = computeShortfallMap(planAtN, onHandEntries);
  const creditedNodes = new Set(onHandEntries.map((entry) => entry.node)); // Set, per finding S-2

  for (const entry of onHandEntries) {
    const leafChildren = intermediateChildren.get(entry.node);
    if (leafChildren && [...leafChildren].some((child) => creditedNodes.has(child))) {
      continue; // combined with a credited child -- trust that child's own check instead
    }
    if ((shortfallAtN.get(entry.node) ?? 0) > 0) return entry.node;
  }
  return undefined;
}

function isFullyCoveredAt(itemKey, n, options, onHandEntries, intermediateChildren) {
  return findFirstBlockingEntry(itemKey, n, options, onHandEntries, intermediateChildren) === undefined;
}

// [Critical #1] Binary search over candidate quantities, using
// isFullyCoveredAt() (built directly on calculateCraftingPlan() +
// computeShortfallMap(), both already-verified-correct pooling/rounding
// logic) as the oracle, rather than deriving a second, parallel ratio-based
// formula. This naturally respects each recipe's real outputPerCraft/
// whole-craft granularity for free -- calculateCraftingPlan(itemKey, n, ...)
// already does real ceiling-rounding batching at every candidate `n`, so
// there is no separate output-per-craft math to get wrong. Monotonic by
// construction (pooled raw-material requirements never decrease as `n`
// increases), so binary search is valid.
function binarySearchMaxCompletable(itemKey, options, onHandEntries, quantity, intermediateChildren) {
  let lo = 0;
  let hi = quantity;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (isFullyCoveredAt(itemKey, mid, options, onHandEntries, intermediateChildren)) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
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

  // The `shortfall` this function returns is always reported against the
  // GIVEN plan (whatever quantity it was computed at) -- this also serves as
  // this function's node-existence validation (throws "is not an ingredient
  // of ..." for any unknown node), independent of the binary search below.
  const shortfall = computeShortfallMap(plan, onHandEntries);

  // [Critical, round 2] supplyConstrainedUnits is now found via binary
  // search against the real recipe tree at each candidate quantity, NOT a
  // derived per-branch ratio -- a prior branch-index approach routed a
  // resource pooled across BOTH the root's own recipe AND a nested
  // intermediate's recipe (e.g. Water under Plastanium Ingot directly AND
  // under its nested Stravidium Fiber) into only the root's own branch,
  // silently ignoring the nested contribution and overstating completability
  // (the dangerous direction for a player's farming decision). Reusing
  // computeShortfallMap()'s pooled totals (built from
  // calculateCraftingPlan()'s own already-verified totalRawMaterials pooling)
  // as the coverage oracle fixes this by construction.
  let supplyConstrainedUnits = Infinity;
  let limitingNode;
  if (onHandEntries.length > 0) {
    const options = { stationTier: plan.stationTier, craftingContract: plan.craftingContract };
    const intermediateChildren = buildIntermediateChildMap(plan); // Map, per finding S-2
    supplyConstrainedUnits = binarySearchMaxCompletable(plan.itemKey, options, onHandEntries, quantity, intermediateChildren);
    if (supplyConstrainedUnits < quantity) {
      limitingNode = findFirstBlockingEntry(plan.itemKey, supplyConstrainedUnits + 1, options, onHandEntries, intermediateChildren);
    }
  }

  // [Important #2 fix] Always compute both terms -- when onHandEntries is
  // empty, supplyConstrainedUnits is still correctly Infinity (the binary
  // search above never ran), so `targetItemOnHand + Infinity = Infinity` and
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
