import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInventoryEmbed, formatStorageEmbed, formatFindEmbed } from "../src/embedFormat.js";

// ─── Real bug, found via a live user report (2026-07-26/27) ────────────────
//
// Core added a display_name field to every inventory/storage/find row
// (dune-awakening-selfhost-docker, inventoryProvider.js) to fix raw
// internal item IDs (AzuriteOre, Bloodsack_01) being shown to players
// instead of real names (Copper Ore, Small Blood Sack). But this file's
// three formatters checked item.displayName (camelCase) -- a field name
// that never existed on either the old or new Core response shape --
// instead of item.display_name (snake_case, matching every other field
// on these rows: stack_size, quality_level, template_id). Without this
// fix, Core's real display_name field would have been silently ignored
// and every formatter would still show the raw template_id.

test("formatInventoryEmbed shows display_name when Core provides it", () => {
  const payload = {
    ok: true,
    characterName: "Sihaya",
    count: 1,
    rows: [{ template_id: "AzuriteOre", display_name: "Copper Ore", stack_size: 72 }]
  };
  const embed = formatInventoryEmbed(payload).toJSON();
  assert.ok(embed.description.includes("Copper Ore"), "should show the real display name");
  assert.ok(!embed.description.includes("AzuriteOre"), "should not show the raw template_id when a display_name is available");
});

test("formatInventoryEmbed falls back to template_id when display_name is absent (Core not yet updated, or item genuinely not in the catalog)", () => {
  const payload = {
    ok: true,
    characterName: "Sihaya",
    count: 1,
    rows: [{ template_id: "SomeFutureItem", stack_size: 1 }]
  };
  const embed = formatInventoryEmbed(payload).toJSON();
  assert.ok(embed.description.includes("SomeFutureItem"));
});

// ─── Real payload-contract bug, found via a live user report (2026-07-27) ──
//
// formatStorageEmbed and formatFindEmbed both read a payload shape
// (payload.groups / totalContainers / totalItems, payload.matches /
// totalItemStacks -- all camelCase, nested map-of-arrays) that Core's
// playerStorageProvider / itemSearchProvider have NEVER actually
// returned, since this file's storage/find formatters were first added
// (commit a15d4a8, 2026-07-20). Core has always returned a flat
// { grouped, rows, count } shape. This meant /dune player storage always
// showed "No owned storage containers found" regardless of real data --
// confirmed live against a real user's base with 5 real containers,
// including a Spice Silo holding real Stone stacks. These tests use
// Core's actual real response shape (grouped: [...], not
// groups: {...}), confirmed via a direct curl against the live adapter
// API, not a shape the agent assumed was correct.

test("formatStorageEmbed shows real containers using Core's actual grouped-array shape", () => {
  const payload = {
    ok: true,
    scope: "owned",
    grouped: [
      { container_id: "13", container_name: "SpiceSilo_Placeable", item_count: 5, items: [] },
      { container_id: "6", container_name: "Totem_Small_Placeable", item_count: 0, items: [] }
    ],
    rows: [],
    count: 2
  };
  const embed = formatStorageEmbed(payload).toJSON();
  assert.ok(embed.description.includes("SpiceSilo_Placeable"), "should show the real container name");
  assert.ok(embed.description.includes("Totem_Small_Placeable"));
  assert.ok(!embed.description.includes("No owned storage containers found"), "must not show the empty-state message when real containers exist");
});

test("formatStorageEmbed shows the empty-state message only when grouped is genuinely empty", () => {
  const payload = { ok: true, scope: "owned", grouped: [], rows: [], count: 0 };
  const embed = formatStorageEmbed(payload).toJSON();
  assert.ok(embed.description.includes("No owned storage containers found"));
});

test("formatFindEmbed shows display_name and real container/map context using Core's actual grouped-by-item-type shape", () => {
  const payload = {
    ok: true,
    query: "stone",
    grouped: [{
      template_id: "Stone",
      total_count: 2477,
      items: [
        { template_id: "Stone", display_name: "Granite Stone", stack_size: 500, container_name: "SpiceSilo_Placeable", map: "HaggaBasin" }
      ]
    }],
    rows: [{ template_id: "Stone", display_name: "Granite Stone", stack_size: 500 }]
  };
  const embed = formatFindEmbed(payload).toJSON();
  assert.ok(embed.description.includes("Granite Stone"), "should show the real display name, not the raw template_id");
  assert.ok(!embed.description.includes("`Stone`"), "should not show the raw template_id when a display_name is available");
  assert.ok(embed.description.includes("SpiceSilo_Placeable"), "should show which real container the item was found in");
  assert.ok(embed.description.includes("HaggaBasin"), "should show which real map the item was found on");
});

test("formatFindEmbed shows the empty-state message only when grouped is genuinely empty", () => {
  const payload = { ok: true, query: "nonexistent", grouped: [], rows: [] };
  const embed = formatFindEmbed(payload).toJSON();
  assert.ok(embed.description.includes('No items matching "nonexistent" found'));
});
