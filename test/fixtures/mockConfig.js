/**
 * Mock Configuration
 *
 * Provides a test configuration for the Discord bot.
 */

export function createMockConfig(overrides = {}) {
  const baseConfig = {
    discord: {
      token: 'test-token',
      clientId: 'test-client-id',
      guildId: 'test-guild-id',
      defaultEphemeral: true,
      cooldownSeconds: 0,
      writesEnabled: false,
      rbac: {
        mode: 'restricted',
        allowedUserIds: [],
        observerRoleIds: ['observer-role-id'],
        adminRoleIds: ['admin-role-id'],
        commandRoleIds: {
          'core:about': ['observer-role-id', 'admin-role-id'],
          'core:ping': ['observer-role-id', 'admin-role-id'],
          'core:help': ['observer-role-id', 'admin-role-id'],
          'core:setup': ['observer-role-id', 'admin-role-id'],
          'server:health': ['observer-role-id', 'admin-role-id'],
          'server:status': ['observer-role-id', 'admin-role-id'],
          'server:summary': ['observer-role-id', 'admin-role-id'],
          'server:readiness': ['observer-role-id', 'admin-role-id'],
          'server:services': ['observer-role-id', 'admin-role-id'],
          'data:population': ['observer-role-id', 'admin-role-id'],
          'data:backups': ['observer-role-id', 'admin-role-id'],
          'data:maps': ['observer-role-id', 'admin-role-id'],
          'data:link': ['observer-role-id', 'admin-role-id'],
          'data:unlink': ['observer-role-id', 'admin-role-id'],
          'data:faction': ['observer-role-id', 'admin-role-id'],
          'data:whoami': ['observer-role-id', 'admin-role-id'],
          'data:inventory': ['observer-role-id', 'admin-role-id'],
          'data:find': ['observer-role-id', 'admin-role-id'],
          'data:storage': ['observer-role-id', 'admin-role-id'],
          'ops:activity': ['observer-role-id', 'admin-role-id'],
          'ops:combat': ['observer-role-id', 'admin-role-id'],
          'ops:resources': ['observer-role-id', 'admin-role-id'],
          'ops:economy': ['observer-role-id', 'admin-role-id'],
          'ops:inventory': ['observer-role-id', 'admin-role-id'],
          'ops:location': ['observer-role-id', 'admin-role-id'],
          'ops:soc': ['observer-role-id', 'admin-role-id'],
          'ops:prometheus': ['observer-role-id', 'admin-role-id'],
          'ops:dashboard': ['observer-role-id', 'admin-role-id'],
          'admin:doctor': ['admin-role-id'],
          'admin:cooldowns': ['admin-role-id'],
          'admin:latency': ['admin-role-id'],
          'admin:events': ['admin-role-id'],
          'admin:broadcast': ['admin-role-id'],
          'infra:version': ['observer-role-id', 'admin-role-id'],
          'infra:servers': ['observer-role-id', 'admin-role-id'],
          'infra:ports': ['observer-role-id', 'admin-role-id'],
          'infra:db': ['observer-role-id', 'admin-role-id'],
          'write:maintenance': ['admin-role-id']
        }
      }
    },
    adapter: {
      baseUrl: 'http://localhost:8080',
      token: 'test-bearer-token',
      timeoutMs: 5000,
      paths: {
        health: '/api/health',
        status: '/api/status'
      }
    },
    bot: {
      name: 'dune-awakening-selfhost-discordbot',
      version: '1.5.0',
      readOnly: true
    }
  };

  return { ...baseConfig, ...overrides };
}
