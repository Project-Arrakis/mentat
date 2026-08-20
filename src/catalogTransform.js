/**
 * Shared Catalog Transform
 *
 * Converts Core's raw /api/integrations/discord/catalog response into the
 * bot's internal, flat registry shape used by:
 *   - scripts/generate-command-registry.js (Phase 2, offline generation,
 *     produces the committed src/commands-registry.json artifact)
 *   - src/registryLoader.js's refreshRegistryFromCore() (Phase 3, runtime
 *     /dune admin sync-commands refresh)
 *
 * BUG FIX (2026-08-20, found via live E2E testing against real, reachable
 * Core at console.darkdante.org -- neither the generator nor the runtime
 * refresh path had EVER been exercised against a real Core response
 * before this): Core's real /catalog response has TWO structural layers
 * neither implementation accounted for:
 *
 *   1. RESPONSE ENVELOPE: the HTTP response body is
 *      { ok, protocolVersion, catalog: { version, groups } } -- the
 *      actual catalog is nested under `.catalog`, not at the top level.
 *      registryLoader.js's refreshRegistryFromCore() was passing the
 *      whole envelope into validateRegistry(), which correctly rejected
 *      it ("Registry.groups must be an array") since `.groups` doesn't
 *      exist at that level.
 *
 *   2. SUBCOMMAND SHAPE (CATALOG_VERSION 2): each subcommand is
 *      { name, routes: [{ description, route, capability, minTier,
 *      method, params, ... }, ...] } -- NOT the flat
 *      { name, description, route, capability, ... } shape both
 *      generate-command-registry.js and every existing test's mock
 *      catalog assumed. The "support CATALOG_VERSION 2" commit
 *      (807457a) added *preservation* of v2-only fields (routes,
 *      method, selector, routeEnforcesCapability) as if they sat
 *      ALONGSIDE the v1 flat fields on the same subcommand object, when
 *      real v2 actually moves ALL per-route fields (including
 *      description/route/capability/minTier/params) inside routes[].
 *      That commit shipped with zero new tests against the real shape,
 *      and every existing test's mockCatalog stayed on the old flat v1
 *      shape -- so this was never caught until a real Core round-trip.
 *
 * flattenSubcommand() below is the single, shared fix for #2: it merges
 * every entry in routes[] into one flat descriptor (first route's
 * description/method/capability/minTier as primary, union of params
 * across all routes, full original routes[] preserved as
 * `routes` for any future consumer -- e.g. commands.js's existing
 * hand-written multi-route selector logic for player:inventory/
 * storage/find -- that needs per-route detail rather than the
 * flattened summary).
 */

/**
 * Unwrap Core's response envelope, if present.
 * Real Core: { ok, protocolVersion, catalog: { version, groups } }
 * Some historical mocks/fixtures (and Phase 2's own original test
 * mocks): the bare { version, groups } shape, with no envelope at all.
 * Accept both so this doesn't re-break the moment envelope conventions
 * shift again -- only the OUTER shape is optional; the inner
 * { version, groups } shape is still required by validateRegistry().
 */
export function unwrapCatalogEnvelope(response) {
  if (!response || typeof response !== "object") return response;
  if (response.catalog && typeof response.catalog === "object") {
    return response.catalog;
  }
  return response;
}

/**
 * Flatten one v2 subcommand's routes[] into a single flat descriptor.
 * v1 subcommands (flat description/route/capability already on the
 * subcommand, no routes[] array) pass through unchanged -- this is a
 * no-op for genuinely v1 catalogs.
 */
export function flattenSubcommand(sc) {
  if (!sc || !Array.isArray(sc.routes) || sc.routes.length === 0) {
    // v1 shape (or malformed) -- return as-is, let validateRegistry()
    // catch anything actually broken.
    return sc;
  }

  const [primary, ...rest] = sc.routes;

  // Union of params across all routes, de-duplicated by name. Multiple
  // routes can define the same param (e.g. player:inventory's `search`
  // only exists on the -search route) -- last-wins is fine since the
  // flattened descriptor is used for display/registration, not routing;
  // actual per-route routing/param mapping still uses the full `routes`
  // array preserved below (see commands.js's existing selector-based
  // dispatch for player:inventory/storage/find).
  const paramsByName = new Map();
  for (const route of sc.routes) {
    for (const param of (route.params || [])) {
      if (param?.name) paramsByName.set(param.name, param);
    }
  }

  return {
    name: sc.name,
    description: primary.description,
    route: primary.route,
    capability: primary.capability,
    minTier: primary.minTier,
    method: primary.method,
    params: [...paramsByName.values()],
    routeEnforcesCapability: primary.routeEnforcesCapability !== false,
    requiresWritesEnabled: sc.routes.some((r) => r.requiresWritesEnabled === true),
    // Full per-route detail, preserved for any consumer that needs it
    // (multi-route selector dispatch, diagnostics, etc.) -- NOT used by
    // validateRegistry()/Discord registration, which only look at the
    // flattened fields above.
    routes: sc.routes
  };
}

/**
 * Full transform: Core's raw catalog response (envelope + v2 nested
 * routes[]) -> the bot's flat internal shape
 * ({ version, groups: [{ name, subcommands: [{ name, description,
 * route, capability, minTier, params, ... }] }] }).
 *
 * Idempotent-ish on v1 input: unwrapCatalogEnvelope() and
 * flattenSubcommand() are both no-ops for already-flat v1 catalogs, so
 * this is safe to call unconditionally regardless of which version Core
 * actually returns.
 */
export function transformCatalogToRegistry(rawResponse) {
  const catalog = unwrapCatalogEnvelope(rawResponse);

  if (!catalog || typeof catalog !== "object") {
    throw new Error("Catalog response is not an object");
  }
  if (!Array.isArray(catalog.groups)) {
    throw new Error("Catalog missing groups array");
  }

  return {
    version: catalog.version,
    groups: catalog.groups.map((group) => ({
      name: group.name,
      subcommands: (group.subcommands || []).map(flattenSubcommand)
    }))
  };
}

/**
 * Apply bot-side overrides (src/commandOverrides.json's exclude/rename/
 * retier) to an already-flattened registry (post-transformCatalogToRegistry()).
 *
 * Shared between scripts/generate-command-registry.js (Phase 2 offline
 * generation) and registryLoader.js's refreshRegistryFromCore() (Phase 3
 * runtime sync) -- previously generate-command-registry.js had its own
 * copy of this logic and the runtime refresh path had none at all,
 * meaning /dune admin sync-commands would silently regress any excluded/
 * renamed/retiered commands back to Core's raw names/tiers on every
 * refresh, diverging from the committed artifact. One implementation,
 * used both places, fixes that.
 *
 * Override keys are `${group.name}-${subcommand.name}` (Core's original
 * names, before any rename is applied) -- matches the existing
 * convention in src/commandOverrides.json (e.g. "ops-inventory",
 * "guild-character-grants-enable").
 */
export function applyCommandOverrides(registry, overrides = {}) {
  const excluded = new Set(overrides?.exclude || []);
  const renames = overrides?.rename || {};
  const retiers = overrides?.retier || {};

  const groups = [];

  for (const group of registry.groups) {
    const filteredSubcommands = (group.subcommands || [])
      .filter((sc) => !excluded.has(`${group.name}-${sc.name}`))
      .map((sc) => {
        const key = `${group.name}-${sc.name}`;
        const rename = renames[key] || {};
        const retier = retiers[key];

        return {
          ...sc,
          name: rename.subcommand || sc.name,
          minTier: retier || sc.minTier
        };
      });

    if (filteredSubcommands.length > 0) {
      if (filteredSubcommands.length > 25) {
        throw new Error(`Group "${group.name}" has ${filteredSubcommands.length} subcommands, exceeds Discord's 25-subcommand limit.`);
      }
      groups.push({ name: group.name, subcommands: filteredSubcommands });
    }
  }

  return { version: registry.version, groups };
}
