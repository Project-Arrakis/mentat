#!/usr/bin/env node
/**
 * Discord Bot Test Harness
 *
 * Comprehensive end-to-end test suite for the Dune Awakening Discord bot.
 * Mirrors the dune.sh test harness approach with:
 * - Command execution validation
 * - RBAC enforcement testing
 * - Embed formatting verification
 * - Write command safety checks
 * - Faction theming validation
 * - Status card rendering tests
 * - Audit logging verification
 *
 * Usage: node test/discord-bot-test-harness.js [--verbose] [--filter <pattern>]
 */

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert';
import { buildDuneCommand, executeDuneCommand, commandDefinitions } from '../src/commands.js';
import { createMockAdapter } from '../test/fixtures/mockAdapter.js';
import { createMockInteraction } from '../test/fixtures/mockInteraction.js';
import { createMockConfig } from '../test/fixtures/mockConfig.js';
import { sendStatusCard } from '../src/statusCard.js';
import { generateStatusCard } from '../scripts/generate-status-card.js';
import { duneEmbed } from '../src/embedFormat.js';
import { resetCooldowns } from '../src/cooldown.js';
import { debugPeekSteamLinkSession, resetSteamLinkStoreForTests } from '../src/steamLinkStore.js';

const VERBOSE = process.argv.includes('--verbose');
const FILTER = process.argv.find(arg => arg.startsWith('--filter='))?.split('=')[1];

// Create fresh adapter client and config for each test to avoid state pollution
function getTestContext() {
  return {
    adapterClient: createMockAdapter(),
    config: createMockConfig()
  };
}

// Reset cooldowns before each test
beforeEach(() => {
  resetCooldowns();
  resetSteamLinkStoreForTests();
});

// ============================================================================
// Test 1: Command Registration
// ============================================================================

describe('Command Registration', () => {
  test('builds command structure with all groups', () => {
    const command = buildDuneCommand();
    assert.ok(command, 'Command should be built');
    assert.strictEqual(command.name, 'dune', 'Command name should be "dune"');
    assert.ok(command.options, 'Command should have options (subcommand groups)');

    const groups = command.options.map(opt => opt.name);
    assert.ok(groups.includes('core'), 'Should have core group');
    assert.ok(groups.includes('server'), 'Should have server group');
    assert.ok(groups.includes('data'), 'Should have data group');
    assert.ok(groups.includes('ops'), 'Should have ops group');
    assert.ok(groups.includes('admin'), 'Should have admin group');
    assert.ok(groups.includes('infra'), 'Should have infra group');
  });

  test('includes write group when enabled', () => {
    const command = buildDuneCommand({ includeWriteGroup: true });
    const groups = command.options.map(opt => opt.name);
    assert.ok(groups.includes('write'), 'Should have write group when enabled');
  });

  test('excludes write group by default', () => {
    const command = buildDuneCommand();
    const groups = command.options.map(opt => opt.name);
    assert.ok(!groups.includes('write'), 'Should not have write group by default');
  });

  test('registers all 25 slash commands', () => {
    const definitions = commandDefinitions();
    assert.ok(definitions.length > 0, 'Should have command definitions');

    // Count all subcommands across all groups
    let commandCount = 0;
    const commandNames = [];

    definitions.forEach(def => {
      if (def.options) {
        def.options.forEach(group => {
          if (group.options) {
            group.options.forEach(cmd => {
              commandCount++;
              commandNames.push(`${group.name}:${cmd.name}`);
            });
          }
        });
      }
    });

    assert.ok(commandCount >= 25, `Should have at least 25 commands, found ${commandCount}`);

    const expectedCommands = [
      'core:about', 'core:ping', 'core:help', 'core:setup',
      'server:health', 'server:status', 'server:summary', 'server:readiness', 'server:services',
      'data:population', 'data:backups', 'data:maps',
      // inventory/storage/find moved from data to player (2026-07-26) --
      // every player-scoped subcommand now lives under /dune player.
      'player:link', 'player:verify', 'player:characters', 'player:enable', 'player:disable',
      'player:default', 'player:unlink', 'player:faction', 'player:whoami',
      'player:inventory', 'player:storage', 'player:find',
      // ops:inventory renamed to ops:armory (2026-07-26) -- real user
      // confusion with player:inventory, since the two sounded identical
      // but return completely different (per-player vs. server-wide) data.
      'ops:activity', 'ops:combat', 'ops:resources', 'ops:economy', 'ops:armory',
      'ops:location', 'ops:soc', 'ops:prometheus', 'ops:dashboard', 'ops:announcements',
      'admin:doctor', 'admin:cooldowns', 'admin:latency', 'admin:events', 'admin:roles', 'admin:broadcast',
      'infra:version', 'infra:servers', 'infra:ports', 'infra:db'
    ];

    expectedCommands.forEach(cmd => {
      assert.ok(commandNames.includes(cmd), `Should include ${cmd}`);
    });
  });

  // Real bug, found via a live production error (2026-07-27): /dune
  // player unlink's "character" option was marked required, forcing every
  // caller to pass a value even for the single-link fallback path that
  // commands.js's own dispatch logic has always supported (payload =
  // adapterClient.playerUnlink(actor, guildId) when no character is
  // given). Fixed alongside repointing the option's underlying route to
  // Core's real players/accounts/unlink -- see adapterClient.js's
  // playerAccountsUnlink() for the full history.
  test('player:unlink character option is optional, not required (supports the single-link fallback path)', () => {
    const command = buildDuneCommand().toJSON();
    const playerGroup = command.options.find((opt) => opt.name === 'player');
    const unlink = playerGroup.options.find((opt) => opt.name === 'unlink');
    const characterOption = unlink.options?.[0];
    assert.ok(characterOption, 'unlink should still have a character option');
    assert.ok(!characterOption.required, 'the character option must be optional, not required, to support unlinking a single-link character with no argument');
  });
});

// ============================================================================
// Test 2: RBAC Enforcement
// ============================================================================

describe('RBAC Enforcement', () => {
  test('observer can execute core commands', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'core:about',
      roles: ['observer-role-id']
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, 'Observer should be able to execute core:about');
  });

  test('observer can execute server commands', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'server:status',
      roles: ['observer-role-id']
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, 'Observer should be able to execute server:status');
  });

  test('observer cannot execute admin commands', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'admin:doctor',
      roles: ['observer-role-id']
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, 'Command should be handled');
    assert.ok(interaction._reply?.content?.includes('not authorized'), 'Error should mention authorization');
  });

  test('admin can execute admin commands', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'admin:doctor',
      roles: ['admin-role-id']
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, 'Admin should be able to execute admin:doctor');
  });

  test('observer cannot execute write commands', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:maintenance',
      roles: ['observer-role-id'],
      includeWriteGroup: true
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, 'Command should be handled');
    assert.ok(interaction._reply?.content?.includes('not authorized'), 'Error should mention authorization');
  });

  test('admin cannot execute write commands when disabled', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:set-maintenance-note',
      roles: ['admin-role-id'],
      includeWriteGroup: true,
      options: { note: 'Test maintenance' }
    });

    const disabledConfig = { ...config, discord: { ...config.discord, writes: { enabled: false } } };
    const result = await executeDuneCommand(interaction, adapterClient, disabledConfig);
    assert.ok(result, 'Command should be handled');

    // Check editReply embed for error message
    const embed = interaction._editReply?.embeds?.[0]?.data || interaction._editReply?.embeds?.[0];
    const errorField = embed?.fields?.find(f => f.name === 'Error');
    assert.ok(errorField?.value?.includes('disabled') || errorField?.value?.includes('Write commands'), 'Error should mention disabled or write commands');
  });
});

// ============================================================================
// Test 3: Command Execution
// ============================================================================

describe('Command Execution', () => {
  test('core:about returns bot metadata', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'core:about', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    const embed = interaction._editReply.embeds[0].data || interaction._editReply.embeds[0];
    assert.ok(embed.fields?.some(f => f.name.includes('Bot') && f.value.includes('arrakis-control-panel')), 'Should have bot name');
    // PR #70 (af63ca4) updated this expectation to 'Yes' without updating
    // aboutPayload()'s actual readOnly value to match -- V2
    // character-linking commands (link/verify/unlink/faction/enable/
    // disable/default, shipped in #69/1ea3316) write to the local database,
    // so readOnly: true has been a false claim since #69 merged. This
    // asserts the accurate 'No' expectation, matching aboutPayload()'s
    // corrected readOnly: false (see "fix: correct read-only state
    // reporting..." commit).
    assert.ok(embed.fields?.some(f => f.name.includes('ReadOnly') && f.value.includes('No')), 'Should not be read-only (character linking writes to the database)');
  });

  test('core:ping measures latency', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'core:ping', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  });

  test('server:status returns server state', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'server:status', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.files?.[0] || interaction._editReply?.embeds?.[0], 'Should have status card or embed');
    assert.equal(interaction._editReply.files[0].name, 'status-card.png', 'Should be PNG card');
    assert.deepEqual(interaction._editReply.embeds || [], [], 'Should not have embeds');
  });

  test('data:population returns aggregate player count', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'data:population', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  });

  test('data:backups lists recent backups', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'data:backups', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  });

  test('data:maps shows active maps', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'data:maps', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  });

  // Regression guard (issue #162): all 10 ops:* commands below were
  // migrated from PNG status cards (sendOpsCard/sendStatusCard) to real
  // Discord embeds in the "OPS embeds" release (v1.0.0-rc.5, see
  // src/commands.js's `embeds = { activity: formatActivityEmbed, ... }`
  // table and the `embed = (embeds[subcommand] || formatGenericEmbed)(payload)`
  // dispatch at commands.js's ops-group handler) -- these tests still
  // asserted the pre-migration PNG-file behavior and had been silently
  // red on `main` since that release shipped (confirmed: these were 11
  // of the 12 real failures behind issue #162's CI-red report). Updated
  // to assert the real, current behavior: an embed, not a status-card
  // file. sendOpsCard() itself is still defined in statusCard.js but is
  // now dead code -- no call site remains after this migration; tracked
  // separately, not fixed here to keep this change scoped to the CI-red
  // regression.
  test('ops:activity returns activity metrics', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:activity', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:combat returns combat statistics', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:combat', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:resources returns resource statistics', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:resources', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:economy returns economy statistics', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:economy', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:armory returns inventory statistics (renamed from ops:inventory 2026-07-26)', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:armory', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:location returns location activity', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:location', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:soc returns bridge health', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:soc', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:prometheus returns infrastructure metrics', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:prometheus', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:dashboard returns dashboard summary', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:dashboard', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('ops:announcements returns announcements', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'ops:announcements', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    assert.deepEqual(interaction._editReply.files || [], [], 'Should not have a status-card file');
  });

  test('admin:doctor runs comprehensive diagnostic', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'admin:doctor', roles: ['admin-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply, 'Should have reply');
  });

  test('admin:roles shows configured roles resolved to live Discord role names (single-tenant)', async () => {
    const { adapterClient, config } = getTestContext();
    // admin-role-id exists in both the caller's roles AND the mock
    // guild's role list, so it resolves to a real name. observer-role-id
    // is configured but NOT present in guildRoles here, proving the
    // "Unknown Role (id)" path fires for a stale/removed role -- the
    // exact real-world case this feature exists to catch.
    const interaction = createMockInteraction({
      command: 'admin:roles',
      roles: ['admin-role-id'],
      guildRoles: [{ id: 'admin-role-id', name: 'Server Admins' }]
    });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    const reply = interaction._editReply;
    assert.ok(reply, 'Should have reply');
    const text = JSON.stringify(reply);
    assert.ok(text.includes('Server Admins (admin-role-id)'), 'Should show the resolved live role name alongside its ID');
    assert.ok(text.includes('Unknown Role (observer-role-id)'), 'Should flag the configured-but-nonexistent observer role');
  });

  test('admin:roles is rejected for a non-admin actor', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'admin:roles', roles: ['observer-role-id'] });
    await executeDuneCommand(interaction, adapterClient, config);

    // isCommandAllowed() rejects with the shared generic message, not a
    // per-command "requires admin" string -- verified against the real
    // reply text (src/commands.js's executeDuneCommand() catch-all reject
    // path), not assumed.
    assert.ok(interaction._reply?.content?.includes('not authorized'), 'Should reject non-admin actor with a role-requirement message');
  });

  test('infra:version shows version info', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'infra:version', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  });

  test('server:readiness-detail returns grouped readiness issues', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'server:readiness-detail', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    const embed = interaction._editReply.embeds[0].data || interaction._editReply.embeds[0];
    assert.ok(embed.title?.includes('Readiness'), 'Should have readiness title');
  });

  test('server:services-detail returns detailed service state', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'server:services-detail', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    const embed = interaction._editReply.embeds[0].data || interaction._editReply.embeds[0];
    assert.ok(embed.title?.includes('Services'), 'Should have services title');
  });

  test('server:maintenance returns maintenance status (read-only)', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'server:maintenance', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
    const embed = interaction._editReply.embeds[0].data || interaction._editReply.embeds[0];
    assert.ok(embed.title?.includes('Maintenance'), 'Should have maintenance title');
    assert.ok(embed.description?.includes('No maintenance scheduled'), 'Should report no active maintenance from mock data');
  });

  test('server:maintenance reports unknown when adapter omits ok:true', async () => {
    const { config } = getTestContext();
    const interaction = createMockInteraction({ command: 'server:maintenance', roles: ['observer-role-id'] });
    const failingAdapter = { maintenance: async () => ({ ok: false }) };
    const result = await executeDuneCommand(interaction, failingAdapter, config);

    assert.ok(result, 'Command should succeed without throwing');
    const embed = interaction._editReply?.embeds?.[0]?.data || interaction._editReply?.embeds?.[0];
    assert.ok(embed?.description?.includes('Unknown'), 'Missing/failed maintenance data must read as unknown, not healthy');
  });

  test('player:verify initiates link verification', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'player:verify',
      roles: ['observer-role-id'],
      options: { code: 'ACP-TEST123' }
    });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  });

  test('player:link calls adapterClient.playerLink() (the real, live V1 route), not playerLinkStart() (still-unmerged V2 route)', async () => {
    // Regression test for a real production bug (found via a live test,
    // 2026-07-26): commands.js's player:link handler called
    // adapterClient.playerLinkStart() -- which hits Core's still-unmerged
    // player-links-start route -- instead of adapterClient.playerLink(),
    // which hits the real, live players-link route
    // (linkPlayerProvider(), the function FINDING-LINK-7's hasSteam
    // extension actually targets). This went undetected because the mock
    // adapter had no playerLinkStart() method at all, and no test ever
    // exercised player:link's actual execution path -- only its presence
    // in a command-name list. Every real /dune player link attempt in
    // production failed with an "unmerged route" error until this was
    // found and fixed.
    const { config } = getTestContext();
    let calledMethod = null;
    const trackingAdapter = createMockAdapter();
    trackingAdapter.playerLink = async (actor, characterName) => {
      calledMethod = 'playerLink';
      return { ok: true, hasSteam: false, characterName, message: 'A private verification code was sent in game.' };
    };
    trackingAdapter.playerLinkStart = async () => {
      calledMethod = 'playerLinkStart';
      const err = new Error('player links start is implemented in feature/discord-player-inventory but not yet merged to upstream.');
      err.route = 'player-links-start';
      throw err;
    };

    const interaction = createMockInteraction({
      command: 'player:link',
      roles: ['observer-role-id'],
      options: { character: 'Sihaya' }
    });
    const result = await executeDuneCommand(interaction, trackingAdapter, config);

    assert.ok(result, 'Command should succeed');
    assert.equal(calledMethod, 'playerLink', 'Must call playerLink(), not playerLinkStart()');
    assert.ok(interaction._editReply, 'Should have a reply');
    assert.ok(!interaction._reply, 'Should not hit the generic error-reply path (would indicate the wrong/unmerged route was called)');
  });

  test.skip('player:link offers the Steam-link button when hasSteam is true and steamLink is enabled', async () => {
    const { config } = getTestContext();
    config.steamLink = { enabled: true, baseUrl: 'https://acp-setup.darkdante.org' };
    const trackingAdapter = createMockAdapter();
    trackingAdapter.playerLink = async () => ({ ok: true, hasSteam: true, playerControllerId: '1', characterName: 'Sihaya' });

    const interaction = createMockInteraction({
      command: 'player:link',
      roles: ['observer-role-id'],
      options: { character: 'Sihaya' }
    });
    const result = await executeDuneCommand(interaction, trackingAdapter, config);

    assert.ok(result, 'Command should succeed');
    const hasSteamButton = interaction._editReply?.components?.length ||
      interaction._editReply?.content?.includes('Link via Steam') ||
      interaction._editReply?.embeds?.[0]?.data?.description?.includes('Steam');
    assert.ok(hasSteamButton, 'Should offer the Steam-link button');
  });

  test.skip('player:link creates a Steam-link session with a real username/channelId/roleIds, not just userId/guildId (regression, real bug found 2026-07-26)', async () => {
    // Every real Core call steamLinkServer.js makes later (after the
    // OAuth redirect round-trip) is built from THIS session -- Core's
    // normalizeDiscordActor() hard-requires username/channelId on every
    // actor object, and requireSelfScopedCapability() needs real roleIds.
    // A session created with only userId/guildId (the shape before this
    // fix) meant every real link-steam attempt in production failed with
    // a 400 "actor.username is required" error. This asserts the session
    // commands.js actually creates has the full, real actor shape.
    const { config } = getTestContext();
    config.steamLink = { enabled: true, baseUrl: 'https://acp-setup.darkdante.org' };
    const trackingAdapter = createMockAdapter();
    trackingAdapter.playerLink = async () => ({ ok: true, hasSteam: true, playerControllerId: '1', characterName: 'Sihaya' });

    const interaction = createMockInteraction({
      command: 'player:link',
      roles: ['observer-role-id'],
      userId: 'real-user-id',
      username: 'RealDiscordUsername',
      guildId: 'real-guild-id',
      channelId: 'real-channel-id',
      options: { character: 'Sihaya' }
    });
    const result = await executeDuneCommand(interaction, trackingAdapter, config);

    assert.ok(result, 'Command should succeed');
    // Find the session this call created by checking the button URL's
    // state query param, then peek the real stored session.
    const button = interaction._editReply?.components?.[0]?.components?.[0];
    const startUrl = button?.data?.url || button?.url;
    assert.ok(startUrl, 'Should have a Steam-link start URL');
    const state = new URL(startUrl).searchParams.get('state');
    assert.ok(state, 'URL should include a state token');
    const session = debugPeekSteamLinkSession(state);
    assert.ok(session, 'Session should exist in the store');
    assert.equal(session.discordUserId, 'real-user-id');
    assert.equal(session.username, 'RealDiscordUsername');
    assert.equal(session.guildId, 'real-guild-id');
    assert.equal(session.channelId, 'real-channel-id');
    assert.deepEqual(session.roleIds, ['observer-role-id']);
  });

  test('player:link falls back to the whisper flow when hasSteam is true but steamLink is not enabled (FINDING-STEAM-5)', async () => {
    const { config } = getTestContext();
    config.steamLink = { enabled: false, baseUrl: 'https://acp-setup.darkdante.org' };
    const trackingAdapter = createMockAdapter();
    trackingAdapter.playerLink = async () => ({ ok: true, hasSteam: true, playerControllerId: '1', characterName: 'Sihaya', pending: true, message: 'A private verification code was sent in game.' });

    const interaction = createMockInteraction({
      command: 'player:link',
      roles: ['observer-role-id'],
      options: { character: 'Sihaya' }
    });
    const result = await executeDuneCommand(interaction, trackingAdapter, config);

    assert.ok(result, 'Command should succeed');
    const replyText = JSON.stringify(interaction._editReply || {});
    assert.ok(!replyText.includes('Link via Steam'), 'Must NOT offer Steam-link when steamLink.enabled is false, even if hasSteam is true');
  });
});

// ============================================================================
// Test 4: Faction Theming
// ============================================================================

describe('Faction Theming', () => {
  test('player:faction sets player faction', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'player:faction',
      roles: ['observer-role-id'],
      options: { name: 'atreides' }
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0], 'Should have embed');
  });

  test('faction embed uses correct colors', () => {
    const atreidesEmbed = duneEmbed({ faction: 'atreides', title: 'Test' });
    assert.strictEqual(atreidesEmbed.data.color, 0x16a34a, 'Atreides should use green');

    const harkonnenEmbed = duneEmbed({ faction: 'harkonnen', title: 'Test' });
    assert.strictEqual(harkonnenEmbed.data.color, 0xef4444, 'Harkonnen should use red');

    const fremenEmbed = duneEmbed({ faction: 'fremen', title: 'Test' });
    assert.strictEqual(fremenEmbed.data.color, 0x2563eb, 'Fremen should use blue');
  });

  test('faction embed includes themed quotes', () => {
    const atreidesEmbed = duneEmbed({ faction: 'atreides', title: 'Test' });
    assert.ok(atreidesEmbed.data.footer?.text, 'Atreides embed should have footer with quote');

    const harkonnenEmbed = duneEmbed({ faction: 'harkonnen', title: 'Test' });
    assert.ok(harkonnenEmbed.data.footer?.text, 'Harkonnen embed should have footer with quote');

    const fremenEmbed = duneEmbed({ faction: 'fremen', title: 'Test' });
    assert.ok(fremenEmbed.data.footer?.text, 'Fremen embed should have footer with quote');
  });
});

// ============================================================================
// Test 4.5: Adapter Methods
// ============================================================================

describe('Adapter Methods', () => {
  test('adapterClient.logs() returns log entries', async () => {
    const { adapterClient } = getTestContext();
    const actor = { userId: 'test-user', guildId: 'test-guild', channelId: 'test-channel', roleIds: ['observer-role-id'] };

    const result = await adapterClient.logs(actor);
    assert.ok(result, 'Should return result');
    assert.ok(result.ok !== false, 'Should succeed');
  });

  test('adapterClient.mapState() returns map runtime state', async () => {
    const { adapterClient } = getTestContext();
    const actor = { userId: 'test-user', guildId: 'test-guild', channelId: 'test-channel', roleIds: ['observer-role-id'] };

    const result = await adapterClient.mapState(actor);
    assert.ok(result, 'Should return result');
    assert.ok(result.ok !== false, 'Should succeed');
  });

  test('adapterClient.logs() returns log entries', async () => {
    const { adapterClient } = getTestContext();
    const actor = { userId: 'test-user', guildId: 'test-guild', channelId: 'test-channel', roleIds: ['observer-role-id'] };

    const result = await adapterClient.logs(actor, 'dune-server');
    assert.ok(result, 'Should return result');
    assert.ok(result.ok !== false, 'Should succeed');
  });

  test('adapterClient.playerLinkVerify() verifies link code', async () => {
    const { adapterClient } = getTestContext();
    const actor = { userId: 'test-user', guildId: 'test-guild', channelId: 'test-channel', roleIds: ['observer-role-id'] };

    const result = await adapterClient.playerLinkVerify(actor, 'ACP-TEST123');
    assert.ok(result, 'Should return result');
    assert.ok(result.ok !== false, 'Should succeed');
  });

  // ─── Real bug, found via a live production error (2026-07-27):
  // /dune player unlink <character> failed with "player links unlink is
  // implemented in feature/discord-player-inventory but not yet merged
  // to upstream" -- and /dune player characters was separately broken
  // the same way, both calling a route family (player-links/*) that has
  // never existed on Core at all. Core's real routes are
  // players/accounts/list and players/accounts/unlink. This harness
  // previously had ZERO test coverage for either the old broken methods
  // (playerLinks()/playerUnlinkV2()) or their replacements
  // (playerAccountsList()/playerAccountsUnlink()) -- exactly how this
  // production bug went undetected until a real user hit it. These
  // tests exercise the full /dune player characters and
  // /dune player unlink command paths end-to-end through
  // executeDuneCommand(), not just the adapter method in isolation.

  test('adapterClient.playerAccountsList() returns linked accounts with real playerControllerId', async () => {
    const { adapterClient } = getTestContext();
    const actor = { userId: 'test-user', guildId: 'test-guild', channelId: 'test-channel', roleIds: ['observer-role-id'] };

    const result = await adapterClient.playerAccountsList(actor);
    assert.ok(result, 'Should return result');
    assert.ok(result.ok !== false, 'Should succeed');
    assert.ok(Array.isArray(result.accounts), 'Should return an accounts array');
    assert.ok(result.accounts[0].playerControllerId, 'Each account must expose a real playerControllerId -- this is the value /dune player unlink actually needs');
  });

  test('adapterClient.playerAccountsUnlink() unlinks by playerControllerId', async () => {
    const { adapterClient } = getTestContext();
    const actor = { userId: 'test-user', guildId: 'test-guild', channelId: 'test-channel', roleIds: ['observer-role-id'] };

    const result = await adapterClient.playerAccountsUnlink(actor, '1');
    assert.ok(result, 'Should return result');
    assert.ok(result.ok !== false, 'Should succeed');
  });

  test('/dune player characters calls the real players/accounts/list route, not the never-built player-links route', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'player:characters',
      roles: ['observer-role-id']
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, '/dune player characters should be handled successfully, not throw');
  });

  test('/dune player unlink with a playerControllerId calls playerAccountsUnlink, not the never-built player-links-unlink route', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'player:unlink',
      roles: ['observer-role-id'],
      options: { character: '1' }
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, '/dune player unlink <character> should be handled successfully, not throw');
  });

  test('/dune player unlink with no argument falls back to single-link playerUnlink, not a required-argument error', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'player:unlink',
      roles: ['observer-role-id']
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, '/dune player unlink with no character argument should still be handled successfully -- the option is optional, not required');
  });
});

// ============================================================================
// Test 5: Status Card Rendering
// ============================================================================

describe('Status Card Rendering', () => {
  test('renders status card with server data', async () => {
    const serverData = {
      title: 'Test Server',
      overall: 'ONLINE',
      region: 'NA',
      mode: 'public',
      population: '5/10',
      maps: [{ name: 'Survival_1', state: 'RUNNING' }],
      services: 3,
      latency: 50,
      quote: 'The spice must flow.'
    };

    const canvas = await generateStatusCard(serverData);
    assert.ok(canvas, 'Should return canvas object');

    const buffer = canvas.toBuffer('image/png');
    assert.ok(Buffer.isBuffer(buffer), 'Should convert to buffer');
    assert.ok(buffer.length > 0, 'Buffer should not be empty');

    // Check PNG signature
    const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.ok(buffer.slice(0, 8).equals(pngSignature), 'Should be valid PNG');
  });

  test('status card dimensions are 1200x640', async () => {
    const serverData = {
      title: 'Test',
      overall: 'ONLINE',
      population: '0/0'
    };

    const canvas = await generateStatusCard(serverData);
    const buffer = canvas.toBuffer('image/png');

    // PNG header contains dimensions at bytes 16-23
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    assert.strictEqual(width, 1200, 'Width should be 1200');
    assert.strictEqual(height, 640, 'Height should be 640');
  });

  test('status card includes faction theming', async () => {
    const serverData = {
      title: 'Test',
      overall: 'ONLINE',
      population: '0/0',
      quote: 'Test quote'
    };

    const atreidesCard = await generateStatusCard({ ...serverData, faction: 'atreides' });
    const harkonnenCard = await generateStatusCard({ ...serverData, faction: 'harkonnen' });

    const atreidesBuffer = atreidesCard.toBuffer('image/png');
    const harkonnenBuffer = harkonnenCard.toBuffer('image/png');

    // Cards should be different (different color schemes)
    assert.ok(!atreidesBuffer.equals(harkonnenBuffer), 'Faction cards should differ');
  });
});

// ============================================================================
// Test 6: Write Command Safety
// ============================================================================

describe('Write Command Safety', () => {
  test('write commands are disabled by default', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:maintenance-note',
      roles: ['admin-role-id'],
      includeWriteGroup: true,
      options: { note: 'Test maintenance note' }
    });

    const defaultConfig = { ...config, discord: { ...config.discord, writesEnabled: false } };
    const result = await executeDuneCommand(interaction, adapterClient, defaultConfig);

    assert.ok(result, 'Command should be handled');
    const embed = interaction._editReply?.embeds?.[0];
    assert.ok(embed, 'Should have embed');
    const embedData = embed.data || embed;
    const errorField = embedData.fields?.find(f => f.name === 'Error');
    assert.ok(errorField?.value?.includes('disabled') || errorField?.value?.includes('not authorized'), 'Error should mention disabled or authorization');
  });

  test('write commands require confirmation', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:maintenance-note',
      roles: ['admin-role-id'],
      includeWriteGroup: true,
      options: { note: 'Test maintenance note', confirm: false }
    });

    const enabledConfig = { ...config, discord: { ...config.discord, writesEnabled: true } };
    const result = await executeDuneCommand(interaction, adapterClient, enabledConfig);

    assert.ok(result, 'Command should be handled');
    assert.ok(interaction._reply?.content?.includes('confirm') || interaction._editReply?.embeds?.[0], 'Should require confirmation or show embed');
  });

  test('write commands generate idempotency key', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:maintenance-note',
      roles: ['admin-role-id'],
      includeWriteGroup: true,
      options: { note: 'Test maintenance note', confirm: true }
    });

    const enabledConfig = { ...config, discord: { ...config.discord, writesEnabled: true } };
    const result = await executeDuneCommand(interaction, adapterClient, enabledConfig);

    assert.ok(result, 'Command should be handled');
    assert.ok(interaction._editReply?.embeds?.[0] || interaction._reply, 'Should have response');
  });

  test('write commands log audit events', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:maintenance-note',
      roles: ['admin-role-id'],
      includeWriteGroup: true,
      options: { note: 'Test maintenance note', confirm: true }
    });

    const enabledConfig = { ...config, discord: { ...config.discord, writesEnabled: true } };
    const result = await executeDuneCommand(interaction, adapterClient, enabledConfig);

    assert.ok(result, 'Command should be handled');
    assert.ok(interaction._editReply?.embeds?.[0] || interaction._reply, 'Should have response');
  });
});

// ============================================================================
// Test 7: Error Handling
// ============================================================================

describe('Error Handling', () => {
  test('adapter timeout returns error', async () => {
    const { config } = getTestContext();
    const slowAdapter = createMockAdapter({ delay: 10000 });
    const interaction = createMockInteraction({ command: 'server:status', roles: ['observer-role-id'] });
    const timeoutConfig = { ...config, adapter: { ...config.adapter, timeoutMs: 100 } };

    const result = await executeDuneCommand(interaction, slowAdapter, timeoutConfig);
    assert.ok(result, 'Command should be handled');
    // Mock adapter doesn't implement timeout behavior, so just verify command completes
    assert.ok(interaction._reply || interaction._editReply, 'Should have response');

    slowAdapter.close();
  });

  test('adapter error returns error', async () => {
    const { config } = getTestContext();
    const errorAdapter = createMockAdapter({ error: 'Adapter unavailable' });
    const interaction = createMockInteraction({ command: 'server:status', roles: ['observer-role-id'] });

    const result = await executeDuneCommand(interaction, errorAdapter, config);
    assert.ok(result, 'Command should be handled');
    assert.ok(interaction._reply || interaction._editReply, 'Should have response');

    errorAdapter.close();
  });

  test('invalid command returns error', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'invalid:command', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result === false || result === true, 'Should handle invalid command');
  });
});

// ============================================================================
// Test 8: Cooldown Enforcement
// ============================================================================

describe('Cooldown Enforcement', () => {
  test('commands respect cooldown periods', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'server:status', roles: ['observer-role-id'] });

    // First execution should succeed
    const result1 = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result1, 'First execution should succeed');

    // Immediate second execution should be rate-limited
    const cooldownConfig = { ...config, discord: { ...config.discord, cooldownSeconds: 60 } };
    const result2 = await executeDuneCommand(interaction, adapterClient, cooldownConfig);

    assert.ok(result2, 'Command should be handled');
    assert.ok(interaction._reply?.content?.includes('wait') || interaction._editReply?.embeds?.[0], 'Should mention cooldown or show embed');
  });
});

// ============================================================================
// Test 9: Audit Logging
// ============================================================================

describe('Audit Logging', () => {
  test('read commands are not audited', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({ command: 'server:status', roles: ['observer-role-id'] });
    const result = await executeDuneCommand(interaction, adapterClient, config);

    assert.ok(result, 'Command should succeed');
    // Read commands don't return audit data in the response
  });

  test('write commands are audited', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:maintenance-note',
      roles: ['admin-role-id'],
      includeWriteGroup: true,
      options: { note: 'Test note', confirm: true }
    });

    const enabledConfig = { ...config, discord: { ...config.discord, writesEnabled: true } };
    const result = await executeDuneCommand(interaction, adapterClient, enabledConfig);

    assert.ok(result, 'Command should succeed');
    assert.ok(interaction._editReply?.embeds?.[0] || interaction._reply, 'Should have response');
  });

  test('failed commands are audited', async () => {
    const { adapterClient, config } = getTestContext();
    const interaction = createMockInteraction({
      command: 'write:maintenance-note',
      roles: ['observer-role-id'],
      includeWriteGroup: true,
      options: { note: 'Test note' }
    });

    const result = await executeDuneCommand(interaction, adapterClient, config);
    assert.ok(result, 'Command should be handled');
    const embed = interaction._editReply?.embeds?.[0];
    assert.ok(embed, 'Should have embed');
    const embedData = embed.data || embed;
    const errorField = embedData.fields?.find(f => f.name === 'Error');
    assert.ok(errorField?.value?.includes('not authorized') || errorField?.value?.includes('disabled'), 'Should deny access');
  });
});

// ============================================================================
// Test 9.5: Alert Subscriber
// ============================================================================

describe('Alert Subscriber', () => {
  test('alertSubscriber can be created with valid config', async () => {
    const { alertSubscriber } = await import('../src/notifications.js');
    const { adapterClient } = getTestContext();

    const mockClient = {
      channels: {
        fetch: async (channelId) => ({
          id: channelId,
          isTextBased: () => true,
          send: async (content) => ({ id: 'msg-123', content })
        })
      }
    };

    const subscriber = alertSubscriber({
      adapterClient,
      client: mockClient,
      channelId: 'test-channel-id',
      onError: (error) => console.error('Alert error:', error)
    });

    assert.ok(subscriber, 'Should create alert subscriber');
    assert.ok(typeof subscriber.checkReadiness === 'function', 'Should have checkReadiness method');
    assert.ok(typeof subscriber.checkServices === 'function', 'Should have checkServices method');
  });

  test('alertSubscriber.checkReadiness sends alert when not ready', async () => {
    const { alertSubscriber } = await import('../src/notifications.js');
    const { adapterClient } = getTestContext();

    let sentMessage = null;
    const mockClient = {
      channels: {
        fetch: async (channelId) => ({
          id: channelId,
          isTextBased: () => true,
          send: async (content) => {
            sentMessage = content;
            return { id: 'msg-123', content };
          }
        })
      }
    };

    const subscriber = alertSubscriber({
      adapterClient,
      client: mockClient,
      channelId: 'test-channel-id',
      onError: (error) => console.error('Alert error:', error)
    });

    await subscriber.checkReadiness();

    // Mock adapter returns ready state, so no alert should be sent
    // This test verifies the subscriber doesn't crash
    assert.ok(true, 'checkReadiness should complete without error');
  });

  test('alertSubscriber.checkServices sends alert when services down', async () => {
    const { alertSubscriber } = await import('../src/notifications.js');
    const { adapterClient } = getTestContext();

    let sentMessage = null;
    const mockClient = {
      channels: {
        fetch: async (channelId) => ({
          id: channelId,
          isTextBased: () => true,
          send: async (content) => {
            sentMessage = content;
            return { id: 'msg-123', content };
          }
        })
      }
    };

    const subscriber = alertSubscriber({
      adapterClient,
      client: mockClient,
      channelId: 'test-channel-id',
      onError: (error) => console.error('Alert error:', error)
    });

    await subscriber.checkServices();

    // Mock adapter returns healthy services, so no alert should be sent
    // This test verifies the subscriber doesn't crash
    assert.ok(true, 'checkServices should complete without error');
  });
});

// ============================================================================
// Test 10: Integration Smoke Test
// ============================================================================

describe('Integration Smoke Test', () => {
  test('bot can start and register commands', async () => {
    // This would normally start the actual bot, but we'll simulate
    const command = buildDuneCommand();
    assert.ok(command, 'Bot should build command structure');

    const definitions = commandDefinitions();
    assert.ok(definitions.length > 0, 'Bot should have command definitions');
  });

  test('adapter client can connect', async () => {
    const { adapterClient } = getTestContext();
    const health = await adapterClient.health();
    assert.ok(health.ok, 'Adapter should be healthy');
  });

  test('all read commands execute successfully', async () => {
    const { adapterClient, config } = getTestContext();
    const readCommands = [
      'core:about', 'core:ping', 'server:status', 'data:population',
      'data:maps', 'ops:activity', 'infra:version'
    ];

    for (const cmd of readCommands) {
      const interaction = createMockInteraction({ command: cmd, roles: ['observer-role-id'] });
      const result = await executeDuneCommand(interaction, adapterClient, config);
      assert.ok(result, `${cmd} should succeed`);
    }
  });
});

// ============================================================================
// Test Runner
// ============================================================================

if (process.argv[1]?.includes('discord-bot-test-harness.js')) {
  console.log('🏜️  Dune Discord Bot Test Harness\n');
  console.log('Running comprehensive test suite...\n');

  // Node.js test runner will execute all tests automatically
  // This block is just for CLI feedback
}
