export class AdapterHttpError extends Error {
  constructor(message, { status, route, body }) {
    super(message);
    this.name = "AdapterHttpError";
    this.status = status;
    this.route = route;
    this.body = body;
  }
}

// Routes that are live in upstream main with real data.
export const LIVE_ROUTES = new Set([
  "health", "status", "readiness", "services", "population",
  "version", "servers", "ports", "db",
  "logs", "map-state", "maintenance"
]);

// Routes that exist in upstream but return "planned" stubs or placeholder data.
export const PLANNED_ROUTES = new Set([
  "backups", "announcements",
  "ops-activity", "ops-combat", "ops-resources", "ops-economy",
  "ops-inventory", "ops-location", "ops-soc", "ops-prometheus", "ops-dashboard"
]);

// Routes implemented in feature/discord-player-inventory but NOT yet in upstream main.
export const UNMERGED_ROUTES = new Set([
  "players-link", "players-unlink", "players-me", "players-faction",
  "players-inventory", "players-inventory-search", "players-storage", "players-find",
  "guild-storage", "guild-find"
]);

// Routes that do NOT exist anywhere.
export const MISSING_ROUTES = new Set([
  "write-execute", "write-preview"
]);

export function isRouteLive(route) { return LIVE_ROUTES.has(route); }
export function isRoutePlanned(route) { return PLANNED_ROUTES.has(route); }
export function isRouteUnmerged(route) { return UNMERGED_ROUTES.has(route); }
export function isRouteMissing(route) { return MISSING_ROUTES.has(route); }
export function routeStatus(route) {
  if (LIVE_ROUTES.has(route)) return "live";
  if (PLANNED_ROUTES.has(route)) return "planned";
  if (UNMERGED_ROUTES.has(route)) return "unmerged";
  if (MISSING_ROUTES.has(route)) return "missing";
  return "unknown";
}

const LATENCY_RING = [];
const MAX_LATENCY_ENTRIES = 20;

function recordLatency(route, method, durationMs, status) {
  LATENCY_RING.push({ route, method, durationMs, status, time: new Date().toISOString() });
  if (LATENCY_RING.length > MAX_LATENCY_ENTRIES) LATENCY_RING.shift();
}

export function getLatencyHistory() {
  return [...LATENCY_RING];
}

export class AdapterClient {
  constructor(config, { fetchImpl = globalThis.fetch, getGuildConfig = null } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime.");
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.getGuildConfig = getGuildConfig;
  }

  _resolveConfig(guildId) {
    if (guildId && this.getGuildConfig) {
      const guildConfig = this.getGuildConfig(guildId);
      if (guildConfig) return guildConfig;
    }
    return this.config;
  }

  health(actor, guildId) { return this.request("health", actor, undefined, guildId); }
  status(actor, diagnostic = false, guildId) { return this.request("status", actor, diagnostic ? { diagnostic: true } : undefined, guildId); }
  readiness(actor, diagnostic = false, guildId) { return this.request("readiness", actor, diagnostic ? { diagnostic: true } : undefined, guildId); }
  services(actor, guildId) { return this.request("services", actor, undefined, guildId); }
  population(actor, guildId) { return this.request("population", actor, undefined, guildId); }
  backups(actor, guildId) { return this.request("backups", actor, undefined, guildId); }
  logs(actor, guildId) { return this.request("logs", actor, undefined, guildId); }
  mapState(actor, guildId) { return this.request("map-state", actor, undefined, guildId); }
  maintenance(actor, guildId) { return this.request("maintenance", actor, undefined, guildId); }
  opsActivity(actor, guildId) { return this.request("ops-activity", actor, undefined, guildId); }
  opsCombat(actor, guildId) { return this.request("ops-combat", actor, undefined, guildId); }
  opsResources(actor, guildId) { return this.request("ops-resources", actor, undefined, guildId); }
  opsEconomy(actor, guildId) { return this.request("ops-economy", actor, undefined, guildId); }
  opsInventory(actor, guildId) { return this.request("ops-inventory", actor, undefined, guildId); }
  opsLocation(actor, guildId) { return this.request("ops-location", actor, undefined, guildId); }
  opsSoc(actor, guildId) { return this.request("ops-soc", actor, undefined, guildId); }
  opsPrometheus(actor, guildId) { return this.request("ops-prometheus", actor, undefined, guildId); }
  opsDashboard(actor, guildId) { return this.request("ops-dashboard", actor, undefined, guildId); }
  announcements(actor, guildId) { return this.request("announcements", actor, undefined, guildId); }
  version(actor, guildId) { return this.request("version", actor, undefined, guildId); }
  servers(actor, guildId) { return this.request("servers", actor, undefined, guildId); }
  ports(actor, guildId) { return this.request("ports", actor, undefined, guildId); }
  db(actor, guildId) { return this.request("db", actor, undefined, guildId); }
  writeExecute(actor, body, guildId) { return this.request("write-execute", actor, body, guildId); }
  writePreview(actor, body, guildId) { return this.request("write-preview", actor, body, guildId); }
  playerLink(actor, characterName, guildId) { return this.request("players-link", actor, { characterName }, guildId); }
  playerUnlink(actor, guildId) { return this.request("players-unlink", actor, undefined, guildId); }
  whoami(actor, guildId) { return this.request("players-me", actor, undefined, guildId); }
  playerFaction(actor, faction, guildId) { return this.request("players-faction", actor, { faction }, guildId); }
  playerInventory(actor, guildId) { return this.request("players-inventory", actor, undefined, guildId); }
  playerInventorySearch(actor, query, guildId) { return this.request("players-inventory-search", actor, { query }, guildId); }
  playerStorage(actor, scope, guildId) { return this.request("players-storage", actor, { scope }, guildId); }
  playerFind(actor, query, scope, guildId) { return this.request("players-find", actor, { query, scope }, guildId); }
  guildStorage(actor, guildId) { return this.request("guild-storage", actor, undefined, guildId); }
  guildFind(actor, query, guildId) { return this.request("guild-find", actor, { query }, guildId); }

  async request(route, actor, extra = undefined, guildId = null) {
    const cfg = this._resolveConfig(guildId);
    const path = cfg.adapter.paths[route];
    const method = cfg.adapter.methods[route];
    if (!path || !method) throw new Error(`Unsupported adapter route: ${route}`);

    const url = new URL(path, ensureTrailingSlash(cfg.adapter.baseUrl));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.adapter.timeoutMs);
    const startedAt = Date.now();

    try {
      const headers = {
        accept: "application/json",
        authorization: `Bearer ${cfg.adapter.token}`
      };
      const options = { method, headers, signal: controller.signal };

      if (method === "POST") {
        headers["content-type"] = "application/json";
        options.body = JSON.stringify({ actor: actor || null, ...(extra || {}) });
      }

      const response = await this.fetchImpl(url, options);
      const body = await parseResponseBody(response);
      recordLatency(route, method, Date.now() - startedAt, response.status);
      if (!response.ok) {
        throw new AdapterHttpError(`Adapter ${route} returned HTTP ${response.status}.`, {
          status: response.status, route, body
        });
      }
      return body;
    } catch (error) {
      if (error instanceof AdapterHttpError) throw error;
      recordLatency(route, method, Date.now() - startedAt, 0);
      if (error?.name === "AbortError") {
        throw new Error(`Adapter ${route} request timed out after ${this.config.adapter.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseResponseBody(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: response.ok, body: text };
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
