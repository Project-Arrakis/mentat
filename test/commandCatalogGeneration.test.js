/**
 * Command Catalog Generation Tests
 *
 * Tests for Phase 2: bot-side command registry generator
 * Tracked by yacketrj/arrakis-control-panel#180
 *
 * CORRECTNESS FIX (2026-08-20): this file previously maintained its own
 * local re-implementations of validateCatalogSchema()/applyOverrides()
 * instead of importing and testing scripts/generate-command-registry.js's
 * REAL functions. Combined with a mockCatalog fixture that used a flat
 * v1 shape real Core has never actually returned (Core's real responses
 * are wrapped in an { ok, protocolVersion, catalog } envelope, and at
 * CATALOG_VERSION 2 nest per-route fields inside a `routes[]` array of
 * route OBJECTS), this meant 76 "passing" tests here never once
 * exercised the real generator against a realistic payload -- the
 * envelope-unwrap bug, the routes[]-flattening bug, AND the
 * REQUIRED_ROUTES short-path-vs-full-path mismatch all shipped
 * undetected as a direct result. Found only via a live E2E round-trip
 * against real, reachable Core.
 *
 * Now imports and tests the REAL generate-command-registry.js exports
 * (validateCatalog, applyOverrides, REQUIRED_ROUTES) against a REAL,
 * captured production catalog response
 * (test/fixtures/catalog/real-core-v2-catalog.json), in addition to
 * smaller synthetic catalogs for specific edge cases (missing routes,
 * Discord limits, etc.) where a minimal fixture is clearer than the
 * full real one.
 *
 * Validates:
 * - Catalog structure validation (L1) against REAL generator code
 * - Override application (L2) against REAL generator code
 * - Discord constraints (25-subcommand group limit)
 * - Route coverage / REQUIRED_ROUTES drift detection
 * - Round-trip: real catalog -> registry, validated end-to-end
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateCatalog, applyOverrides, REQUIRED_ROUTES } from '../scripts/generate-command-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// REAL production catalog response (envelope + CATALOG_VERSION 2 nested
// routes[]), captured 2026-08-19 from console.darkdante.org. Already
// unwrapped here (`.catalog`) since validateCatalog()/applyOverrides()
// both operate on the bare catalog -- envelope unwrapping is
// fetchCatalog()'s job (see generate-command-registry.js's own comment)
// and is covered separately by test/catalogTransform.test.js.
const realEnvelopeResponse = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/catalog/real-core-v2-catalog.json'), 'utf8')
);
const realCatalog = realEnvelopeResponse.catalog;

// Minimal v1-shaped catalog for synthetic edge-case tests where a small,
// hand-authored fixture is clearer than slicing the real one.
const minimalV1Catalog = {
  version: 1,
  groups: [
    {
      name: 'server',
      subcommands: [
        {
          name: 'health',
          description: 'Check the console Discord adapter.',
          route: '/api/integrations/discord/health',
          capability: 'STATUS_READ',
          minTier: 'observer',
          params: [],
          routeEnforcesCapability: true
        }
      ]
    }
  ]
};

// ── L1: Catalog Structure Validation (REAL validateCatalog()) ──

test('L1: validateCatalog() accepts the real production catalog', () => {
  const { catalogRoutes, catalog } = validateCatalog(realCatalog);
  assert.equal(catalog.version, 2);
  assert.ok(catalogRoutes.size > 0);
  // BUG REGRESSION GUARD: every entry must be a real path STRING, not a
  // stringified route object (the original bug: routes.forEach(r =>
  // catalogRoutes.add(r)) added whole route objects for v2 catalogs).
  for (const route of catalogRoutes) {
    assert.equal(typeof route, 'string', `route entry is not a string: ${JSON.stringify(route)}`);
    assert.ok(route.startsWith('/api/integrations/discord/'), `route "${route}" is not a full API path`);
  }
});

test('L1: validateCatalog() satisfies REQUIRED_ROUTES against the real catalog', () => {
  const { catalogRoutes } = validateCatalog(realCatalog);
  const missing = REQUIRED_ROUTES.filter((r) => !catalogRoutes.has(r));
  assert.deepEqual(missing, [], `REQUIRED_ROUTES not satisfied by real catalog: ${missing.join(', ')}`);
});

test('L1: REQUIRED_ROUTES are full API paths, not short-form', () => {
  // BUG REGRESSION GUARD: REQUIRED_ROUTES used to be ['/health', ...],
  // which could never match any real catalog's full-path routes
  // ('/api/integrations/discord/health'). Every entry must be a full path.
  for (const route of REQUIRED_ROUTES) {
    assert.ok(route.startsWith('/api/integrations/discord/'), `REQUIRED_ROUTES entry "${route}" is not a full API path`);
  }
});

test('L1: validateCatalog() rejects missing version field', () => {
  const invalid = { groups: [] };
  assert.throws(() => validateCatalog(invalid), /version field/);
});

test('L1: validateCatalog() rejects unsupported catalog versions', () => {
  const invalid = { ...minimalV1Catalog, version: 3 };
  assert.throws(() => validateCatalog(invalid), /Unsupported catalog version/);
});

test('L1: validateCatalog() rejects missing groups array', () => {
  const invalid = { version: 1 };
  assert.throws(() => validateCatalog(invalid), /groups array/);
});

test('L1: validateCatalog() detects missing required routes', () => {
  const incomplete = {
    version: 1,
    groups: [{ name: 'server', subcommands: [{ name: 'health', route: '/api/integrations/discord/health', description: 'test' }] }]
  };
  assert.throws(() => validateCatalog(incomplete), /missing required routes/i);
});

test('L1: validateCatalog() rejects a subcommand with no route/routes', () => {
  const broken = {
    version: 2,
    groups: [{ name: 'server', subcommands: [{ name: 'health' }] }]
  };
  assert.throws(() => validateCatalog(broken), /no route\/routes/);
});

test('L1: validateCatalog() extracts route STRINGS from v2 routes[] arrays, not objects', () => {
  // BUG REGRESSION GUARD, isolated: a v2 subcommand whose ONLY route
  // happens to be a required one -- must resolve as satisfied, not as
  // missing (which is what happened when whole objects were being
  // added to the Set instead of route.route).
  const v2 = {
    version: 2,
    groups: [{
      name: 'server',
      subcommands: [{
        name: 'health',
        routes: [{ description: 'x', route: '/api/integrations/discord/health', capability: 'x', minTier: 'observer', method: 'GET', params: [] }]
      }]
    }]
  };
  // Will still throw for the OTHER required routes being absent from
  // this minimal fixture -- what matters is the error is about missing
  // routes (meaning the one present route WAS correctly recognized),
  // not a crash or a false negative on health specifically.
  try {
    validateCatalog(v2);
    assert.fail('expected missing-routes error for other required routes');
  } catch (err) {
    assert.match(err.message, /missing required routes/i);
    assert.doesNotMatch(err.message, /\/api\/integrations\/discord\/health\b/, 'health route was present and must not be reported missing');
  }
});

// ── L2: Override Application (REAL applyOverrides()) ──

test('L2: applyOverrides() rename mechanism actually fires against real data (#206/K18)', () => {
  // The SHIPPED "ops-inventory -> armory" rename is a historical no-op:
  // current Core already ships the subcommand as `armory` natively, so
  // the `ops-inventory` key matches nothing. The previous version of
  // this test asserted the post-rename name existed — true with or
  // without the override applied, i.e. a tautology that could never
  // fail. Exercise the mechanism with an override keyed to a name the
  // real fixture actually contains.
  const registry = applyOverrides(realCatalog, { rename: { 'ops-armory': { subcommand: 'arsenal' } } });
  const ops = registry.groups.find((g) => g.name === 'ops');
  assert.ok(ops.subcommands.some((s) => s.name === 'arsenal'), 'ops-armory must be renamed to arsenal');
  assert.equal(ops.subcommands.find((s) => s.name === 'armory'), undefined, 'the pre-rename name must be gone');
});

test('L2: shipped commandOverrides.json applies cleanly to the real catalog (every entry currently a no-op)', () => {
  // Every shipped override keys a command current Core does not expose
  // (guild-character-grants-*, ops-inventory, server-restart,
  // carepackage-grant-all) — kept as documented intent for when Core
  // ships those routes. Applying them must be byte-identical to applying
  // no overrides at all; if this ever fails, an entry started matching
  // real data and deserves its own real assertion above.
  const overrides = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'commandOverrides.json'), 'utf8'));
  assert.deepEqual(applyOverrides(realCatalog, overrides).groups, applyOverrides(realCatalog, {}).groups);
});

test('L2: applyOverrides() flattens v2 routes[] into flat description/route/params (real data)', () => {
  const registry = applyOverrides(realCatalog, {});
  const player = registry.groups.find((g) => g.name === 'player');
  const inventory = player.subcommands.find((s) => s.name === 'armory' || s.name === 'inventory');

  assert.equal(typeof inventory.description, 'string');
  assert.equal(typeof inventory.route, 'string');
  assert.ok(Array.isArray(inventory.params));
});

test('L2: applyOverrides() stamps generatedAt and generatorVersion', () => {
  const result = applyOverrides(minimalV1Catalog, {});
  assert.ok(result.generatedAt);
  assert.ok(result.generatorVersion);
  assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('L2: applyOverrides() applies exclusions', () => {
  const result = applyOverrides(minimalV1Catalog, { exclude: ['server-health'] });
  const server = result.groups.find((g) => g.name === 'server');
  assert.equal(server, undefined, 'group must be dropped entirely once its only subcommand is excluded');
});

test('L2: applyOverrides() applies tier adjustments', () => {
  const result = applyOverrides(minimalV1Catalog, { retier: { 'server-health': 'owner' } });
  const server = result.groups.find((g) => g.name === 'server');
  assert.equal(server.subcommands.find((s) => s.name === 'health').minTier, 'owner');
});

test('L2: applyOverrides() enforces the 25-subcommand Discord limit', () => {
  const tooMany = {
    version: 1,
    groups: [{
      name: 'huge',
      subcommands: Array.from({ length: 26 }, (_, i) => ({
        name: `cmd${i}`, route: `/api/integrations/discord/cmd${i}`, description: 'test', params: []
      }))
    }]
  };
  assert.throws(() => applyOverrides(tooMany, {}), /25.*limit|exceed/i);
});

test('L2: applyOverrides() handles null/undefined overrides gracefully', () => {
  assert.doesNotThrow(() => applyOverrides(minimalV1Catalog, null));
  assert.doesNotThrow(() => applyOverrides(minimalV1Catalog, undefined));
  assert.doesNotThrow(() => applyOverrides(minimalV1Catalog, {}));
});

test('L2: applyOverrides() handles an empty catalog gracefully', () => {
  const empty = { version: 1, groups: [] };
  const result = applyOverrides(empty, {});
  assert.equal(result.groups.length, 0);
});

// ── Integration: real catalog -> registry, end-to-end ──

test('Integration: real catalog through validateCatalog() + applyOverrides() produces a registry with every subcommand flattened', () => {
  const { catalog } = validateCatalog(realCatalog);
  const overrides = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'commandOverrides.json'), 'utf8'));
  const registry = applyOverrides(catalog, overrides);

  assert.ok(registry.groups.length > 0);
  for (const group of registry.groups) {
    assert.ok(group.subcommands.length <= 25);
    for (const sc of group.subcommands) {
      assert.equal(typeof sc.name, 'string');
      assert.equal(typeof sc.description, 'string', `${group.name}:${sc.name} missing description after flattening`);
      assert.ok('capability' in sc);
      assert.ok('minTier' in sc);
      assert.ok(Array.isArray(sc.params));
    }
  }
});

export default undefined;
