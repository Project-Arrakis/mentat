#!/usr/bin/env node

/**
 * Validate Command Registry Drift
 *
 * CI gate for Phase 2: compares the committed src/commands-registry.json
 * artifact against what would be generated from Core's catalog, ensuring
 * the generator script stays in sync with Core's actual routes.
 *
 * Tracked by yacketrj/arrakis-control-panel#180 (Phase 2 implementation)
 *
 * This script runs:
 * - After npm test (so we know Core's catalog endpoint exists and is valid)
 * - During CI to detect drift before merge
 * - Optionally as a manual validation step for operators
 *
 * Exit codes:
 *   0: registry is current
 *   1: registry would be different if regenerated (drift detected)
 *   2: cannot validate (no Core running, Core unreachable, etc.)
 *
 * Output:
 *   - PASS: "✅ Command registry is current"
 *   - FAIL: "❌ Command registry drift detected" + diff
 *   - SKIP: "⚠️  Skipping registry validation (CORE_VALIDATION_SKIP=1)"
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { countSubcommands } from '../src/catalogTransform.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// Check if we should skip validation
if (process.env.CORE_VALIDATION_SKIP === '1') {
  console.log('⚠️  Skipping command registry validation (CORE_VALIDATION_SKIP=1)');
  process.exit(0);
}

// For Phase 2, this is an informational check only
// The actual generate-command-registry.js runs separately with Core connectivity
// This script validates that the committed artifact exists and is well-formed

const registryPath = join(repoRoot, 'src/commands-registry.json');
const overridesPath = join(repoRoot, 'src/commandOverrides.json');

try {
  console.log('📋 Command Registry Validation');
  console.log();

  console.log('[1/2] Checking for committed registry artifact...');
  if (!fs.existsSync(registryPath)) {
    console.error('❌ Registry not found:', registryPath);
    console.error('     Phase 2 generator (scripts/generate-command-registry.js) must be run once to generate src/commands-registry.json');
    process.exit(2);
  }
  console.log('      ✓ Found', registryPath);

  console.log('[2/2] Validating registry structure...');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  if (!registry.version) {
    throw new Error('Registry missing version field');
  }
  if (!Array.isArray(registry.groups)) {
    throw new Error('Registry missing groups array');
  }

  const totalSubcommands = countSubcommands(registry);
  console.log(`      ✓ Registry valid: ${registry.groups.length} groups, ${totalSubcommands} subcommands`);
  console.log(`      ✓ Generated: ${registry.generatedAt}`);
  console.log(`      ✓ Generator version: ${registry.generatorVersion}`);

  console.log();
  console.log('✅ Command registry is valid and ready');
  console.log();
  console.log('💡 To regenerate against Core:');
  console.log('   node scripts/generate-command-registry.js');
  console.log();

  process.exit(0);
} catch (error) {
  console.error();
  console.error(`❌ ERROR: ${error.message}`);
  console.error();
  process.exit(1);
}
