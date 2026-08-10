import { signedHeaders } from "./actorSignature.js";

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
  "ops-activity", "ops-combat", "ops-resources", "ops-economy",
  // Added 2026-07-27 (see UNMERGED_ROUTES's "SECOND reconciliation" comment
  // above for the full history): all three are real, live Core routes,
  // confirmed via direct grep of Core's real DISCORD_ADAPTER_ROUTES/
  // routes.js, now actually called by adapterClient.js instead of the
  // never-built player-links/* path family.
  "players-link-verify", "players-accounts-list", "players-accounts-unlink",
  // THIRD reconciliation (2026-08-06, RO roadmap audit -- see
  // docs/ro-roadmap-state-2026-08-06.md): the routes below were NOT in any
  // table, leaving routeStatus() = "unknown" for every one even though the
  // bot calls them daily (/dune player link/verify/characters/inventory/
  // storage/find, /dune ops, and the Steam link flow). All are real, live
  // Core routes now called by adapterClient.js -- verified 2026-08-06 by
  // direct grep of Core's DISCORD_LIVE_ADAPTER_ROUTES (players/link,
  // players/unlink, players/me, players/inventory, players/inventory-search,
  // players/storage, players/find, guilds/storage, guilds/find,
  // players/accounts/link-steam) at upstream tag v1.3.79.
  "players-link", "players-unlink", "players-me", "players-inventory",
  "players-inventory-search", "players-storage", "players-find",
  "guild-storage", "guild-find", "players-accounts-link-steam",
  // FOURTH reconciliation (2026-08-08): ops-inventory, ops-soc,
  // ops-prometheus, and ops-dashboard were PLANNED but Core returns
  // real data. Moved to LIVE. LOGS, MAP_STATE, and MAINTENANCE
  // handlers implemented on Core (#211, #213). Broadcast enabled
  // via DUNE_DISCORD_WRITES_ENABLED env var (#214).
  "broadcast",
  "ops-inventory", "ops-soc", "ops-prometheus", "ops-dashboard"
]);

// Routes that exist in upstream but return "planned" stubs or placeholder data.
export const PLANNED_ROUTES = new Set([
  "backups", "announcements",
  "ops-location"
]);

// Routes implemented in feature/discord-player-inventory but NOT yet in upstream main.
//
// Reconciled against Core's real DISCORD_LIVE_ADAPTER_ROUTES 2026-07-26
// (dune-awakening-selfhost-docker#130/FINDING-LINK-7 merge). This set had
// drifted stale in BOTH directions: several routes below (players-link,
// players-unlink, players-me, players-inventory, players-inventory-search,
// players-storage, players-find, guild-storage, guild-find) had actually
// been live on Core since the discord-player-link-hardening work
// (2026-07-22) but were never removed from here; players-accounts-link-steam
// went live in the same PR that removed players-accounts-match-steam
// entirely (see adapterClient.linkAccountViaSteam()'s own comment for why
// there is no separate match-only route); and players-link-verify had no
// corresponding config.js path/method entry at all, an orphaned key
// independent of Core's state (fixed alongside this cleanup). See
// arrakis-control-panel#86 for the full reconciliation.
//
// SECOND reconciliation (2026-07-27, found via a real live production
// error): players-link-verify, players-accounts-list, and
// players-accounts-unlink were moved OUT of this set -- all three are
// real, live routes on Core (playerLinkVerify()/playerAccountsList()/
// playerAccountsUnlink() in adapterClient.js now call them directly).
// player-links, player-links-unlink were removed from this set entirely
// (no method calls those route keys anymore -- see
// playerAccountsList()/playerAccountsUnlink()'s own comment for the full
// player-links/* vs. players/accounts/* distinction). player-links-verify
// is ALSO removed since nothing calls that route key anymore either
// (playerLinkVerify() now calls players-link-verify, the real V1 route).
// player-links-start remains -- it is still genuinely absent from Core,
// and still genuinely unreachable dead code (see playerLinkStart()'s own
// comment) -- listing it here is accurate but currently has no live
// effect on any real command.
//
// Routes still genuinely absent from Core, confirmed by direct grep of
// DISCORD_ADAPTER_ROUTES: players-faction, player-links-start (see above),
// the guild-character-grants/* family, and player-inventory-v2 (Core only
// has the plural, non-versioned players/inventory).
export const UNMERGED_ROUTES = new Set([
  "players-faction",
  "player-links-start",
  "guild-grants", "guild-grants-enable", "guild-grants-disable", "guild-grants-default",
  "player-inventory-v2"
]);

// Routes that do NOT exist anywhere.
//
// write-execute/write-preview: the write-command group's routes, still
// unbuilt on Core (the bot's write group stays disabled until they land).
//
// Added 2026-08-06 (RO roadmap audit, all verified by direct grep of Core
// at upstream tag v1.3.79):
// - maintenance: Core DECLARES the MAINTENANCE route constant
//   (/api/integrations/discord/maintenance) but never registers it in
//   DISCORD_LIVE_ADAPTER_ROUTES and routes.js has no handler for it --
//   every call 404s ("Discord adapter route not found"). /dune server
//   maintenance therefore fails in production; tracked in
//   docs/ro-roadmap-state-2026-08-06.md.
// - player-links, player-links-verify, player-links-unlink: the never-built
//   player-links/* path family. Core has no such routes (only
//   player-links/start exists, and even that is UNMERGED/dead), and NO
//   adapterClient.js method calls any of these three keys -- they survive
//   only as config.js path/method entries. Listed here so routeStatus()
//   reports "missing" rather than "unknown" for dead config keys; the
//   config entries themselves are candidates for removal (see the audit doc).
export const MISSING_ROUTES = new Set([
  "write-execute", "write-preview",
  "maintenance",
  "player-links", "player-links-verify", "player-links-unlink"
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
  // VERIFIED 2026-08-06: Core declares the MAINTENANCE route constant
  // (/api/integrations/discord/maintenance) but never registers it in
  // DISCORD_LIVE_ADAPTER_ROUTES and routes.js has no handler -- every call
  // 404s. Classified MISSING_ROUTES so callers surface that honestly
  // instead of assuming success. /dune server maintenance fails in
  // production until Core actually implements this route.
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
  // FIX (2026-07-27, found via a real live production error: /dune player
  // unlink <character> failed with "player links unlink is implemented in
  // feature/discord-player-inventory but not yet merged" -- /dune player
  // verify and /dune player characters were separately broken the same
  // way). This method used to be entirely absent (see the removed comment
  // above, previously describing V1 verify as superseded dead code): every
  // caller instead used playerLinkVerify() below, which called the
  // "player-links-verify" route -- a route that has NEVER existed on Core
  // at all (confirmed via direct grep of Core's real DISCORD_ADAPTER_ROUTES
  // constant). Core's real, live, working verify route is
  // PLAYERS_LINK_VERIFY (/players/link/verify), already correctly mapped
  // in config.js as "players-link-verify" -- it just had no method calling
  // it. This method now calls that real route directly; playerLinkVerify()
  // below is REMOVED (was pure dead-end code calling a route Core never
  // implemented), and commands.js's /dune player verify now calls this
  // method instead.
  playerLinkVerify(actor, code, guildId) { return this.request("players-link-verify", actor, { code }, guildId); }
  playerUnlink(actor, guildId) { return this.request("players-unlink", actor, undefined, guildId); }
  whoami(actor, guildId) { return this.request("players-me", actor, undefined, guildId); }
  playerFaction(actor, faction, guildId) { return this.request("players-faction", actor, { faction }, guildId); }
  playerInventory(actor, guildId) { return this.request("players-inventory", actor, undefined, guildId); }
  playerInventorySearch(actor, query, guildId) { return this.request("players-inventory-search", actor, { query }, guildId); }
  playerStorage(actor, scope, guildId) { return this.request("players-storage", actor, { scope }, guildId); }
  playerFind(actor, query, scope, guildId) { return this.request("players-find", actor, { query, scope }, guildId); }
  guildStorage(actor, guildId) { return this.request("guild-storage", actor, undefined, guildId); }
  guildFind(actor, query, guildId) { return this.request("guild-find", actor, { query }, guildId); }

  // playerLinkStart() is genuinely dead code -- no command path calls it
  // (confirmed via direct grep; commands.js explicitly documents calling
  // playerLink(), not this, at its one relevant call site). Left in place
  // unchanged: it calls "player-links-start", a route that has never
  // existed on Core, same as playerLinkVerify()/playerLinks()/
  // playerUnlinkV2() below used to -- but since nothing calls it, it was
  // out of scope for this fix (2026-07-27), which only touched methods
  // with a real, reachable, currently-broken command path.
  playerLinkStart(actor, characterName, guildId) { return this.request("player-links-start", actor, { characterName }, guildId); }

  // FIX (2026-07-27, found via a real live production error: /dune player
  // unlink <character> failed with "player links unlink is implemented in
  // feature/discord-player-inventory but not yet merged", and /dune player
  // characters was separately broken the same way). Both methods called a
  // path family (player-links/*) that has never existed on Core at all --
  // confirmed via direct grep of Core's real DISCORD_ADAPTER_ROUTES
  // constant, which instead has PLAYERS_ACCOUNTS_LIST
  // (/players/accounts/list) and PLAYERS_ACCOUNTS_UNLINK
  // (/players/accounts/unlink), both live and fully implemented
  // (listAccountsProvider()/unlinkAccountProvider() in
  // multiAccountLinkProvider.js) all along. Renamed to playerAccountsList()/
  // playerAccountsUnlink() to match Core's real players/accounts/*
  // terminology (not player-links/*, a naming convention that was never
  // actually built) and repointed to the real routes. unlinkAccountProvider()
  // requires playerControllerId, not an arbitrary characterLinkId --
  // commands.js's /dune player unlink <character> option now expects the
  // real playerControllerId (obtainable via the newly-working
  // /dune player characters, which surfaces it per account).
  playerAccountsList(actor, guildId) { return this.request("players-accounts-list", actor, undefined, guildId); }
  playerAccountsUnlink(actor, playerControllerId, guildId) { return this.request("players-accounts-unlink", actor, { playerControllerId }, guildId); }
  guildGrantsEnable(actor, characterLinkId, guildId) { return this.request("guild-grants-enable", actor, { characterLinkId }, guildId); }
  guildGrantsDisable(actor, characterLinkId, guildId) { return this.request("guild-grants-disable", actor, { characterLinkId }, guildId); }
  guildGrantsDefault(actor, characterLinkId, guildId) { return this.request("guild-grants-default", actor, { characterLinkId }, guildId); }
  playerInventoryV2(actor, characterHandle, guildId) { return this.request("player-inventory-v2", actor, { characterHandle }, guildId); }

  // Steam-connections-based verification for the ALREADY-NAMED character
  // from /dune player link <character-name> — see
  // docs/steam-link-architecture.md. Reuses the existing self-scoped
  // ACCOUNT_LINK_WRITE capability on the Core side; no new capability or
  // bearer-auth mechanism is introduced.
  //
  // ONE call, not two: an earlier draft of this feature planned a
  // separate matchSteamCandidate() route (checking whether
  // playerControllerId's on-file Steam ID appears in steamId64List) ahead
  // of a separate link call. A pre-implementation security review of
  // Core's actual implementation (dune-awakening-selfhost-docker#130,
  // FINDING-LINK-7) found that shape would have created a
  // character-enumeration oracle -- a route with no discordUserId binding,
  // gated only by capability tier, letting any authorized actor probe an
  // arbitrary character they don't own for a Steam-ID match. Core's real
  // linkAccountViaSteamProvider() folds the match check and the link into
  // ONE actor-bound call instead: it returns { ok: false, matched: false }
  // for a genuine non-match (not an error -- the caller falls back to the
  // whisper flow), or { ok: true, matched: true, accounts } on success, or
  // throws a 409 character_already_linked conflict. There is no
  // standalone match-only route on Core to call.
  linkAccountViaSteam(actor, playerControllerId, steamId64List, guildId) { return this.request("players-accounts-link-steam", actor, { playerControllerId, steamId64List }, guildId); }

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
        // signedHeaders() no-ops (returns {}) unless
        // DUNE_DISCORD_ACTOR_SECRET/_FILE is configured -- fully backward
        // compatible with every deployment that hasn't opted in yet.
        // `path` (the full adapter URL path), not `route` (this client's
        // internal key), MUST be what's signed -- Core's routes.js signs
        // against the exact request path, not an internal identifier this
        // bot invented. See actorSignature.js's own comment for why a
        // mismatch here would make every signed request fail verification.
        Object.assign(headers, signedHeaders(actor, path));
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
    return { ok: false, error: `Unexpected response format (${contentType || "unknown content-type"}). Expected JSON.` };
  }
}

function ensureTrailingSlash(value) {
  return value.endsWith("/") ? value : `${value}/`;
}
