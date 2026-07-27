import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInventoryEmbed, formatFindEmbed } from "../src/embedFormat.js";

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

test("formatFindEmbed shows display_name for matched items when Core provides it", () => {
  const payload = {
    ok: true,
    query: "ore",
    matches: [{
      containerName: "Storage Chest",
      map: "Hagga Basin",
      items: [{ template_id: "AzuriteOre", display_name: "Copper Ore", stack_size: 9 }]
    }]
  };
  const embed = formatFindEmbed(payload).toJSON();
  assert.ok(embed.description.includes("Copper Ore"));
  assert.ok(!embed.description.includes("AzuriteOre"));
});
