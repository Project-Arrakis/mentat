/**
 * catalogTransform.test.js
 *
 * Tests for the shared Core-catalog-to-registry transform, used by both
 * scripts/generate-command-registry.js (Phase 2) and
 * registryLoader.js's fetchCoreCatalogForGuild() (Phase 3).
 *
 * Uses a REAL, captured production catalog response
 * (test/fixtures/catalog/real-core-v2-catalog.json, captured 2026-08-19
 * from console.darkdante.org's live /api/integrations/discord/catalog)
 * as the primary fixture -- not a hand-authored mock -- because every
 * previous mock catalog in this codebase (test/commandCatalogGeneration.test.js's
 * mockCatalog) assumed a flat v1 shape that real Core has never actually
 * returned, and that mismatch is exactly what let the envelope-unwrap
 * and routes[]-flattening bugs ship undetected. See
 * src/catalogTransform.js's own module comment for the full writeup.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  unwrapCatalogEnvelope,
  flattenSubcommand,
  transformCatalogToRegistry,
  applyCommandOverrides
} from "../src/catalogTransform.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const realCatalogResponse = JSON.parse(
  readFileSync(join(__dirname, "fixtures/catalog/real-core-v2-catalog.json"), "utf8")
);

// ── unwrapCatalogEnvelope() ──

test("unwrapCatalogEnvelope: unwraps the real { ok, protocolVersion, catalog } envelope", () => {
  const catalog = unwrapCatalogEnvelope(realCatalogResponse);
  assert.equal(typeof catalog.version, "number");
  assert.ok(Array.isArray(catalog.groups));
  // Must NOT still have the envelope fields at this level
  assert.equal(catalog.ok, undefined);
  assert.equal(catalog.protocolVersion, undefined);
});

test("unwrapCatalogEnvelope: passes through an already-bare catalog unchanged", () => {
  const bare = { version: 1, groups: [] };
  assert.deepEqual(unwrapCatalogEnvelope(bare), bare);
});

test("unwrapCatalogEnvelope: handles null/undefined gracefully", () => {
  assert.equal(unwrapCatalogEnvelope(null), null);
  assert.equal(unwrapCatalogEnvelope(undefined), undefined);
});

// ── flattenSubcommand() ──

test("flattenSubcommand: passes through v1 flat subcommands unchanged", () => {
  const v1 = { name: "health", description: "ok", route: "/health", capability: "x", minTier: "observer", params: [] };
  assert.deepEqual(flattenSubcommand(v1), v1);
});

test("flattenSubcommand: flattens a real single-route v2 subcommand", () => {
  const catalog = unwrapCatalogEnvelope(realCatalogResponse);
  const server = catalog.groups.find((g) => g.name === "server");
  const health = server.subcommands.find((s) => s.name === "health");

  const flat = flattenSubcommand(health);
  assert.equal(flat.name, "health");
  assert.equal(flat.description, "Check the console Discord adapter.");
  assert.equal(flat.route, "/api/integrations/discord/health");
  assert.equal(flat.method, "GET");
  assert.ok(Array.isArray(flat.params));
  assert.ok(Array.isArray(flat.routes), "original routes[] must be preserved for downstream consumers");
});

test("flattenSubcommand: flattens a real multi-route v2 subcommand (player:inventory)", () => {
  const catalog = unwrapCatalogEnvelope(realCatalogResponse);
  const player = catalog.groups.find((g) => g.name === "player");
  const inventory = player.subcommands.find((s) => s.name === "inventory");

  assert.equal(inventory.routes.length, 2, "fixture must actually exercise multi-route fanning");

  const flat = flattenSubcommand(inventory);
  assert.equal(flat.name, "inventory");
  // Primary route's description, not the -search variant's
  assert.equal(flat.description, "View your personal inventory.");
  assert.equal(flat.route, "/api/integrations/discord/players/inventory");
  // Union of params across BOTH routes -- the primary route has none,
  // the -search route has `search` -- must still surface `search`.
  assert.equal(flat.params.length, 1);
  assert.equal(flat.params[0].name, "search");
  // Full route detail preserved for any consumer needing per-route
  // dispatch (commands.js's existing hand-written selector logic).
  assert.equal(flat.routes.length, 2);
});

test("flattenSubcommand: sets requiresWritesEnabled=true if ANY route requires it", () => {
  const sc = {
    name: "mixed",
    routes: [
      { description: "a", route: "/a", capability: "x", minTier: "observer", method: "POST", requiresWritesEnabled: false, params: [] },
      { description: "b", route: "/b", capability: "x", minTier: "observer", method: "POST", requiresWritesEnabled: true, params: [] }
    ]
  };
  assert.equal(flattenSubcommand(sc).requiresWritesEnabled, true);
});

test("flattenSubcommand: returns malformed input as-is (no routes, no route) for validateRegistry() to reject", () => {
  const broken = { name: "broken" };
  assert.deepEqual(flattenSubcommand(broken), broken);
});

// ── transformCatalogToRegistry() ──

test("transformCatalogToRegistry: full pipeline against the real captured production catalog", () => {
  const registry = transformCatalogToRegistry(realCatalogResponse);

  assert.equal(registry.version, 2);
  assert.ok(Array.isArray(registry.groups));
  assert.equal(registry.groups.length, 7);

  const totalSubcommands = registry.groups.reduce((sum, g) => sum + g.subcommands.length, 0);
  assert.equal(totalSubcommands, 29);

  // Every subcommand must have been flattened -- no nested routes[]
  // sitting where `description`/`route` should be.
  for (const group of registry.groups) {
    for (const sc of group.subcommands) {
      assert.equal(typeof sc.name, "string");
      assert.equal(typeof sc.description, "string", `${group.name}:${sc.name} missing flattened description`);
      assert.equal(typeof sc.route, "string", `${group.name}:${sc.name} missing flattened route`);
    }
  }
});

test("transformCatalogToRegistry: throws on missing groups array", () => {
  assert.throws(() => transformCatalogToRegistry({ version: 1 }), /groups array/);
});

test("transformCatalogToRegistry: throws on non-object input", () => {
  assert.throws(() => transformCatalogToRegistry(null), /not an object/);
  assert.throws(() => transformCatalogToRegistry("garbage"), /not an object/);
});

test("transformCatalogToRegistry: is a no-op-ish pass-through for a bare v1 catalog (no envelope, flat subcommands)", () => {
  const v1 = {
    version: 1,
    groups: [{
      name: "core",
      subcommands: [{ name: "about", description: "ok", route: "/version", capability: null, minTier: "observer", params: [] }]
    }]
  };
  const result = transformCatalogToRegistry(v1);
  assert.equal(result.version, 1);
  assert.equal(result.groups[0].subcommands[0].route, "/version");
});

// ── applyCommandOverrides() ──

test("applyCommandOverrides: excludes a subcommand by group-name key", () => {
  const registry = transformCatalogToRegistry(realCatalogResponse);
  const result = applyCommandOverrides(registry, { exclude: ["player-link"] });

  const player = result.groups.find((g) => g.name === "player");
  assert.equal(player.subcommands.find((s) => s.name === "link"), undefined);
});

test("applyCommandOverrides: renames a subcommand (real override: ops-inventory -> armory)", () => {
  const registry = transformCatalogToRegistry(realCatalogResponse);
  const overrides = JSON.parse(readFileSync(join(__dirname, "..", "src", "commandOverrides.json"), "utf8"));
  const result = applyCommandOverrides(registry, overrides);

  const ops = result.groups.find((g) => g.name === "ops");
  assert.ok(ops.subcommands.some((s) => s.name === "armory"), "ops-inventory must be renamed to armory");
  assert.equal(ops.subcommands.find((s) => s.name === "inventory"), undefined, "original name must not remain");
});

test("applyCommandOverrides: retiers a subcommand", () => {
  const registry = transformCatalogToRegistry(realCatalogResponse);
  const result = applyCommandOverrides(registry, { retier: { "player-link": "admin" } });

  const player = result.groups.find((g) => g.name === "player");
  const link = player.subcommands.find((s) => s.name === "link");
  assert.equal(link.minTier, "admin");
});

test("applyCommandOverrides: removes groups that become empty after exclusion", () => {
  const registry = { version: 1, groups: [{ name: "logs", subcommands: [{ name: "service", description: "x", route: "/x", params: [] }] }] };
  const result = applyCommandOverrides(registry, { exclude: ["logs-service"] });
  assert.equal(result.groups.find((g) => g.name === "logs"), undefined);
});

test("applyCommandOverrides: throws if a group exceeds Discord's 25-subcommand limit", () => {
  const registry = {
    version: 1,
    groups: [{
      name: "huge",
      subcommands: Array.from({ length: 26 }, (_, i) => ({ name: `cmd${i}`, description: "x", route: `/${i}`, params: [] }))
    }]
  };
  assert.throws(() => applyCommandOverrides(registry, {}), /25.*limit|exceed/i);
});

test("applyCommandOverrides: handles null/undefined overrides gracefully", () => {
  const registry = transformCatalogToRegistry(realCatalogResponse);
  assert.doesNotThrow(() => applyCommandOverrides(registry, null));
  assert.doesNotThrow(() => applyCommandOverrides(registry, undefined));
  assert.doesNotThrow(() => applyCommandOverrides(registry));
});

// ── End-to-end: real catalog -> transform -> overrides -> validateRegistry() ──

test("end-to-end: real catalog through the full pipeline passes registryLoader's validateRegistry()", async () => {
  const { validateRegistry } = await import("../src/registryLoader.js");
  const overrides = JSON.parse(readFileSync(join(__dirname, "..", "src", "commandOverrides.json"), "utf8"));

  const transformed = transformCatalogToRegistry(realCatalogResponse);
  const registry = applyCommandOverrides(transformed, overrides);

  assert.doesNotThrow(() => validateRegistry(registry));
});

export default undefined;
