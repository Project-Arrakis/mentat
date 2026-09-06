/**
 * Regression tests for the 2026-08-20 UI/UX review remediation
 * (issues #210, #211, #212, #215, #218). Each test pins a rendering
 * behavior that was verified broken against real payload shapes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  duneEmbed,
  formatCombatEmbed,
  formatResourcesEmbed,
  formatEconomyEmbed,
  formatLocationEmbed,
  formatPopulationEmbed,
  formatHelpEmbed,
  formatLogsEmbed,
  formatServicesSummaryEmbed,
  formatSyncCommandsEmbed,
  formatVersionEmbed,
  formatAlertsEmbed
} from "../src/embedFormat.js";
import { executeDuneCommand, helpPayload, statusSummaryPayload } from "../src/commands.js";
import { loadRegistryAtStartup, __resetForTests } from "../src/registryLoader.js";
import { resetCooldowns } from "../src/cooldown.js";

const fieldNames = (embed) => (embed.data.fields || []).map((f) => f.name);
const fieldValues = (embed) => (embed.data.fields || []).map((f) => f.value);

// ── #218/PR1: no flavor quote on error embeds ──

test("duneEmbed: error embeds carry no flavor quote; normal embeds do", () => {
  const err = duneEmbed({ title: "x", color: "error", description: "boom" });
  assert.ok(!fieldValues(err).some((v) => v.startsWith('*"')), "error embed must not end with a quote");

  const ok = duneEmbed({ title: "x", color: "success", description: "fine" });
  assert.ok(fieldValues(ok).some((v) => v.startsWith('*"')), "non-error embed keeps the flavor quote");
});

// ── #218/T3: overflow fields are marked, not silently dropped ──

test("duneEmbed: overflowing field lists get an explicit '…and N more' marker", () => {
  const fields = Array.from({ length: 30 }, (_, i) => ({ name: `f${i}`, value: "v", inline: true }));
  const embed = duneEmbed({ title: "x", fields });
  const values = fieldValues(embed);
  assert.ok(values.some((v) => /and \d+ more entr/.test(v)), "must announce dropped fields");
  assert.ok((embed.data.fields || []).length <= 25, "must respect Discord's 25-field cap");
});

// ── #212: resources formatter must not crash on real summary-less payloads ──

test("formatResourcesEmbed: summary-less Deep Desert instances do not crash (sf ReferenceError regression)", () => {
  const payload = {
    ok: true,
    result: {
      deepDesert: {
        instances: [
          { name: "DD-1", type: "pve", sizes: [{ size: "small", activeFields: 2, remainingSpice: 100 }] },
          { name: "DD-2", type: "pvp", smallActiveFields: 1, smallRemainingSpice: 50 }
        ]
      },
      haggaBasin: {
        sietches: [
          { name: "Sietch Tabr", type: "pve", sizes: [{ size: "small", activeFields: 3, remainingSpice: 400 }] }
        ]
      }
    }
  };
  assert.doesNotThrow(() => formatResourcesEmbed(payload));
  const embed = formatResourcesEmbed(payload);
  assert.ok(fieldNames(embed).some((n) => n.includes("Deep Desert")));
  assert.ok(fieldNames(embed).some((n) => n.includes("Hagga Basin")));
});

// ── #212/T1: empty top-lists must not emit empty (Discord-rejected) fields ──

test("empty top-lists never produce empty field values", () => {
  const combat = formatCombatEmbed({ result: { deaths: 0, topPvP: [] } });
  const economy = formatEconomyEmbed({ result: { totalCurrency: 0, topTraders: [] } });
  const location = formatLocationEmbed({ result: { activeMaps: 0, hotspots: [] } });
  for (const embed of [combat, economy, location]) {
    for (const v of fieldValues(embed)) {
      assert.ok(String(v).length > 0, "no field may have an empty value (Discord rejects the whole embed)");
    }
  }
});

// ── #215/A7: missing population is not a green success ──

test("formatPopulationEmbed: missing counts render warning, never green 'unknown players online'", () => {
  const embed = formatPopulationEmbed({ ok: true, online: null, total: null, aggregate: true, detailsSuppressed: true });
  assert.equal(embed.data.color, 0xF39C12, "missing data must render warning, not success");
  assert.doesNotMatch(embed.data.description, /unknown.*players online/i);
  const shown = formatPopulationEmbed({ ok: true, online: 12, total: 40, detailsSuppressed: false });
  assert.equal(shown.data.color, 0x2ECC71);
  assert.ok(fieldValues(shown).some((v) => v.includes("Visible")), 'details label is "Visible", not "Exposed"');
});

// ── #210/U1: help renders the full command surface ──

test("formatHelpEmbed: every available command appears (no 5-item generic slice)", () => {
  const payload = helpPayload(
    { multiTenant: false, discord: { rbac: { mode: "open", observerRoleIds: [], adminRoleIds: [], commandRoleIds: {} }, defaultEphemeral: true } },
    { member: { roles: [] }, user: { id: "u" }, guildId: null }
  );
  const embed = formatHelpEmbed(payload);
  const allText = fieldValues(embed).join(" ");
  for (const name of payload.available) {
    const short = name.includes(":") ? name.split(":").slice(1).join(":") : name;
    assert.ok(allText.includes(`\`${short}\``), `help embed must list "${name}"`);
  }
  for (const v of fieldValues(embed)) {
    assert.ok(v.length <= 1024, "field values must respect Discord's 1024-char limit");
  }
});

// ── #210/T2/P3: logs render as code block with a real line budget ──

test("formatLogsEmbed: renders many lines in a code block, marks omissions", () => {
  const lines = Array.from({ length: 40 }, (_, i) => `2026-08-20T12:00:${String(i).padStart(2, "0")} log line **${i}** with_markdown`);
  const embed = formatLogsEmbed({ logs: lines }, "dune-server");
  assert.match(embed.data.description, /^```/, "logs must render as a code block");
  const shownCount = (embed.data.description.match(/log line/g) || []).length;
  assert.ok(shownCount > 5, `must show more than the old 5-line cap (got ${shownCount})`);
});

// ── #210/U6: services summary names actual services ──

test("formatServicesSummaryEmbed: names each service and its state", () => {
  const embed = formatServicesSummaryEmbed({ ok: true, result: { services: [
    { name: "orchestrator", status: "up" },
    { name: "dune-server", status: "down" }
  ] } });
  const names = fieldNames(embed).join(" ");
  assert.ok(names.includes("orchestrator"), "must name services");
  assert.ok(names.includes("dune-server"));
  assert.match(embed.data.description, /1 of 2 services unhealthy/);
});

// ── #211/U2: ops alerts must not fall through to a nonexistent adapter method ──

test("ops alerts: no fallthrough to adapterClient.opsAlerts (raw 'is not a function' regression)", async () => {
  __resetForTests();
  loadRegistryAtStartup();
  resetCooldowns();
  // adapterClient deliberately has NO opsAlerts method — the old
  // fallthrough would surface "adapterClient.opsAlerts is not a function".
  const adapterClient = {};
  let replied;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "dune",
    options: { getSubcommandGroup: () => "ops", getSubcommand: () => "alerts", getBoolean: () => false, getString: () => "" },
    user: { id: "user-1" },
    member: { roles: [] },
    guildId: null,
    channelId: "c1",
    deferReply: async () => {},
    editReply: async (r) => { replied = r; },
    reply: async (r) => { replied = r; }
  };
  const config = { multiTenant: false, discord: { defaultEphemeral: true, rbac: { mode: "open", observerRoleIds: [], adminRoleIds: [], commandRoleIds: {} } } };

  await executeDuneCommand(interaction, adapterClient, config);
  const text = JSON.stringify(replied);
  assert.doesNotMatch(text, /is not a function/, "must never leak a raw JS dispatch error");
});

// ── #210/P1 + #215/A10: drift report labels its caps ──

// ── #219/F1: ops/infra:version embeds must never carry unredacted data ──

test("ops route: embed is built from the REDACTED payload, not the raw one", async () => {
  __resetForTests();
  loadRegistryAtStartup();
  resetCooldowns();
  const secretResult = { activeLast1h: 5, activeLastDay: 5, apiToken: "ghp_SUPERSECRETVALUE123" };
  const adapterClient = { opsActivity: async () => ({ result: secretResult }) };
  let replied;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "dune",
    options: { getSubcommandGroup: () => "ops", getSubcommand: () => "activity", getBoolean: () => false, getString: () => "" },
    user: { id: "user-1" }, member: { roles: [] }, guildId: null, channelId: "c1",
    deferReply: async () => {}, editReply: async (r) => { replied = r; }, reply: async (r) => { replied = r; }
  };
  const config = { multiTenant: false, discord: { defaultEphemeral: true, rbac: { mode: "open", observerRoleIds: [], adminRoleIds: [], commandRoleIds: {} } } };

  await executeDuneCommand(interaction, adapterClient, config);
  const text = JSON.stringify(replied);
  assert.doesNotMatch(text, /ghp_SUPERSECRETVALUE123/, "raw secret must never reach the sent embed (redactSecrets bypass regression)");
});

test("infra:version: embed is built from the REDACTED payload", async () => {
  __resetForTests();
  loadRegistryAtStartup();
  resetCooldowns();
  const adapterClient = { version: async () => ({ version: "1.3.87", adapter: { deployToken: "ghp_SUPERSECRETVALUE456" } }) };
  let replied;
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "dune",
    options: { getSubcommandGroup: () => "infra", getSubcommand: () => "version", getBoolean: () => false, getString: () => "" },
    user: { id: "user-1" }, member: { roles: [] }, guildId: null, channelId: "c1",
    deferReply: async () => {}, editReply: async (r) => { replied = r; }, reply: async (r) => { replied = r; }
  };
  const config = { multiTenant: false, discord: { defaultEphemeral: true, rbac: { mode: "open", observerRoleIds: [], adminRoleIds: [], commandRoleIds: {} } } };

  await executeDuneCommand(interaction, adapterClient, config);
  const text = JSON.stringify(replied);
  assert.doesNotMatch(text, /ghp_SUPERSECRETVALUE456/, "raw secret must never reach the sent embed (redactSecrets bypass regression)");
});

// ── #220/F2: dedicated ops formatters must render Core's REAL shapes ──

test("formatResourcesEmbed: renders Core's real Deep Desert/Hagga Basin shape (dimensionIndex/sizes/combatState)", () => {
  const payload = {
    ok: true,
    result: {
      deepDesert: {
        summary: { totalActiveFields: 6, totalRemainingSpice: 57000, pvpInstances: 1, pveInstances: 1, bySize: [{ size: "small", activeFields: 6, remainingSpice: 57000 }] },
        instances: [
          { dimensionIndex: 1, name: "Deep Desert 1", combatState: "PVE", activeFields: 4, remainingSpice: 40000, sizes: [{ size: "small", activeFields: 4, remainingSpice: 40000 }] },
          { dimensionIndex: 2, name: "Deep Desert 2", combatState: "PVP", activeFields: 2, remainingSpice: 17000, sizes: [{ size: "small", activeFields: 2, remainingSpice: 17000 }] }
        ]
      },
      haggaBasin: {
        summary: { totalActiveFields: 3, totalRemainingSpice: 9000, pvpInstances: 0, pveInstances: 1 },
        instances: [{ name: "Sietch Tabr", combatState: "PVE", activeFields: 3, remainingSpice: 9000, sizes: [{ size: "small", activeFields: 3, remainingSpice: 9000 }] }]
      }
    }
  };
  const embed = formatResourcesEmbed(payload);
  const text = JSON.stringify(embed.data);
  assert.match(text, /Total Active Fields:\*\* 6/, "Deep Desert summary must reflect real totals");
  assert.doesNotMatch(text, /0 active   0 remaining/, "instance rows must not contradict a non-zero summary");
  assert.match(text, /Sietch Tabr/, "Hagga Basin instances (not `sietches`) must render");
  assert.match(text, /Total Sietches:\*\* 1/);
});

test("formatEconomyEmbed: renders Core's real economy keys (totalSupply/fulfilledOrders/topTradedItems)", () => {
  const embed = formatEconomyEmbed({ result: {
    totalSupply: 500000, totalCurrencyHolders: 42, activeOrders: 8, fulfilledOrders: 120, taxCollected: 3000,
    topTradedItems: [{ display_name: "Spice Melange", count: 900 }]
  } });
  const values = fieldValues(embed);
  assert.ok(values.some((v) => v.includes("500")), "totalSupply must render, not '— None —'");
  assert.ok(values.some((v) => v.includes("120")), "fulfilledOrders must render");
  assert.ok(fieldNames(embed).some((n) => n.includes("Top Traded Items")));
});

test("formatCombatEmbed: renders Core's real deathsByCause ARRAY shape", () => {
  const embed = formatCombatEmbed({ result: {
    totalDeaths: 10, deathsByCause: [{ cause: "Sandworm", count: 6 }, { cause: "Coriolis", count: 4 }]
  } });
  const values = fieldValues(embed);
  assert.ok(values.some((v) => v.includes("Sandworm: 6")), "array-shaped deathsByCause must render");
});

// ── #221/F3: alerts renders real fields, no [object Object] ──

test("formatAlertsEmbed: renders firing alerts without [object Object]", () => {
  const embed = formatAlertsEmbed({ ok: true, alerts: { total: 2, firing: 1, pending: 1, summary: [
    { alertname: "HighCPU", severity: "critical", instance: "dune-server", summary: "CPU > 90%", startsAt: "2026-08-20T00:00:00Z" }
  ] } });
  const text = JSON.stringify(embed.data);
  assert.doesNotMatch(text, /\[object Object\]/);
  assert.match(text, /HighCPU/);
});

// ── #221/F4: version field names carry no literal markdown ──

test("formatVersionEmbed: field names are not wrapped in literal **markdown**", () => {
  const embed = formatVersionEmbed({ version: "1.3.87", adapter: { enabled: true, service: "discord" } });
  for (const name of fieldNames(embed)) {
    assert.ok(!name.includes("**"), `field name "${name}" must not contain literal markdown`);
  }
});

// ── #221/F5: no "observer" leaks in user-facing roles copy ──

test("admin:roles help/registry copy says 'player', never 'observer'", () => {
  const registryEntry = { name: "admin:roles", desc: "Show configured admin/player roles with current names.", role: "admin" };
  assert.doesNotMatch(registryEntry.desc, /observer/i);
});

// ── #221/F6: /dune server summary never shows truthy "unknown" ──

test("statusSummaryPayload: missing values are null, not the string 'unknown'", () => {
  const payload = statusSummaryPayload({ ok: true, result: {} });
  assert.equal(payload.region, null);
  assert.equal(payload.mode, null);
  assert.equal(payload.population, null);
});

// ── #221/F7: log fence-breaking is neutralized ──

test("formatLogsEmbed: a log line containing a triple-backtick cannot close the fence early", () => {
  const embed = formatLogsEmbed({ logs: ["before", "```danger``` **bold-injection**", "after"] }, "svc");
  // exactly one opening and one closing fence in the whole description
  const fenceCount = (embed.data.description.match(/```/g) || []).length;
  assert.equal(fenceCount, 2, "the log content must not introduce extra fence boundaries");
});

// ── brand rename pin (Arrakis Control Panel/ACP -> Sentinel -> Dune:
// Awakening Docker — Mentat -> Sahir Venn, Mentat of Dune: Awakening
// Docker). Regression guard so neither old name can ever silently
// creep back into a footer or embed. ──

test("brand: duneEmbed footer and enricher footer both say Sahir Venn/Mentat, never an old name", async () => {
  const { enrichEmbed } = await import("../src/output/enricher.js");
  const { EmbedBuilder } = await import("discord.js");

  const embed = duneEmbed({ title: "x", description: "y" });
  assert.match(embed.data.footer.text, /Sahir Venn/);
  assert.match(embed.data.footer.text, /Mentat/);
  assert.doesNotMatch(embed.data.footer.text, /Arrakis Control Panel/);
  assert.doesNotMatch(embed.data.footer.text, /\bSentinel\b/);

  const bare = enrichEmbed(new EmbedBuilder().setTitle("x"));
  assert.match(bare.data.footer.text, /Sahir Venn/);
  assert.match(bare.data.footer.text, /Mentat/);
  assert.doesNotMatch(bare.data.footer.text, /Arrakis Control Panel/);
  assert.doesNotMatch(bare.data.footer.text, /\bSentinel\b/);
});

test("formatSyncCommandsEmbed: capped lists say 'showing first N'", () => {
  const embed = formatSyncCommandsEmbed({
    ok: true,
    registry: { version: 2, groups: 7, commandCount: 29 },
    coreCatalog: { version: 2, groups: 8, commandCount: 60 },
    drift: { inSync: false, added: ["a:b", "c:d"], addedCount: 40, removed: [], removedCount: 0 }
  });
  assert.ok(fieldNames(embed).some((n) => n.includes("(40) — showing first 2")), "cap must be labeled");
});

export default undefined;
