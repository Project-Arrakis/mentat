import assert from "node:assert/strict";
import { test } from "node:test";
import { formatInventoryEmbed, formatStorageEmbed, formatFindEmbed, formatLinkEmbed, formatRolesEmbed, formatSetupEmbed } from "../src/embedFormat.js";

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

// ─── Real bug, found via a live report (2026-07-27): formatLinkEmbed()
// had ZERO test coverage of any kind before this fix -- no test in this
// entire repository ever called it, for any input. This is exactly why
// a real, live, user-facing bug shipped unnoticed: Core's
// linkPlayerProvider() gained a distinct { ok: true, alreadyLinked: true,
// message: "..." } response for a re-link of an already-linked
// character (a separate fix, same session), but this formatter always
// showed the identical generic "Character Linked" text regardless --
// so a real operator saw the SAME success message three times in a row
// for three different re-link attempts, with no visible difference from
// a genuine fresh link, and never saw Core's own explanatory (in-lore)
// message at all. These tests close that coverage gap directly. ───────

test("formatLinkEmbed shows a distinct 'Already Linked' embed with Core's own message when alreadyLinked is true", () => {
  const payload = {
    ok: true,
    alreadyLinked: true,
    characterName: "Sihaya",
    message: "Your voice already answers to Sihaya in the eyes of the Landsraad -- no further binding is required."
  };
  const embed = formatLinkEmbed(payload).toJSON();
  assert.equal(embed.title, "🔗 Already Linked");
  assert.ok(embed.description.includes("Landsraad"), "should show Core's own in-lore message verbatim");
  assert.ok(!embed.description.includes("Use `/dune data inventory`"), "must not show the fresh-link follow-up instructions for a no-op re-link");
});

test("formatLinkEmbed shows the normal 'Character Linked' embed for a genuine fresh link (alreadyLinked absent)", () => {
  const payload = { ok: true, characterName: "Sihaya" };
  const embed = formatLinkEmbed(payload).toJSON();
  assert.equal(embed.title, "🔗 Character Linked");
  assert.ok(embed.description.includes("Linked as **Sihaya**"));
});

test("formatLinkEmbed shows the failure embed for a rejected link (a different character already linked)", () => {
  const payload = { ok: false, error: "Your voice already answers to Sihaya in the eyes of the Landsraad. A soul may not walk two paths in the desert -- use /dune player unlink before you may bind yourself to Paul." };
  const embed = formatLinkEmbed(payload).toJSON();
  assert.equal(embed.title, "🔗 Link Failed");
  assert.ok(embed.description.includes("Paul"));
});

// Issue #238: rolesConfigPayload() (commands.js) now always/conditionally
// returns `owner` and `notice` fields that formatRolesEmbed previously
// silently dropped -- a real bug a code review caught (the CHANGELOG's
// promised "one-time notice" never actually rendered).
test("formatRolesEmbed shows the real owner's label as its own field, always, even with no configured roles", () => {
  const payload = { ok: true, source: "database (multi-tenant)", rbacMode: "restricted", owner: "Discord server owner (999)", roles: ["(no admin/moderator/player roles configured)"] };
  const embed = formatRolesEmbed(payload).toJSON();
  const ownerField = embed.fields.find((f) => f.name.includes("Owner"));
  assert.ok(ownerField, "should render a dedicated owner field");
  assert.ok(ownerField.value.includes("999"), "should show the real owner's label");
});

test("formatRolesEmbed surfaces a legacy owner-role notice when rolesConfigPayload sets one", () => {
  const payload = {
    ok: true,
    source: "database (multi-tenant)",
    rbacMode: "restricted",
    owner: "Discord server owner (999)",
    roles: ["admin: Mods (admin-role)"],
    notice: "This guild has a legacy 'Owner Role' mapping from before issue #238 -- it no longer grants owner-tier access. Only the real Discord server owner (shown above) does."
  };
  const embed = formatRolesEmbed(payload).toJSON();
  const noticeField = embed.fields.find((f) => f.name.includes("Notice"));
  assert.ok(noticeField, "should render the deprecation notice as its own field");
  assert.ok(noticeField.value.includes("issue #238"));
});

test("formatRolesEmbed omits the notice field when rolesConfigPayload has nothing to warn about", () => {
  const payload = { ok: true, source: "database (multi-tenant)", rbacMode: "restricted", owner: "Discord server owner (999)", roles: ["admin: Mods (admin-role)"] };
  const embed = formatRolesEmbed(payload).toJSON();
  assert.ok(!embed.fields.some((f) => f.name.includes("Notice")), "no notice field should appear when payload.notice is absent");
});

// L3 audit finding (2026-09-08): formatSetupEmbed()'s self-host branch
// hardcoded "**Permissions:** `0`" in its description text, but
// commands.js's setupPayload() (fixed for issue #281) now generates invite
// URLs with &permissions=128 -- leaving this embed directly contradicting
// the invite link it renders immediately above that same line. This test
// asserts the two stay consistent: whatever permissions value the real
// invite URL carries is the same value stated in the description text,
// rather than hardcoding an assumption about either side.
test("formatSetupEmbed's self-host description states the same permissions value the invite URL actually carries", () => {
  const inviteUrl = "https://discord.com/oauth2/authorize?client_id=123&scope=bot%20applications.commands&permissions=128";
  const embed = formatSetupEmbed({ inviteUrl, clientId: "123" }).toJSON();
  const permsInUrl = new URL(inviteUrl).searchParams.get("permissions");
  assert.ok(
    embed.description.includes(`Permissions:** \`${permsInUrl}\``),
    `description must state Permissions: \`${permsInUrl}\` to match the actual invite URL, not a stale hardcoded value`
  );
});
