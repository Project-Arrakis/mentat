export const OPS_COMMANDS = Object.freeze({
  activity: {
    route: "ops-activity",
    path: "/api/integrations/discord/ops/activity",
    method: "POST",
    description: "Show player activity statistics (online counts, sessions, per-guild, per-map)."
  },
  combat: {
    route: "ops-combat",
    path: "/api/integrations/discord/ops/combat",
    method: "POST",
    description: "Show combat and death statistics (PvP/PvE, deaths by cause, K/D)."
  },
  resources: {
    route: "ops-resources",
    path: "/api/integrations/discord/ops/resources",
    method: "POST",
    description: "Show resource field statistics (spice, water, minerals, solar, organic)."
  },
  economy: {
    route: "ops-economy",
    path: "/api/integrations/discord/ops/economy",
    method: "POST",
    description: "Show economy statistics (currency, orders, taxes)."
  },
  // Renamed from "inventory" to "armory" (2026-07-26) after real user
  // confusion with /dune player inventory -- the two commands sound
  // identical but return completely different data: this one counts
  // every item across every container on the whole server, grouped by
  // item template, top 50 by count (see addonOpsInventorySummary() in
  // Core's duneDb.js) -- it is NOT a per-player view. "armory" was
  // chosen over a more literal alternative (e.g. "items") to match this
  // group's existing Dune-thematic naming style (activity, combat,
  // resources, economy) while still being unambiguous with player
  // inventory. The route/path (ops-inventory,
  // /api/integrations/discord/ops/inventory) are unchanged -- only the
  // user-facing Discord subcommand name changed; there is no
  // corresponding rename needed on the Core side.
  armory: {
    route: "ops-inventory",
    path: "/api/integrations/discord/ops/inventory",
    method: "POST",
    description: "Show server-wide aggregate inventory/crafting stats (not personal -- see /dune player inventory)."
  },
  location: {
    route: "ops-location",
    path: "/api/integrations/discord/ops/location",
    method: "POST",
    description: "Show map location activity (markers, density, territories)."
  },
  soc: {
    route: "ops-soc",
    path: "/api/integrations/discord/ops/soc",
    method: "POST",
    description: "Show OPS bridge health and request statistics."
  },
  prometheus: {
    route: "ops-prometheus",
    path: "/api/integrations/discord/ops/prometheus",
    method: "POST",
    description: "Show container and infrastructure metrics (CPU, memory, restarts)."
  },
  dashboard: {
    route: "ops-dashboard",
    path: "/api/integrations/discord/ops/dashboard",
    method: "POST",
    description: "Show aggregated operational dashboard summary."
  },
  // NOTE: this subcommand deliberately does NOT follow the ops-<name>
  // route pattern. There is no /ops/announcements route on Core (verified
  // upstream 2026-08-06) -- the real route is the top-level
  // /api/integrations/discord/announcements. Using the real route also
  // makes the dispatch derive the method name "announcements" (which
  // exists on AdapterClient) instead of "opsAnnouncements" (which only
  // ever existed in the test mock and would TypeError in production).
  announcements: {
    route: "announcements",
    path: "/api/integrations/discord/announcements",
    method: "POST",
    description: "Show recent server and game announcements."
  },
  alerts: {
    route: "ops-alerts",
    path: "/api/v1/alerts",
    method: "GET",
    description: "Show currently firing Prometheus/Alertmanager alerts (queries Prometheus directly)."
  }
});

export const OPS_SUBCOMMAND_NAMES = Object.freeze(Object.keys(OPS_COMMANDS));

export function opsRouteFor(subcommand) {
  return OPS_COMMANDS[subcommand]?.route || null;
}

export function opsPathFor(subcommand) {
  return OPS_COMMANDS[subcommand]?.path || null;
}

export function opsMethodFor(subcommand) {
  return OPS_COMMANDS[subcommand]?.method || "POST";
}

export function opsDescriptionFor(subcommand) {
  return OPS_COMMANDS[subcommand]?.description || "Show operational data.";
}

export function formatOpsPayload(subcommand, rawPayload) {
  const result = rawPayload?.result || rawPayload || {};
  return {
    ok: rawPayload?.ok !== false,
    command: subcommand,
    ...sanitizeOpsResult(result)
  };
}

function sanitizeOpsResult(result) {
  if (!result || typeof result !== "object") return { value: result };
  if (Array.isArray(result)) return result;
  const safe = {};
  for (const [key, value] of Object.entries(result)) {
    if (BLOCKED_OPS_KEYS.has(key)) continue;
    if (typeof value === "object" && value !== null) {
      safe[key] = sanitizeOpsResult(value);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

const BLOCKED_OPS_KEYS = new Set([
  "ssh_host", "sshHost", "databaseUrl", "dbUrl", "adminPassword",
  "token", "password", "secret", "funcomToken", "env", "environment",
  "host", "ip", "url", "path"
]);
