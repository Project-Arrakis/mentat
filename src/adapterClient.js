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
//
// ops-activity, ops-combat, ops-resources, ops-economy moved here from
// PLANNED_ROUTES: dune-awakening-selfhost-docker's
// docs/remediation-prompt-cross-repo.md Phase 1 (PR
// yacketrj/dune-awakening-selfhost-docker#109, merged) wired all four to
// real duneDb.js queries, replacing their previous
// { status: "planned" } stub responses with real
// { ok: true, result: {...} } data. ops-dashboard is NOT moved: it
// aggregates all nine ops-* providers, four of which (inventory,
// location, soc, prometheus) still return planned placeholders, so its
// own output remains a genuine mix, not fully live.
export const LIVE_ROUTES = new Set([
  "health", "status", "readiness", "services", "population",
  "version", "servers", "ports", "db",
  "logs", "map-state",
  "ops-activity", "ops-combat", "ops-resources", "ops-economy"
]);

// Routes that exist in upstream but return "planned" stubs or placeholder data.
export const PLANNED_ROUTES = new Set([
  "backups", "announcements", "broadcast",
  "ops-inventory", "ops-location", "ops-soc", "ops-prometheus", "ops-dashboard"
]);

// Routes implemented in feature/discord-player-inventory but NOT yet in upstream main.
//
// players-accounts-link-steam and players-accounts-match-steam
// (2026-07-24, second revision): the Core-side half of the Steam-connections
// verification path for /dune player link <character-name> (see
// docs/steam-link-implementation-prompt.md Part 1). This flow no longer
// resolves a candidate list -- it checks whether ONE specific,
// already-named character's on-file Steam ID matches the Discord user's
// connections, so there is one fewer route than the original design (no
// "resolve-steam" route). Tracked here the same way as every other
// not-yet-merged route in this set — the bot-side code that calls them is
// complete and correct, but a session in the Core repo is implementing the
// new route(s) separately; until that PR merges, calling these routes
// returns the same "not yet merged" error every other UNMERGED_ROUTES
// entry does (see executeDuneCommand()'s catch block). Additionally, the
// existing player-links-start route's response is expected to gain a new
// hasSteam/playerControllerId field pair once Core's change lands --
// until then it simply won't be present, and player:link's dispatch logic
// already treats an absent/false hasSteam as "use the whisper flow",
// which is the correct behavior either way.
export const UNMERGED_ROUTES = new Set([
  "players-link", "players-link-verify", "players-unlink", "players-me", "players-faction",
  "players-inventory", "players-inventory-search", "players-storage", "players-find",
  "guild-storage", "guild-find",
  "player-links-start", "player-links-verify", "player-links", "player-links-unlink",
  "guild-grants", "guild-grants-enable", "guild-grants-disable", "guild-grants-default",
  "player-inventory-v2",
  "players-accounts-link-steam", "players-accounts-match-steam"
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
  logs(actor, service, guildId) { return this.request("logs", actor, service ? { service } : undefined, guildId); }
  mapState(actor, guildId) { return this.request("map-state", actor, undefined, guildId); }
  // Route provenance is unverified against upstream main (see docs/adapter-contract.md,
  // which currently documents only health/status/readiness/services). Left out of
  // LIVE_ROUTES/PLANNED_ROUTES/UNMERGED_ROUTES until confirmed; routeStatus("maintenance")
  // returns "unknown" so callers can surface that honestly instead of assuming success.
  maintenance(actor, guildId) { return this.request("maintenance", actor, undefined, guildId); }
  broadcast(actor, message, guildId) { return this.request("broadcast", actor, { message }, guildId); }
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
  // Note: "players-link-verify" (V1) has no dedicated method. The V1 verify route is
  // superseded by the V2 playerLinkVerify()/"player-links-verify" method below; keeping
  // two methods named playerLinkVerify silently shadowed the V1 one (dead code; the class
  // only ever exposed the last definition). Call request("players-link-verify", ...)
  // directly if V1 verify is ever needed again.
  playerUnlink(actor, guildId) { return this.request("players-unlink", actor, undefined, guildId); }
  whoami(actor, guildId) { return this.request("players-me", actor, undefined, guildId); }
  playerFaction(actor, faction, guildId) { return this.request("players-faction", actor, { faction }, guildId); }
  playerInventory(actor, guildId) { return this.request("players-inventory", actor, undefined, guildId); }
  playerInventorySearch(actor, query, guildId) { return this.request("players-inventory-search", actor, { query }, guildId); }
  playerStorage(actor, scope, guildId) { return this.request("players-storage", actor, { scope }, guildId); }
  playerFind(actor, query, scope, guildId) { return this.request("players-find", actor, { query, scope }, guildId); }
  guildStorage(actor, guildId) { return this.request("guild-storage", actor, undefined, guildId); }
  guildFind(actor, query, guildId) { return this.request("guild-find", actor, { query }, guildId); }

  playerLinkStart(actor, characterName, guildId) { return this.request("player-links-start", actor, { characterName }, guildId); }
  playerLinkVerify(actor, code, guildId) { return this.request("player-links-verify", actor, { code }, guildId); }
  playerLinks(actor, guildId) { return this.request("player-links", actor, undefined, guildId); }
  playerUnlinkV2(actor, characterLinkId, guildId) { return this.request("player-links-unlink", actor, { characterLinkId }, guildId); }
  guildGrantsEnable(actor, characterLinkId, guildId) { return this.request("guild-grants-enable", actor, { characterLinkId }, guildId); }
  guildGrantsDisable(actor, characterLinkId, guildId) { return this.request("guild-grants-disable", actor, { characterLinkId }, guildId); }
  guildGrantsDefault(actor, characterLinkId, guildId) { return this.request("guild-grants-default", actor, { characterLinkId }, guildId); }
  playerInventoryV2(actor, characterHandle, guildId) { return this.request("player-inventory-v2", actor, { characterHandle }, guildId); }

  // Steam-connections-based verification for the ALREADY-NAMED character
  // from /dune player link <character-name> — see
  // docs/steam-link-architecture.md. Both routes reuse the existing
  // self-scoped ACCOUNT_LINK_WRITE capability on the Core side; no new
  // capability or bearer-auth mechanism is introduced. matchSteamCandidate
  // checks whether the given playerControllerId's on-file Steam ID
  // appears anywhere in steamId64List (the Discord user's connections) —
  // it is never a candidate-resolution call across multiple characters.
  matchSteamCandidate(actor, playerControllerId, steamId64List, guildId) { return this.request("players-accounts-match-steam", actor, { playerControllerId, steamId64List }, guildId); }
  linkAccountViaSteam(actor, playerControllerId, guildId) { return this.request("players-accounts-link-steam", actor, { playerControllerId }, guildId); }

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
