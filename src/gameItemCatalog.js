// src/gameItemCatalog.js
//
// Vendored, deduplicated copy of dune-awakening-selfhost-docker's own
// runtime/data/admin-items.json -- a static, human-curated catalog of every
// item in the game (2,551 unique ids after dedup; 2,558 in the source file,
// which had 7 real duplicate ids -- see gameItemCatalog.data.json's own
// generation command in this plan's Task 1 for the exact dedup method).
//
// Source: dune-awakening-selfhost-docker@db5d7f4073994de6ba16111c59b807b7056393c4
// (2026-09-18), runtime/data/admin-items.json. It has ZERO ingredient/recipe
// data -- it can only identify and name an item, never tell you what it
// costs to craft. src/craftingData.js's CRAFTING_RECIPES remains the only
// source of crafting math anywhere in this ecosystem; see
// src/gameItemIdBridge.js for how the two are connected.
//
// This is a one-time static copy, not a live dependency on Core -- see
// docs/superpowers/specs/2026-09-29-goal-order-tracking-design.md's Gap 1
// for the accepted staleness risk and its deferred remediation (a scheduled
// drift-check CI workflow, not built as part of this feature).

import { readFileSync } from "node:fs";

const raw = JSON.parse(readFileSync(new URL("./gameItemCatalog.data.json", import.meta.url), "utf8"));

export const GAME_ITEM_CATALOG = Object.freeze(raw.map((entry) => Object.freeze({ ...entry })));

export const GAME_ITEM_CATALOG_BY_ID = new Map(GAME_ITEM_CATALOG.map((entry) => [entry.id, entry]));
