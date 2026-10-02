//
// Recipe data and calculation formula derived from published Dune
// Awakening game mechanics; verified against
// https://dune.gaming.tools/crafting-calculator (fan reference site, not
// affiliated with Funcom/Legendary). See docs/calculator-grc.md for the
// full data-provenance and drift-risk disclosure this comment satisfies.
//
// Every recipe VARIANT (not just item) carries its own source/verifiedAt
// pair -- see docs/calculator-security-review.md FINDING-CALC-3. Recipe
// ratios drift with game balance patches; this data is "trust but verify",
// not authoritative -- see docs/calculator-grc.md's Data-Drift Risk
// section for the required re-verification discipline before ever editing
// a value here.

export const TIER_KEYS = Object.freeze(["small", "medium", "large"]);

export const LEAF_RESOURCES = Object.freeze({
  water: "Water",
  copper_ore: "Copper Ore",
  iron_ore: "Iron Ore",
  carbon_ore: "Carbon Ore",
  aluminum_ore: "Aluminum Ore",
  titanium_ore: "Titanium Ore",
  jasmium_crystal: "Jasmium Crystal",
  stravidium_mass: "Stravidium Mass",
  erythrite_crystal: "Erythrite Crystal",
  flour_sand: "Flour Sand",
  spice_residue: "Spice Residue",
  irradiated_slag: "Irradiated Slag",
  fuel_cell: "Fuel Cell"
});

const SOURCE_DATE = "2026-07-24";
const SOURCE_URL_COPPER = "https://dune.gaming.tools/items/copperbar";
const SOURCE_URL_IRON = "https://dune.gaming.tools/items/ironbar";
const SOURCE_URL_STEEL = "https://dune.gaming.tools/items/steelbar";
const SOURCE_URL_ALUMINUM = "https://dune.gaming.tools/items/aluminiumbar";
const SOURCE_URL_DURALUMINUM = "https://dune.gaming.tools/items/duraluminumrod";
const SOURCE_URL_PLASTANIUM = "https://dune.gaming.tools/items/t6refinedresourcea";
const SOURCE_URL_STRAVIDIUM = "https://dune.gaming.tools/items/t6refinedresourceb";
const SOURCE_URL_COBALT = "https://dune.gaming.tools/items/cobaltbar";
const SOURCE_URL_SILICONE = "https://dune.gaming.tools/items/silicone";
const SOURCE_URL_SMALL_FUEL = "https://dune.gaming.tools/items/fuelcanister";
const SOURCE_URL_MEDIUM_FUEL = "https://dune.gaming.tools/items/fuelcanister_medium";
const SOURCE_URL_LARGE_FUEL = "https://dune.gaming.tools/items/fuelcanister_large";
const SOURCE_URL_SPICE_FUEL = "https://dune.gaming.tools/items/spicedfuelcell";
const SOURCE_URL_LOW_LUBE = "https://dune.gaming.tools/items/windturbinelubricant1";
const SOURCE_URL_IND_LUBE = "https://dune.gaming.tools/items/windturbinelubricant2";

export const CRAFTING_RECIPES = Object.freeze({
  copper_ingot: Object.freeze({
    displayName: "Copper Ingot",
    tier: 1,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 3, inputs: Object.freeze([
        Object.freeze({ resource: "copper_ore", quantity: 2, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_COPPER, verifiedAt: SOURCE_DATE }) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 4, inputs: Object.freeze([
        Object.freeze({ resource: "copper_ore", quantity: 3, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_COPPER, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "copper_ore", quantity: 4, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_COPPER, verifiedAt: SOURCE_DATE }) })
    })
  }),

  iron_ingot: Object.freeze({
    displayName: "Iron Ingot",
    tier: 2,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 25, craftable: false }),
        Object.freeze({ resource: "iron_ore", quantity: 3, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_IRON, verifiedAt: SOURCE_DATE }) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 7, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 25, craftable: false }),
        Object.freeze({ resource: "iron_ore", quantity: 4, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_IRON, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Ore Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 25, craftable: false }),
        Object.freeze({ resource: "iron_ore", quantity: 5, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_IRON, verifiedAt: SOURCE_DATE }) })
    })
  }),

  steel_ingot: Object.freeze({
    displayName: "Steel Ingot",
    tier: 3,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 3, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "carbon_ore", quantity: 2, craftable: false }),
        Object.freeze({ resource: "iron_ingot", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_STEEL, verifiedAt: SOURCE_DATE }) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 4, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "carbon_ore", quantity: 3, craftable: false }),
        Object.freeze({ resource: "iron_ingot", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_STEEL, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "carbon_ore", quantity: 4, craftable: false }),
        Object.freeze({ resource: "iron_ingot", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_STEEL, verifiedAt: SOURCE_DATE }) })
    })
  }),

  aluminum_ingot: Object.freeze({
    displayName: "Aluminum Ingot",
    tier: 4,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 200, craftable: false }),
        Object.freeze({ resource: "aluminum_ore", quantity: 4, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_ALUMINUM, verifiedAt: SOURCE_DATE }) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 200, craftable: false }),
        Object.freeze({ resource: "aluminum_ore", quantity: 7, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_ALUMINUM, verifiedAt: SOURCE_DATE }) })
    })
  }),

  duraluminum_ingot: Object.freeze({
    displayName: "Duraluminum Ingot",
    tier: 5,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 4, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 500, craftable: false }),
        Object.freeze({ resource: "jasmium_crystal", quantity: 3, craftable: false }),
        Object.freeze({ resource: "aluminum_ingot", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_DURALUMINUM, verifiedAt: SOURCE_DATE }) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 5, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 500, craftable: false }),
        Object.freeze({ resource: "jasmium_crystal", quantity: 4, craftable: false }),
        Object.freeze({ resource: "aluminum_ingot", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_DURALUMINUM, verifiedAt: SOURCE_DATE }) })
    })
  }),

  plastanium_ingot: Object.freeze({
    displayName: "Plastanium Ingot",
    tier: 6,
    outputPerCraft: 1,
    variants: Object.freeze({
      large: Object.freeze({ station: "Large Ore Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 1250, craftable: false }),
        Object.freeze({ resource: "titanium_ore", quantity: 4, craftable: false }),
        Object.freeze({ resource: "stravidium_fiber", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_PLASTANIUM, verifiedAt: SOURCE_DATE }) }),
      medium: Object.freeze({ station: "Medium Ore Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 1250, craftable: false }),
        Object.freeze({ resource: "titanium_ore", quantity: 6, craftable: false }),
        Object.freeze({ resource: "stravidium_fiber", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_PLASTANIUM, verifiedAt: SOURCE_DATE }) })
    })
  }),

  stravidium_fiber: Object.freeze({
    displayName: "Stravidium Fiber",
    tier: 6,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 100, craftable: false }),
        Object.freeze({ resource: "stravidium_mass", quantity: 3, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_STRAVIDIUM, verifiedAt: SOURCE_DATE }) })
    })
  }),

  cobalt_paste: Object.freeze({
    displayName: "Cobalt Paste",
    tier: 3,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 75, craftable: false }),
        Object.freeze({ resource: "erythrite_crystal", quantity: 2, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_COBALT, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 75, craftable: false }),
        Object.freeze({ resource: "erythrite_crystal", quantity: 3, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_COBALT, verifiedAt: SOURCE_DATE }) })
    })
  }),

  silicone_block: Object.freeze({
    displayName: "Silicone Block",
    tier: 2,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "flour_sand", quantity: 3, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_SILICONE, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 50, craftable: false }),
        Object.freeze({ resource: "flour_sand", quantity: 5, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_SILICONE, verifiedAt: SOURCE_DATE }) })
    })
  }),

  small_fuel_cell: Object.freeze({
    displayName: "Small Vehicle Fuel Cell",
    tier: 1,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 10, inputs: Object.freeze([
        Object.freeze({ resource: "fuel_cell", quantity: 20, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_SMALL_FUEL, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "fuel_cell", quantity: 25, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_SMALL_FUEL, verifiedAt: SOURCE_DATE }) })
    })
  }),

  medium_fuel_cell: Object.freeze({
    displayName: "Medium Vehicle Fuel Cell",
    tier: 3,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 40, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_MEDIUM_FUEL, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 45, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_MEDIUM_FUEL, verifiedAt: SOURCE_DATE }) })
    })
  }),

  large_fuel_cell: Object.freeze({
    displayName: "Large Vehicle Fuel Cell",
    tier: 4,
    outputPerCraft: 1,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 30, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 80, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_LARGE_FUEL, verifiedAt: SOURCE_DATE }) })
    })
  }),

  spice_fuel_cell: Object.freeze({
    displayName: "Spice-infused Fuel Cell",
    tier: 6,
    outputPerCraft: 10,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 200, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 30, craftable: false }),
        Object.freeze({ resource: "spice_residue", quantity: 48, craftable: false }),
        Object.freeze({ resource: "irradiated_slag", quantity: 2, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_SPICE_FUEL, verifiedAt: SOURCE_DATE }) })
    })
  }),

  low_grade_lubricant: Object.freeze({
    displayName: "Low-grade Lubricant",
    tier: 3,
    outputPerCraft: 5,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 15, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 4, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 1, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_LOW_LUBE, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 20, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 4, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 2, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 1, craftable: true })
      ]), source: Object.freeze({ url: SOURCE_URL_LOW_LUBE, verifiedAt: SOURCE_DATE }) })
    })
  }),

  industrial_lubricant: Object.freeze({
    displayName: "Industrial-grade Lubricant",
    tier: 5,
    outputPerCraft: 10,
    variants: Object.freeze({
      medium: Object.freeze({ station: "Medium Chemical Refinery", craftTimeSeconds: 30, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 6, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 4, craftable: true }),
        Object.freeze({ resource: "spice_residue", quantity: 5, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_IND_LUBE, verifiedAt: SOURCE_DATE }) }),
      small: Object.freeze({ station: "Small Chemical Refinery", craftTimeSeconds: 40, inputs: Object.freeze([
        Object.freeze({ resource: "water", quantity: 15, craftable: false }),
        Object.freeze({ resource: "fuel_cell", quantity: 8, craftable: false }),
        Object.freeze({ resource: "silicone_block", quantity: 4, craftable: true }),
        Object.freeze({ resource: "spice_residue", quantity: 5, craftable: false })
      ]), source: Object.freeze({ url: SOURCE_URL_IND_LUBE, verifiedAt: SOURCE_DATE }) })
    })
  })
});
