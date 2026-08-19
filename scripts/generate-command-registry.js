#!/usr/bin/env node

/**
 * Phase 2 of Command Discovery: Bot-side registry generator
 *
 * SCOPE: Generates src/commands-registry.json artifact from Core's catalog endpoint.
 *        This is generation-only. Phase 3 (runtime loading) is a separate PR.
 *
 * Fetches Core's command catalog endpoint and generates the bot's
 * commands-registry.json artifact, applying bot-side overrides and
 * validating against Core's route availability.
 *
 * Tracked by yacketrj/arrakis-control-panel#180 (Phase 2 generator)
 * Relates to yacketrj/dune-awakening-selfhost-docker#337 (Phase 1 endpoint)
 *
 * Phase 3 (not in scope): Runtime loading from commands-registry.json
 *   - buildDuneCommand() to use registry instead of hardcoded definitions
 *   - helpPayload() and getCommandRegistry() to use in-memory registry
 *   - /dune admin sync-commands operator command
 *
 * Usage:
 *   node scripts/generate-command-registry.js
 *
 * Exit codes:
 *   0: success, registry generated/updated
 *   1: validation error (missing routes, incompatible catalog, etc.)
 *   2: network/fetch error (Core unreachable)
 *
 * Output:
 *   src/commands-registry.json — committed artifact
 *   stdout — diagnostic messages
 *   stderr — errors
 */

import https from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Load configuration
const pkgJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const envFile = readFileSync(join(repoRoot, '.env'), 'utf8');
const envLines = envFile.split('\n').filter(line => line.trim() && !line.startsWith('#'));
const env = Object.fromEntries(envLines.map(line => {
  const [key, ...rest] = line.split('=');
  return [key.trim(), rest.join('=').trim().replace(/^["']|["']$/g, '')];
}));

const DUNE_CONSOLE_API_URL = env.DUNE_CONSOLE_API_URL || 'https://127.0.0.1:8089';
const DUNE_DISCORD_TOKEN = env.DUNE_DISCORD_TOKEN || '';

// Load bot-side overrides
let overrides = {};
try {
  overrides = JSON.parse(readFileSync(join(repoRoot, 'src/commandOverrides.json'), 'utf8'));
} catch (e) {
  console.error('Error loading src/commandOverrides.json:', e.message);
  process.exit(1);
}

// Minimum required routes that Core MUST provide for bot to function.
// Additional routes beyond these are acceptable (and will be included in registry).
// Missing routes from this list will cause the generator to fail.
// Routes are formatted WITH leading slash (as they appear in Core's catalog).
const REQUIRED_ROUTES = [
  '/health',
  '/status',
  '/readiness',
  '/services',
  '/population',
  '/logs',
  '/map-state',
  '/version',
  '/maintenance',
  '/backups',
  '/servers',
  '/ports',
  '/db'
];

/**
 * Fetch Core's command catalog
 */
async function fetchCatalog() {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/integrations/discord/catalog', DUNE_CONSOLE_API_URL);
    
    // Only disable TLS verification for localhost/127.0.0.1 (dev only)
    // Production must use valid HTTPS certificates
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    
    const options = {
      headers: {
        'Authorization': `Bearer ${DUNE_DISCORD_TOKEN}`,
        'User-Agent': `arrakis-control-panel/${pkgJson.version}`
      },
      rejectUnauthorized: isLocalhost ? false : true // TLS only disabled for localhost
    };

    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse catalog JSON: ${e.message}`));
          }
        } else if (res.statusCode === 401) {
          reject(new Error('Unauthorized: invalid or missing DUNE_DISCORD_TOKEN'));
        } else {
          reject(new Error(`Catalog fetch failed: HTTP ${res.statusCode}`));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Validate catalog structure and Core/bot alignment
 */
function validateCatalog(catalog) {
  if (!catalog.version) {
    throw new Error('Catalog missing version field');
  }
  if (catalog.version !== 1) {
    throw new Error(`Unsupported catalog version: ${catalog.version}`);
  }
  if (!Array.isArray(catalog.groups)) {
    throw new Error('Catalog missing groups array');
  }

  // Collect all routes from catalog
  const catalogRoutes = new Set();
  for (const group of catalog.groups) {
    if (!Array.isArray(group.subcommands)) {
      throw new Error(`Group "${group.name}" missing subcommands array`);
    }
    for (const subcommand of group.subcommands) {
      if (!subcommand.route) {
        throw new Error(`Subcommand "${group.name}/${subcommand.name}" missing route`);
      }
      catalogRoutes.add(subcommand.route);
    }
  }

  // Check for minimum required routes (bot won't function without these)
  const missingRequired = REQUIRED_ROUTES.filter(r => !catalogRoutes.has(r));
  if (missingRequired.length > 0) {
    throw new Error(
      `Catalog missing required routes: ${missingRequired.join(', ')}\n` +
      `Core's catalog must include these minimum routes for bot to function. ` +
      `Check that Core is running and catalog endpoint is accessible.`
    );
  }

  return { catalogRoutes, catalog };
}

/**
 * Apply bot-side overrides: exclusions, renames, tier adjustments
 */
function applyOverrides(catalog, overrides) {
  const excluded = new Set(overrides.exclude || []);
  const renames = overrides.rename || {};
  const retiers = overrides.retier || {};

  const result = {
    version: catalog.version,
    generatedAt: new Date().toISOString(),
    generatorVersion: pkgJson.version,
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

    // Only include groups that have subcommands after filtering
    if (filteredSubcommands.length > 0) {
      result.groups.push({
        name: group.name,
        subcommands: filteredSubcommands
      });
    }
  }

  // Validate Discord constraints
  for (const group of result.groups) {
    if (group.subcommands.length > 25) {
      throw new Error(
        `Group "${group.name}" has ${group.subcommands.length} subcommands, ` +
        `exceeds Discord's 25-subcommand limit. Use overrides.exclude to reduce.`
      );
    }
  }

  return result;
}

/**
 * Main generator
 */
async function main() {
  console.log('📋 Phase 2 Command Registry Generator');
  console.log(`   Core URL: ${DUNE_CONSOLE_API_URL}`);
  console.log();

  try {
    console.log('[1/4] Fetching Core command catalog...');
    const catalogRaw = await fetchCatalog();
    console.log(`      ✓ Got catalog with ${catalogRaw.groups.length} groups`);

    console.log('[2/4] Validating catalog structure...');
    const { catalog } = validateCatalog(catalogRaw);
    console.log(`      ✓ Catalog valid (${[...new Set(catalog.groups.flatMap(g => g.subcommands.map(s => s.route)))].length} unique routes)`);

    console.log('[3/4] Applying bot-side overrides...');
    const registry = applyOverrides(catalog, overrides);
    const totalSubcommands = registry.groups.reduce((sum, g) => sum + g.subcommands.length, 0);
    console.log(`      ✓ Applied overrides: ${overrides.exclude?.length || 0} excluded, ${Object.keys(overrides.rename || {}).length} renamed`);
    console.log(`      ✓ Final registry: ${registry.groups.length} groups, ${totalSubcommands} subcommands`);

    console.log('[4/4] Writing src/commands-registry.json...');
    const outputPath = join(repoRoot, 'src/commands-registry.json');
    writeFileSync(outputPath, JSON.stringify(registry, null, 2) + '\n');
    console.log(`      ✓ Wrote ${outputPath}`);

    console.log();
    console.log('✅ SUCCESS: Command registry generated and ready for CI/commit');
    console.log();
    process.exit(0);
  } catch (error) {
    console.error();
    console.error(`❌ ERROR: ${error.message}`);
    console.error();

    if (error.message.includes('Unauthorized')) {
      console.error('💡 Hint: Check DUNE_DISCORD_TOKEN in .env');
    } else if (error.message.includes('ECONNREFUSED') || error.message.includes('unreachable')) {
      console.error('💡 Hint: Check DUNE_CONSOLE_API_URL and that Core is running');
      process.exit(2); // Network error
    } else if (error.message.includes('out of sync')) {
      console.error('💡 Hint: Core and bot route lists diverged. Check dune-awakening-selfhost-docker#337 for new routes.');
    }

    process.exit(1);
  }
}

main();
