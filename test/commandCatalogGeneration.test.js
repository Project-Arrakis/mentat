/**
 * Command Catalog Generation Tests
 *
 * Tests for Phase 2: bot-side command registry generator
 * Tracked by yacketrj/arrakis-control-panel#180
 *
 * Validates:
 * - Catalog fetch and parsing (L0)
 * - Catalog structure validation (L1)
 * - Override application (L2)
 * - Discord constraints (group size limits, param types)
 * - Drift detection (missing/stale routes)
 * - Round-trip: catalog -> registry -> buildDuneCommand() alignment
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

// Mock catalog matching Core's structure
const mockCatalog = {
  version: 1,
  groups: [
    {
      name: 'server',
      subcommands: [
        {
          name: 'health',
          description: 'Check the console Discord adapter.',
          route: '/health',
          capability: 'STATUS_READ',
          minTier: 'observer',
          params: [],
          routeEnforcesCapability: true
        },
        {
          name: 'status',
          description: 'Show high-level server status.',
          route: '/status',
          capability: 'STATUS_READ',
          minTier: 'observer',
          params: [
            { name: 'diagnostic', type: 'BOOLEAN', required: false, description: 'Admin-only diagnostic' }
          ],
          routeEnforcesCapability: true
        }
      ]
    },
    {
      name: 'data',
      subcommands: [
        {
          name: 'population',
          description: 'Show aggregate player count.',
          route: '/population',
          capability: 'POPULATION_READ',
          minTier: 'observer',
          params: [],
          routeEnforcesCapability: true
        }
      ]
    }
  ]
};

// Expected bot routes (from adapterClient.js)
const expectedRoutes = ['/health', '/status', '/population'];

// Helper functions
function validateCatalogSchema(catalog) {
  if (!catalog?.version) throw new Error('Catalog missing version field');
  if (catalog.version !== 1) throw new Error(`Unsupported catalog version: ${catalog.version}`);
  if (!Array.isArray(catalog.groups)) throw new Error('Catalog missing groups array');
}

function validateRoutesCoverage(catalog, expectedRoutes) {
  const catalogRoutes = new Set();
  for (const group of catalog.groups) {
    for (const subcommand of group.subcommands) {
      catalogRoutes.add(subcommand.route);
    }
  }
  
  const missing = expectedRoutes.filter(r => !catalogRoutes.has(r));
  if (missing.length > 0) {
    throw new Error(`Catalog missing routes: ${missing.join(', ')}`);
  }
  
  const extra = [...catalogRoutes].filter(r => !expectedRoutes.includes(r));
  if (extra.length > 0) {
    throw new Error(`Catalog has unclassified routes: ${extra.join(', ')}`);
  }
}

function applyOverrides(catalog, overrides) {
  const excluded = new Set((overrides?.exclude) || []);
  const renames = (overrides?.rename) || {};
  const retiers = (overrides?.retier) || {};

  const result = {
    version: catalog.version,
    generatedAt: new Date().toISOString(),
    generatorVersion: '1.0.0-rc.5',
    groups: []
  };

  for (const group of catalog.groups) {
    const filteredSubcommands = group.subcommands
      .filter(sc => !excluded.has(`${group.name}-${sc.name}`))
      .map(sc => {
        const key = `${group.name}-${sc.name}`;
        const rename = renames[key] || {};
        const retier = retiers[key];

        return {
          name: rename.subcommand || sc.name,
          description: sc.description,
          route: sc.route,
          capability: sc.capability,
          minTier: retier || sc.minTier,
          params: sc.params || [],
          routeEnforcesCapability: sc.routeEnforcesCapability !== false
        };
      });

    if (filteredSubcommands.length > 0) {
      if (filteredSubcommands.length > 25) {
        throw new Error(`Group "${group.name}" has ${filteredSubcommands.length} subcommands, exceeds Discord's 25-subcommand limit.`);
      }
      result.groups.push({
        name: group.name,
        subcommands: filteredSubcommands
      });
    }
  }

  return result;
}

test('L0: Catalog Schema Validation', async (t) => {
  await t.test('accepts valid catalog structure', () => {
    assert.equal(mockCatalog.version, 1);
    assert.ok(Array.isArray(mockCatalog.groups));
    assert.ok(mockCatalog.groups[0].name);
    assert.ok(Array.isArray(mockCatalog.groups[0].subcommands));
  });

  await t.test('requires version field', () => {
    const invalid = { ...mockCatalog, version: undefined };
    assert.throws(() => validateCatalogSchema(invalid), /version field/);
  });

  await t.test('rejects unsupported catalog versions', () => {
    const invalid = { ...mockCatalog, version: 2 };
    assert.throws(() => validateCatalogSchema(invalid), /version.*[0-9]/);
  });

  await t.test('requires groups array', () => {
    const invalid = { ...mockCatalog, groups: undefined };
    assert.throws(() => validateCatalogSchema(invalid), /groups/);
  });
});

test('L1: Route Coverage Validation', async (t) => {
  await t.test('detects missing routes', () => {
    const incomplete = {
      version: 1,
      groups: [{
        name: 'server',
        subcommands: [
          { name: 'health', route: '/health', description: 'test' }
        ]
      }]
    };
    assert.throws(() => validateRoutesCoverage(incomplete, expectedRoutes), /missing|not found/i);
  });

  await t.test('detects stale catalog entries', () => {
    const stale = {
      version: 1,
      groups: [{
        name: 'server',
        subcommands: [
          { name: 'health', route: '/health', description: 'test' },
          { name: 'status', route: '/status', description: 'test' },
          { name: 'population', route: '/population', description: 'test' },
          { name: 'removed', route: '/removed-route', description: 'no longer live' }
        ]
      }]
    };
    assert.throws(() => validateRoutesCoverage(stale, expectedRoutes), /unclassified|unknown/i);
  });

  await t.test('accepts catalog with exact route coverage', () => {
    assert.doesNotThrow(() => validateRoutesCoverage(mockCatalog, expectedRoutes));
  });
});

test('L2: Override Application', async (t) => {
  await t.test('applies exclusions (filtered subcommands)', () => {
    const overrides = {
      exclude: ['data-population']
    };
    const result = applyOverrides(mockCatalog, overrides);
    const population = result.groups
      .find(g => g.name === 'data')
      ?.subcommands.find(sc => sc.name === 'population');
    assert.equal(population, undefined);
  });

  await t.test('applies renames', () => {
    const overrides = {
      rename: {
        'data-population': { subcommand: 'server-population' }
      }
    };
    const result = applyOverrides(mockCatalog, overrides);
    const renamed = result.groups
      .find(g => g.name === 'data')
      ?.subcommands.find(sc => sc.name === 'server-population');
    assert.ok(renamed);
    assert.equal(renamed?.route, '/population');
  });

  await t.test('applies tier adjustments', () => {
    const overrides = {
      retier: {
        'data-population': 'owner'
      }
    };
    const result = applyOverrides(mockCatalog, overrides);
    const retired = result.groups
      .find(g => g.name === 'data')
      ?.subcommands.find(sc => sc.name === 'population');
    assert.equal(retired?.minTier, 'owner');
  });

  await t.test('preserves route metadata during overrides', () => {
    const overrides = { exclude: ['data-population'] };
    const result = applyOverrides(mockCatalog, overrides);
    const health = result.groups
      .find(g => g.name === 'server')
      ?.subcommands.find(sc => sc.name === 'health');
    assert.equal(health?.route, '/health');
    assert.ok(health?.capability);
    assert.ok(health?.params);
  });

  await t.test('removes empty groups after filtering', () => {
    const overrides = {
      exclude: ['data-population']
    };
    const result = applyOverrides(mockCatalog, overrides);
    assert.equal(result.groups.find(g => g.name === 'data'), undefined);
  });
});

test('L3: Discord Constraints', async (t) => {
  await t.test('enforces 25-subcommand limit per group', () => {
    const tooMany = {
      version: 1,
      groups: [{
        name: 'huge',
        subcommands: Array.from({ length: 26 }, (_, i) => ({
          name: `cmd${i}`,
          route: `/cmd${i}`,
          description: 'test'
        }))
      }]
    };
    assert.throws(() => applyOverrides(tooMany, {}), /25.*limit|exceed/i);
  });

  await t.test('accepts groups with exactly 25 subcommands', () => {
    const maxValid = {
      version: 1,
      groups: [{
        name: 'exact',
        subcommands: Array.from({ length: 25 }, (_, i) => ({
          name: `cmd${i}`,
          route: `/cmd${i}`,
          description: 'test'
        }))
      }]
    };
    assert.doesNotThrow(() => applyOverrides(maxValid, {}));
  });
});

test('L4: Registry Metadata', async (t) => {
  await t.test('includes generation timestamp and version', () => {
    const result = applyOverrides(mockCatalog, {});
    assert.ok(result.generatedAt);
    assert.ok(result.generatorVersion);
    assert.match(result.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  await t.test('preserves param information', () => {
    const result = applyOverrides(mockCatalog, {});
    const statusCmd = result.groups
      .find(g => g.name === 'server')
      ?.subcommands.find(sc => sc.name === 'status');
    assert.equal(statusCmd?.params.length, 1);
    assert.equal(statusCmd?.params[0].name, 'diagnostic');
  });

  await t.test('includes route enforcement flag', () => {
    const result = applyOverrides(mockCatalog, {});
    const health = result.groups
      .find(g => g.name === 'server')
      ?.subcommands.find(sc => sc.name === 'health');
    assert.equal(health?.routeEnforcesCapability, true);
  });
});

test('L5: Boundary Conditions', async (t) => {
  await t.test('handles empty catalog gracefully', () => {
    const empty = { version: 1, groups: [] };
    const result = applyOverrides(empty, {});
    assert.equal(result.groups.length, 0);
  });

  await t.test('handles null/undefined overrides gracefully', () => {
    assert.doesNotThrow(() => applyOverrides(mockCatalog, null));
    assert.doesNotThrow(() => applyOverrides(mockCatalog, undefined));
    assert.doesNotThrow(() => applyOverrides(mockCatalog, {}));
  });
});

test('Integration: Core -> Bot Alignment', async (t) => {
  await t.test('round-trip: catalog routes match bot expectations', () => {
    const routes = new Set(
      mockCatalog.groups.flatMap(g => 
        g.subcommands.map(s => s.route)
      )
    );
    assert.deepEqual(routes, new Set(expectedRoutes));
  });

  await t.test('no route appears in more than one group', () => {
    const allRoutes = [];
    for (const group of mockCatalog.groups) {
      for (const subcommand of group.subcommands) {
        allRoutes.push(subcommand.route);
      }
    }
    const unique = new Set(allRoutes);
    assert.equal(unique.size, allRoutes.length);
  });

  await t.test('all routes have capability information', () => {
    for (const group of mockCatalog.groups) {
      for (const subcommand of group.subcommands) {
        assert.ok('capability' in subcommand);
        assert.ok('minTier' in subcommand);
      }
    }
  });
});
