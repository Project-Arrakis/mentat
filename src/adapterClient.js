export class AdapterHttpError extends Error {
  constructor(message, { status, route, body }) {
    super(message);
    this.name = "AdapterHttpError";
    this.status = status;
    this.route = route;
    this.body = body;
  }
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
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime.");
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  health(actor) { return this.request("health", actor); }
  status(actor, diagnostic = false) { return this.request("status", actor, diagnostic ? { diagnostic: true } : undefined); }
  readiness(actor, diagnostic = false) { return this.request("readiness", actor, diagnostic ? { diagnostic: true } : undefined); }
  services(actor) { return this.request("services", actor); }
  population(actor) { return this.request("population", actor); }
  backups(actor) { return this.request("backups", actor); }
  logs(actor) { return this.request("logs", actor); }
  mapState(actor) { return this.request("map-state", actor); }
  maintenance(actor) { return this.request("maintenance", actor); }
  opsActivity(actor) { return this.request("ops-activity", actor); }
  opsCombat(actor) { return this.request("ops-combat", actor); }
  opsResources(actor) { return this.request("ops-resources", actor); }
  opsEconomy(actor) { return this.request("ops-economy", actor); }
  opsInventory(actor) { return this.request("ops-inventory", actor); }
  opsLocation(actor) { return this.request("ops-location", actor); }
  opsSoc(actor) { return this.request("ops-soc", actor); }
  opsPrometheus(actor) { return this.request("ops-prometheus", actor); }
  opsDashboard(actor) { return this.request("ops-dashboard", actor); }
  announcements(actor) { return this.request("announcements", actor); }
  version(actor) { return this.request("version", actor); }
  servers(actor) { return this.request("servers", actor); }
  ports(actor) { return this.request("ports", actor); }
  db(actor) { return this.request("db", actor); }
  writeExecute(actor, body) { return this.request("write-execute", actor, body); }
  writePreview(actor, body) { return this.request("write-preview", actor, body); }
  playerLink(actor, characterName) { return this.request("players-link", actor, { characterName }); }
  playerUnlink(actor) { return this.request("players-unlink", actor); }
  whoami(actor) { return this.request("players-me", actor); }
  playerFaction(actor, faction) { return this.request("players-faction", actor, { faction }); }
  playerInventory(actor) { return this.request("players-inventory", actor); }
  playerInventorySearch(actor, query) { return this.request("players-inventory-search", actor, { query }); }
  playerStorage(actor, scope) { return this.request("players-storage", actor, { scope }); }
  playerFind(actor, query, scope) { return this.request("players-find", actor, { query, scope }); }
  guildStorage(actor) { return this.request("guild-storage", actor); }
  guildFind(actor, query) { return this.request("guild-find", actor, { query }); }

  async request(route, actor, extra = undefined) {
    const path = this.config.adapter.paths[route];
    const method = this.config.adapter.methods[route];
    if (!path || !method) throw new Error(`Unsupported adapter route: ${route}`);

    const url = new URL(path, ensureTrailingSlash(this.config.adapter.baseUrl));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.adapter.timeoutMs);
    const startedAt = Date.now();

    try {
      const headers = {
        accept: "application/json",
        authorization: `Bearer ${this.config.adapter.token}`
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
