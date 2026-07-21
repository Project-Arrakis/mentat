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
  inventory: {
    route: "ops-inventory",
    path: "/api/integrations/discord/ops/inventory",
    method: "POST",
    description: "Show inventory and crafting statistics."
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
  announcements: {
    route: "ops-announcements",
    path: "/api/integrations/discord/ops/announcements",
    method: "POST",
    description: "Show recent server and game announcements."
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
