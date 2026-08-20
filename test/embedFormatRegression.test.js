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
  formatSyncCommandsEmbed
} from "../src/embedFormat.js";
import { executeDuneCommand, helpPayload } from "../src/commands.js";
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
