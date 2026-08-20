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
 * CORRECTNESS FIX (2026-08-20): this generator (and every test covering
 * it) had never actually been run against real Core data before a live
 * E2E test finally did. Real Core wraps its catalog in an
 * { ok, protocolVersion, catalog } envelope and, at CATALOG_VERSION 2,
 * nests each subcommand's fields inside a `routes[]` array of route
 * OBJECTS -- not the flat, envelope-free, routes-as-string-array shape
 * this script (and every mock catalog in test/commandCatalogGeneration.test.js)
 * had assumed. Envelope unwrapping and v2 flattening now live in
 * src/catalogTransform.js, shared with registryLoader.js's runtime
 * refresh path, so the committed artifact and a live sync-commands
 * refresh use identical transform logic. See catalogTransform.js's own
 * module comment for the full root-cause writeup.
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
import { transformCatalogToRegistry, applyCommandOverrides } from '../src/catalogTransform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Load configuration
const pkgJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
// TESTABILITY FIX (2026-08-20): .env is a real, operator-provided file
// on a deployed bot -- but test/commandCatalogGeneration.test.js needs
// to import this module's pure functions (validateCatalog,
// applyOverrides) without one present. A missing .env should only ever
// matter to main()'s actual fetchCatalog() call (which needs
// DUNE_DISCORD_TOKEN/DUNE_CONSOLE_API_URL), never to importing the
// module itself.
let env = {};
try {
  const envFile = readFileSync(join(repoRoot, '.env'), 'utf8');
  const envLines = envFile.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  env = Object.fromEntries(envLines.map(line => {
    const [key, ...rest] = line.split('=');
    return [key.trim(), rest.join('=').trim().replace(/^["']|["']$/g, '')];
  }));
} catch {
  // No .env present -- fine for import/testing; main()'s own fetch will
  // fail loudly with a clear "Unauthorized"/network error if actually
  // run without real credentials.
}

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
//
// CORRECTNESS FIX (2026-08-20, found via a real, live Core round-trip --
// see catalogTransform.js's module comment for the full writeup): these
// were previously short-form ('/health') and could never have matched
// any real catalog, since Core's actual routes are always the FULL API
// path ('/api/integrations/discord/health'), exactly as
// src/config.js's own DEFAULT_PATHS already documents for every other
// route in this codebase. This check had silently never been able to
// pass against real data.
const REQUIRED_ROUTES = [
  '/api/integrations/discord/health',
  '/api/integrations/discord/status',
  '/api/integrations/discord/readiness',
  '/api/integrations/discord/services',
  '/api/integrations/discord/population',
  '/api/integrations/discord/logs',
  '/api/integrations/discord/map-state',
  '/api/integrations/discord/version',
  '/api/integrations/discord/maintenance',
  '/api/integrations/discord/backups/list',
  '/api/integrations/discord/servers',
  '/api/integrations/discord/ports',
  '/api/integrations/discord/db'
];

/**
 * Fetch Core's command catalog.
 *
 * CORRECTNESS FIX (2026-08-20): Core's real response is an envelope --
 * { ok, protocolVersion, catalog: { version, groups } } -- not a bare
 * { version, groups } object. Unwrapping happens here (immediately
 * after fetch) so every downstream function in this script keeps
 * working with the bare catalog shape it always expected; only the
 * fetch boundary needed to change, not validateCatalog()/applyOverrides()'s
 * own internals beyond what catalogTransform.js's flattenSubcommand()
 * now handles for v2's nested routes[].
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
            const parsed = JSON.parse(data);
            // Unwrap { ok, protocolVersion, catalog } envelope if present;
            // pass through unchanged if Core ever returns a bare catalog.
            resolve(parsed.catalog && typeof parsed.catalog === 'object' ? parsed.catalog : parsed);
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
  // Support v1 (original) and v2 (with method, bodyField, selector)
  // v2 is the current upstream version with multi-route fanning
  if (catalog.version < 1 || catalog.version > 2) {
    throw new Error(`Unsupported catalog version: ${catalog.version}. This generator supports v1-v2.`);
  }
  if (!Array.isArray(catalog.groups)) {
    throw new Error('Catalog missing groups array');
  }

  // Collect all route PATH STRINGS from catalog.
  //
  // BUG FIX (2026-08-20, found via a real, live Core round-trip): v2's
  // `routes` array contains ROUTE OBJECTS
  // ({ description, route, capability, ... }), not path strings --
  // unlike v1's `route`, which IS already a bare path string. The
  // previous version of this loop did `routes.forEach(r =>
  // catalogRoutes.add(r))`, adding the whole object (stringified to
  // "[object Object]" in a Set, or the object reference itself) instead
  // of `r.route`. That meant catalogRoutes could never contain a real
  // path string for any v2 catalog, so the REQUIRED_ROUTES coverage
  // check below could never have passed against real v2 data -- it
  // just happened to never run against real data until now.
  const catalogRoutes = new Set();
  for (const group of catalog.groups) {
    if (!Array.isArray(group.subcommands)) {
      throw new Error(`Group "${group.name}" missing subcommands array`);
    }
    for (const subcommand of group.subcommands) {
      // v2: routes array of ROUTE OBJECTS (for fanned-out subcommands)
      // v1: single route string directly on the subcommand
      const routePaths = Array.isArray(subcommand.routes)
        ? subcommand.routes.map(r => r.route)
        : (subcommand.route ? [subcommand.route] : []);

      if (routePaths.length === 0 || routePaths.some(r => !r)) {
        throw new Error(`Subcommand "${group.name}/${subcommand.name}" has no route/routes`);
      }

      routePaths.forEach(r => catalogRoutes.add(r));
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
 * Apply bot-side overrides: exclusions, renames, tier adjustments, then
 * stamp generation metadata.
 *
 * CORRECTNESS FIX (2026-08-20): this used to hand-roll its own
 * flatten-and-override logic, DUPLICATING (and, for v2, getting wrong
 * in a different way than) what refreshRegistryFromCore() needed at
 * runtime. Now delegates to catalogTransform.js's
 * transformCatalogToRegistry() (envelope unwrap + v2 routes[]
 * flattening) and applyCommandOverrides() (exclude/rename/retier) --
 * the exact same functions Phase 3's runtime refresh uses -- so the
 * committed artifact and a live /dune admin sync-commands refresh can
 * never structurally diverge again.
 */
function applyOverrides(catalog, overrides) {
  const flattened = transformCatalogToRegistry(catalog);
  const overridden = applyCommandOverrides(flattened, overrides);

  return {
    ...overridden,
    generatedAt: new Date().toISOString(),
    generatorVersion: pkgJson.version
  };
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
    const { catalogRoutes, catalog } = validateCatalog(catalogRaw);
    console.log(`      ✓ Catalog valid (${catalogRoutes.size} unique routes)`);

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

// TESTABILITY FIX (2026-08-20): export the pure functions so
// test/commandCatalogGeneration.test.js can exercise the REAL
// implementation instead of maintaining a separate, hand-copied
// re-implementation that silently drifted from (and, for CATALOG_VERSION
// 2, was buggy in different ways than) the real code -- exactly how the
// envelope-unwrap and routes[]-flattening bugs shipped undetected. Only
// run main() when this file is executed directly (`node
// scripts/generate-command-registry.js`), not when imported as a module
// by tests.
export { validateCatalog, applyOverrides, REQUIRED_ROUTES };

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
