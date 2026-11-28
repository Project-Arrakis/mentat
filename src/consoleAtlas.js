// consoleAtlas.js -- #the-atlas built from a Console's own API, for Consoles
// whose Discord adapter has no atlas route.
//
// Opt-in (config.atlasConsole, see config.js and docs/configuration.md).
// Rules this module keeps:
//  - the Console API key goes only to the one configured address, never to a
//    per-guild address from the database, and never along a redirect;
//  - AdapterClient uses it for the one configured Discord server only;
//  - it reads two kinds of page, both covered by the key's "Maps: read"
//    permission, and copies out only the fields #the-atlas shows;
//  - its errors carry the page and the HTTP status, never request headers or
//    response bodies.
//
// A Console has no page for live sandstorm status, so the result says that it
// is unavailable instead of reporting calm weather.

import { AdapterHttpError } from "./adapterErrors.js";
import { logError } from "./logger.js";

// These pages can take the Console longer to answer than the adapter's usual
// request timeout allows.
const MIN_TIMEOUT_MS = 20_000;

// Repeated commands share one answer for this long, so they cannot use up the
// key's request limit and make the channel refresh fail.
const CACHE_MS = 60_000;

export function createConsoleAtlas(
  { baseUrl, apiKey, guildId },
  {
    fetchImpl = globalThis.fetch,
    dispatcher,
    timeoutMs = 0,
    now = Date.now,
    onWarning = (error) => logError("atlas.coriolis.unavailable", error)
  } = {}
) {
  const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const limitMs = Math.max(timeoutMs, MIN_TIMEOUT_MS);

  async function get(page, map) {
    const url = new URL(page, root);
    url.searchParams.set("map", map);
    let response;
    try {
      response = await fetchImpl(url, {
        method: "GET",
        headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
        redirect: "error",
        signal: AbortSignal.timeout(limitMs),
        dispatcher
      });
      if (response.ok) return await response.json();
    } catch (error) {
      throw new Error(`Console atlas request /${page} failed (${failureReason(error)}).`);
    }
    await response.body?.cancel?.().catch(() => {});
    throw new AdapterHttpError(`Console atlas request /${page} returned HTTP ${response.status}.`, {
      status: response.status,
      route: "atlas"
    });
  }

  // A failure here throws, so the refresher keeps the last good message
  // rather than replacing it with an empty one.
  async function sietches(map) {
    const body = await get("api/maps/combat-state", map);
    // The Console answers 200 with a reason and no partitions when it cannot
    // read its database tables.
    if (!Array.isArray(body?.partitions) || (body.reason && body.partitions.length === 0)) {
      throw new Error(`Console atlas: the Console returned no partition list for ${map}.`);
    }
    return body.partitions.map((partition) => ({
      partitionId: String(partition?.partitionId ?? ""),
      serverDisplayName: partition?.serverDisplayName || null,
      runtimeStatus: partition?.runtimeStatus || "UNKNOWN",
      combatState: partition?.configuredState || "UNKNOWN"
    }));
  }

  // The weekly cycle is one line of the message: losing it must not stop the
  // sietch list from updating.
  async function coriolisCycle() {
    try {
      const body = await get("api/map/spice", "HaggaBasin");
      return { coriolisSeed: body?.currentSeed || null, coriolisNextCycleAt: body?.nextCycleAt || null };
    } catch (error) {
      onWarning(error);
      return { coriolisSeed: null, coriolisNextCycleAt: null };
    }
  }

  async function load() {
    const [cycle, haggaBasin, deepDesert] = await Promise.all([
      coriolisCycle(),
      sietches("Survival_1"),
      sietches("DeepDesert_1")
    ]);
    return {
      ok: true,
      sandstormAvailable: false,
      ...cycle,
      sietches: { HaggaBasin: haggaBasin, DeepDesert: deepDesert }
    };
  }

  let cached = null;
  return {
    guildId,
    fetchAtlas() {
      if (cached && now() - cached.at < CACHE_MS) return cached.result;
      const entry = { at: now(), result: load() };
      cached = entry;
      // A failure is not kept: the next call tries again.
      entry.result.catch(() => { if (cached === entry) cached = null; });
      return entry.result;
    }
  };
}

function failureReason(error) {
  if (error?.name === "TimeoutError") return "timed out";
  return error?.cause?.code || error?.cause?.message || error?.name || "unknown error";
}
