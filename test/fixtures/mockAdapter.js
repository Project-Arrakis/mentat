/**
 * Mock Adapter Client
 *
 * Simulates the Discord adapter for testing without requiring a real adapter.
 */

export function createMockAdapter(options = {}) {
  const { delay = 0, error = null } = options;

  const mockData = {
    health: { ok: true, status: 'healthy' },
    status: { ok: true, version: 'v1.3.58', status: 'running' },
    readiness: { ok: true, result: { ready: true, issues: [] } },
    services: { ok: true, result: { services: [{ name: 'server-1', status: 'running' }] } },
    population: { ok: true, result: { onlinePlayers: 5, totalPlayers: 10, aggregate: true } },
    maps: { ok: true, result: { maps: ['Survival_1', 'Overmap'] } },
    logs: { ok: true, logs: ['Log entry 1', 'Log entry 2'] },
    mapState: { ok: true, mapState: 'Map state data' },
    maintenance: { ok: true, maintenance: '' },
    backups: { ok: true, result: { backups: [
      { name: 'backup-2026-07-16', date: '2026-07-16T00:00:00Z', size: '1.2GB' },
      { name: 'backup-2026-07-15', date: '2026-07-15T00:00:00Z', size: '1.1GB' }
    ]}},
    activity: { ok: true, result: { activeLast1h: 3, activeLast24h: 8 } },
    combat: { ok: true, result: { deaths: 42 } },
    resources: { ok: true, result: { spiceFields: 15 } },
    economy: { ok: true, result: { totalCurrency: 1000000 } },
    inventory: { ok: true, result: { totalItems: 500 } },
    location: { ok: true, result: { activeMaps: 2 } },
    soc: { ok: true, result: { alerts: 0 } },
    prometheus: { ok: true, result: { metrics: {} } },
    dashboard: { ok: true, result: { summary: {} } },
    announcements: { ok: true, announcements: [] },
    diagnostic: { ok: true, result: { adapter: 'ok', rbac: 'ok' } },
    version: { ok: true, result: { version: 'v1.3.58' } },
    servers: { ok: true, result: { servers: ['server-1'] } },
    ports: { ok: true, result: { ports: [7777, 8080] } },
    db: { ok: true, result: { status: 'connected' } },
    playerLink: { ok: true, result: { linked: true, code: 'ACP-TEST123' } },
    playerLinkVerify: { ok: true, result: { verified: true, character: 'TestCharacter' } },
    playerUnlink: { ok: true, result: { unlinked: true } },
    playerFaction: { ok: true, faction: 'atreides' },
    whoami: { ok: true, result: { character: 'TestCharacter' } },
    playerInventory: { ok: true, result: { items: [] } },
    playerFind: { ok: true, result: { items: [] } },
    playerStorage: { ok: true, result: { storage: [] } },
    guildStorage: { ok: true, result: { storage: [] } },
    writeMaintenance: { ok: true, idempotencyKey: 'test-key-123', audit: { action: 'write:maintenance', timestamp: new Date().toISOString() } }
  };

  const adapter = {
    async health() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.health;
    },

    async status() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.status;
    },

    async readiness(actor, diagnostic = false) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.readiness;
    },

    async services(actor) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.services;
    },

    async logs(actor, service) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return { ...mockData.logs, service };
    },

    async mapState(actor) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.mapState;
    },

    async maintenance(actor) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.maintenance;
    },

    async population() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.population;
    },

    async maps() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.maps;
    },

    async backups() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.backups;
    },

  async activity() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.activity;
  },

  async opsActivity() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.activity;
  },

  async combat() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.combat;
  },

  async opsCombat() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.combat;
  },

  async resources() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.resources;
  },

  async opsResources() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.resources;
  },

  async economy() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.economy;
  },

  async opsEconomy() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.economy;
  },

  async inventory() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.inventory;
  },

  async opsInventory() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.inventory;
  },

  async location() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.location;
  },

  async opsLocation() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.location;
  },

  async soc() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.soc;
  },

  async opsSoc() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.soc;
  },

  async prometheus() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.prometheus;
  },

  async opsPrometheus() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.prometheus;
  },

  async dashboard() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.dashboard;
  },

  async opsDashboard() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.dashboard;
  },

  async opsAnnouncements() {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (error) throw new Error(error);
    return mockData.announcements;
  },

    async diagnostic() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.diagnostic;
    },

    async version() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.version;
    },

    async servers() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.servers;
    },

    async ports() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.ports;
    },

    async db() {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.db;
    },

    async playerLink(actor, characterName) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.playerLink;
    },

    async playerLinkVerify(actor, code) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return { ...mockData.playerLinkVerify, code };
    },

    async playerUnlink(actor) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.playerUnlink;
    },

    async playerFaction(actor, faction) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return { ...mockData.playerFaction, faction };
    },

    async whoami(actor) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.whoami;
    },

    async playerInventory(actor, search) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.playerInventory;
    },

    async playerFind(actor, query, scope) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.playerFind;
    },

    async playerStorage(actor, scope) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.playerStorage;
    },

    async guildStorage(actor) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return mockData.guildStorage;
    },

    async writeMaintenance(actor, note, idempotencyKey) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (error) throw new Error(error);
      return { ...mockData.writeMaintenance, idempotencyKey };
    },

    close() {
      // Cleanup if needed
    }
  };

  return adapter;
}
