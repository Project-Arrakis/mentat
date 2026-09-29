// src/gameItemIdBridge.js
//
// Bridges mentat's own snake_case recipe/leaf keys (src/craftingData.js) to
// Core's real game item ids (src/gameItemCatalog.js) -- a standalone module,
// deliberately NOT a field added to CRAFTING_RECIPES/LEAF_RESOURCES (those
// stay completely untouched; LEAF_RESOURCES values are plain strings, not
// objects, so "adding a field" to them isn't possible without a breaking
// shape change -- see docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md's
// [H2] finding for the full story).
//
// Both Maps are real ES Maps, never plain objects -- see FINDING-CALC-3/S-2
// and its repeat (found by /code-review high on PR #417) for why a bare
// object lookup here would be a real, repeated prototype-pollution class in
// this codebase, now with PERSISTED data instead of Phase 1's stateless one.
//
// Every id below was verified by hand against
// dune-awakening-selfhost-docker@db5d7f4073994de6ba16111c59b807b7056393c4's
// runtime/data/admin-items.json (see src/gameItemCatalog.js's own
// provenance comment) -- do not guess a new entry here without the same
// verification.
//
// CONFIRMED EXCEPTION -- "water" (LEAF_RESOURCES.water, display name
// "Water") is deliberately NOT included below, as a documented, tested
// exception rather than a silent omission. There is no discrete "Water"
// inventory item anywhere in the game's own catalog -- verified directly
// against both the deduplicated vendored copy (src/gameItemCatalog.data.json,
// 2,551 entries) and independently re-verified against the full 2,558-row
// source catalog: no id or name containing "water" (nor any reasonable
// synonym -- canteen, h2o, hydrate, moisture, aqua, liquid, filtered/
// purified/desalinated/fresh/raw/reclaimed/distilled water, still/condens*)
// resolves to a plain raw "Water" item. Only water-adjacent infrastructure
// exists (Water Cistern patents, Water Shipper patents/cosmetics, a "Cup of
// Water" consumable, etc.) -- none of which is the bulk refinery input
// craftingData.js's `water` key represents. In the real game, water is
// drawn from cisterns, not carried as a discrete inventory stack -- this is
// a confirmed fact about what the game itself itemizes, not a vendoring
// mistake or a search gap (see task-2-report.md for the full list of
// searches run). RECIPE_KEY_TO_GAME_ITEM_ID.has("water") is false by
// design; test/gameItemIdBridge.test.js asserts this explicitly so the
// exception can never silently regress into an accidental omission.

export const RECIPE_KEY_TO_GAME_ITEM_ID = new Map([
  // CRAFTING_RECIPES
  ["copper_ingot", "CopperBar"],
  ["iron_ingot", "IronBar"],
  ["steel_ingot", "SteelBar"],
  ["aluminum_ingot", "AluminiumBar"],
  ["duraluminum_ingot", "DuraluminumRod"],
  ["plastanium_ingot", "T6RefinedResourceA"],
  ["stravidium_fiber", "T6RefinedResourceB"],
  ["cobalt_paste", "CobaltBar"],
  ["silicone_block", "Silicone"],
  ["small_fuel_cell", "FuelCanister"],
  ["medium_fuel_cell", "FuelCanister_Medium"],
  ["large_fuel_cell", "FuelCanister_Large"],
  ["spice_fuel_cell", "SpicedFuelCell"],
  ["low_grade_lubricant", "WindTurbineLubricant1"],
  ["industrial_lubricant", "WindTurbineLubricant2"],
  // LEAF_RESOURCES
  // "water" intentionally excluded -- see CONFIRMED EXCEPTION note above.
  // Not a bug, not a TODO: there is no real game item id for it.
  ["copper_ore", "AzuriteOre"],
  ["iron_ore", "MagnetiteOre"],
  ["carbon_ore", "DolomiteRock"],
  ["aluminum_ore", "BauxiteOre"],
  ["titanium_ore", "T6ResourceA"],
  ["jasmium_crystal", "JasmiumCrystal"],
  ["stravidium_mass", "T6ResourceB"],
  ["erythrite_crystal", "ErythriteCrystal"],
  ["flour_sand", "FlourSand"],
  ["spice_residue", "SpiceResidue"],
  ["irradiated_slag", "T5RadiatedCoreComponent"],
  ["fuel_cell", "Oil"]
]);

export const GAME_ITEM_ID_TO_RECIPE_KEY = new Map(
  [...RECIPE_KEY_TO_GAME_ITEM_ID].map(([recipeKey, gameItemId]) => [gameItemId, recipeKey])
);
