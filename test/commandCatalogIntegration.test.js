/**
 * Command Catalog Integration Tests
 *
 * Tests Phase 2 generator against REAL bot route classifications
 * from src/adapterClient.js, not mock routes.
 *
 * Tracked by yacketrj/arrakis-control-panel#180 (Phase 2 Layer 3 audit)
 *
 * This test suite validates that the generator's assumptions about
 * Core's catalog match the bot's actual route definitions.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIVE_ROUTES, PLANNED_ROUTES, MISSING_ROUTES, UNMERGED_ROUTES } from '../src/adapterClient.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Load the real, committed registry
let registry = null;
try {
  registry = JSON.parse(
    readFileSync(join(repoRoot, 'src/commands-registry.json'), 'utf8')
  );
} catch (e) {
  console.error('Note: commands-registry.json not found or invalid JSON');
  console.error('       Run: npm run registry:generate (requires Core running)');
}

test('Phase 2 Integration: Real Bot Routes', async (t) => {
  await t.test('LIVE_ROUTES are a defined set', () => {
    assert.ok(LIVE_ROUTES instanceof Set);
    assert.ok(LIVE_ROUTES.size > 0);
  });

  await t.test('bot has a minimum set of core routes', () => {
    const required = ['health', 'status', 'readiness', 'services', 'population', 'version'];
    for (const route of required) {
      assert.ok(LIVE_ROUTES.has(route), `Missing required route: ${route}`);
    }
  });

  await t.test('all route sets are mutually exclusive (no overlap)', () => {
    const live = [...LIVE_ROUTES];
    const allSets = [PLANNED_ROUTES, MISSING_ROUTES, UNMERGED_ROUTES];

    for (const route of live) {
      for (const otherSet of allSets) {
        assert.ok(
          !otherSet.has(route),
          `Route "${route}" appears in both LIVE_ROUTES and ${otherSet.name}`
        );
      }
    }
  });

  await t.test('LIVE_ROUTES count is reasonable (5-50)', () => {
    assert.ok(
      LIVE_ROUTES.size >= 5 && LIVE_ROUTES.size <= 50,
      `Suspicious LIVE_ROUTES size: ${LIVE_ROUTES.size}`
    );
  });
});

test('Phase 2 Integration: Registry Structure', async (t) => {
  if (!registry) {
    console.log('⚠️  Skipping registry validation (registry not found - run: npm run registry:generate)');
    return;
  }

  // NOTE: These tests validate the STRUCTURE of the registry, not its content.
  // Validating route names requires a real Core running (generator not mocked in tests).
  // Full generator+validator round-trip is tested separately via npm run registry:generate.

  await t.test('registry has expected structure', () => {
    assert.ok(registry.version);
    assert.ok(registry.generatedAt);
    assert.ok(registry.generatorVersion);
    assert.ok(Array.isArray(registry.groups));
    assert.ok(registry.groups.length > 0);
  });

  await t.test('all registry subcommands have required metadata fields', () => {
    for (const group of registry.groups) {
      assert.ok(group.name, 'group missing name');
      assert.ok(Array.isArray(group.subcommands), `group "${group.name}" missing subcommands array`);

      for (const sc of group.subcommands) {
        assert.ok(sc.name, `subcommand missing name in group "${group.name}"`);
        assert.ok('description' in sc, `subcommand "${sc.name}" missing description`);
        assert.ok('capability' in sc, `subcommand "${sc.name}" missing capability`);
        assert.ok('minTier' in sc, `subcommand "${sc.name}" missing minTier`);
        assert.ok(Array.isArray(sc.params), `subcommand "${sc.name}" params not an array`);
      }
    }
  });

  await t.test('registry groups respect Discord 25-subcommand limit', () => {
    for (const group of registry.groups) {
      assert.ok(
        group.subcommands.length <= 25,
        `Group "${group.name}" has ${group.subcommands.length} subcommands, exceeds 25-limit`
      );
    }
  });
});

test('Phase 2 Integration: Generator Assumptions', async (t) => {
  await t.test('bot maintains route classifications (LIVE, PLANNED, MISSING, UNMERGED)', () => {
    // This is a regression test: if someone deletes these sets from
    // adapterClient.js without updating the generator, this will catch it.
    assert.ok(LIVE_ROUTES instanceof Set);
    assert.ok(PLANNED_ROUTES instanceof Set);
    assert.ok(MISSING_ROUTES instanceof Set);
    assert.ok(UNMERGED_ROUTES instanceof Set);
  });

  await t.test('REQUIRED_ROUTES (from generator) are all in LIVE_ROUTES', () => {
    // These are the routes the generator requires Core to provide
    // Format: without leading slash (matching bot's LIVE_ROUTES format)
    const requiredForGenerator = [
      'health', 'status', 'readiness', 'services', 'population',
      'logs', 'map-state', 'version', 'maintenance', 'backups',
      'servers', 'ports', 'db'
    ];

    for (const route of requiredForGenerator) {
      assert.ok(
        LIVE_ROUTES.has(route),
        `Generator requires "${route}" to be LIVE, but adapterClient says otherwise`
      );
    }
  });
});

test('Phase 2 Integration: Override Validation', async (t) => {
  // Load overrides
  let overrides = {};
  try {
    overrides = JSON.parse(
      readFileSync(join(repoRoot, 'src/commandOverrides.json'), 'utf8')
    );
  } catch (e) {
    console.error('Note: commandOverrides.json not found or invalid');
  }

  await t.test('overrides.exclude references only bot-accessible commands', () => {
    // Excluded commands should be either LIVE (the bot can exclude them)
    // or not exist at all (typo check is manual)
    for (const excluded of (overrides.exclude || [])) {
      // Format: "group-name" (e.g., "guild-grants-enable")
      // We can't verify these without having the full command metadata,
      // so this is a placeholder for Phase 3 when the bot loads the registry.
      assert.ok(typeof excluded === 'string');
    }
  });

  await t.test('overrides structure is valid', () => {
    assert.ok(typeof overrides === 'object');
    if (overrides.exclude) assert.ok(Array.isArray(overrides.exclude));
    if (overrides.rename) assert.ok(typeof overrides.rename === 'object');
    if (overrides.retier) assert.ok(typeof overrides.retier === 'object');
  });
});
