import { readFileSync } from "node:fs";

const DEFAULT_PATHS = Object.freeze({
  health: "/api/integrations/discord/health",
  status: "/api/integrations/discord/status",
  readiness: "/api/integrations/discord/readiness",
  services: "/api/integrations/discord/services",
  population: "/api/integrations/discord/population",
  backups: "/api/integrations/discord/backups/list",
  announcements: "/api/integrations/discord/announcements",
  broadcast: "/api/integrations/discord/broadcast",
  version: "/api/integrations/discord/version",
  servers: "/api/integrations/discord/servers",
  ports: "/api/integrations/discord/ports",
  db: "/api/integrations/discord/db",
  "write-execute": "/api/integrations/discord/write/execute",
  "write-preview": "/api/integrations/discord/write/preview",
  "ops-activity": "/api/integrations/discord/ops/activity",
  "ops-combat": "/api/integrations/discord/ops/combat",
  "ops-resources": "/api/integrations/discord/ops/resources",
  "ops-economy": "/api/integrations/discord/ops/economy",
  "ops-inventory": "/api/integrations/discord/ops/inventory",
  "ops-location": "/api/integrations/discord/ops/location",
  "ops-soc": "/api/integrations/discord/ops/soc",
  "ops-prometheus": "/api/integrations/discord/ops/prometheus",
  "ops-dashboard": "/api/integrations/discord/ops/dashboard"
});

const DEFAULT_METHODS = Object.freeze({
  health: "GET",
  status: "POST",
  readiness: "POST",
  services: "POST",
  population: "POST",
  backups: "GET",
  announcements: "POST",
  broadcast: "POST",
  version: "GET",
  servers: "POST",
  ports: "POST",
  db: "POST",
  "write-execute": "POST",
  "write-preview": "POST",
  "ops-activity": "POST",
  "ops-combat": "POST",
  "ops-resources": "POST",
  "ops-economy": "POST",
  "ops-inventory": "POST",
  "ops-location": "POST",
  "ops-soc": "POST",
  "ops-prometheus": "POST",
  "ops-dashboard": "POST"
});

const RBAC_MODES = new Set(["restricted", "open"]);

export function loadConfig(env = process.env) {
  const legacyAllowedRoleIds = parseCsv(env.DISCORD_ALLOWED_ROLE_IDS);
  const observerRoleIds = mergeRoleIds(parseCsv(env.DISCORD_OBSERVER_ROLE_IDS), legacyAllowedRoleIds);
  const adminRoleIds = parseCsv(env.DISCORD_ADMIN_ROLE_IDS);
  const config = {
    discord: {
      token: readSecret(env, "DISCORD_BOT_TOKEN", "DISCORD_BOT_TOKEN_FILE"),
      clientId: requiredEnv(env, "DISCORD_CLIENT_ID"),
      guildId: optionalEnv(env, "DISCORD_GUILD_ID"),
      defaultEphemeral: parseBoolean(env.DISCORD_DEFAULT_EPHEMERAL, true),
      rbac: {
        mode: parseRbacMode(env.DISCORD_RBAC_MODE),
        allowedUserIds: parseCsv(env.DISCORD_ALLOWED_USER_IDS),
        adminRoleIds,
        observerRoleIds,
        commandRoleIds: {
          health: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_HEALTH_ROLE_IDS)),
          about: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_ABOUT_ROLE_IDS)),
          ping: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_PING_ROLE_IDS)),
          status: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_STATUS_ROLE_IDS)),
          "status-summary": mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_STATUS_SUMMARY_ROLE_IDS)),
          readiness: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_READINESS_ROLE_IDS)),
          services: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_SERVICES_ROLE_IDS)),
          population: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_POPULATION_ROLE_IDS)),
          backups: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_BACKUPS_ROLE_IDS))
        }
      }
    },
    adapter: {
      baseUrl: requiredEnv(env, "DUNE_CONSOLE_API_URL"),
      token: readSecret(env, "DUNE_DISCORD_ADAPTER_TOKEN", "DUNE_DISCORD_ADAPTER_TOKEN_FILE"),
      timeoutMs: parsePositiveInteger(env.REQUEST_TIMEOUT_MS, 8000),
      paths: {
        health: optionalEnv(env, "DUNE_ADAPTER_HEALTH_PATH") || DEFAULT_PATHS.health,
        status: optionalEnv(env, "DUNE_ADAPTER_STATUS_PATH") || DEFAULT_PATHS.status,
        readiness: optionalEnv(env, "DUNE_ADAPTER_READINESS_PATH") || DEFAULT_PATHS.readiness,
        services: optionalEnv(env, "DUNE_ADAPTER_SERVICES_PATH") || DEFAULT_PATHS.services,
        population: optionalEnv(env, "DUNE_ADAPTER_POPULATION_PATH") || DEFAULT_PATHS.population,
        backups: optionalEnv(env, "DUNE_ADAPTER_BACKUPS_PATH") || DEFAULT_PATHS.backups,
        announcements: optionalEnv(env, "DUNE_ADAPTER_ANNOUNCEMENTS_PATH") || DEFAULT_PATHS.announcements,
        broadcast: optionalEnv(env, "DUNE_ADAPTER_BROADCAST_PATH") || DEFAULT_PATHS.broadcast,
        version: optionalEnv(env, "DUNE_ADAPTER_VERSION_PATH") || DEFAULT_PATHS.version,
        servers: optionalEnv(env, "DUNE_ADAPTER_SERVERS_PATH") || DEFAULT_PATHS.servers,
        ports: optionalEnv(env, "DUNE_ADAPTER_PORTS_PATH") || DEFAULT_PATHS.ports,
        db: optionalEnv(env, "DUNE_ADAPTER_DB_PATH") || DEFAULT_PATHS.db,
        "write-execute": optionalEnv(env, "DUNE_ADAPTER_WRITE_EXECUTE_PATH") || DEFAULT_PATHS["write-execute"],
        "write-preview": optionalEnv(env, "DUNE_ADAPTER_WRITE_PREVIEW_PATH") || DEFAULT_PATHS["write-preview"],
        "ops-activity": optionalEnv(env, "DUNE_ADAPTER_OPS_ACTIVITY_PATH") || DEFAULT_PATHS["ops-activity"],
        "ops-combat": optionalEnv(env, "DUNE_ADAPTER_OPS_COMBAT_PATH") || DEFAULT_PATHS["ops-combat"],
        "ops-resources": optionalEnv(env, "DUNE_ADAPTER_OPS_RESOURCES_PATH") || DEFAULT_PATHS["ops-resources"],
        "ops-economy": optionalEnv(env, "DUNE_ADAPTER_OPS_ECONOMY_PATH") || DEFAULT_PATHS["ops-economy"],
        "ops-inventory": optionalEnv(env, "DUNE_ADAPTER_OPS_INVENTORY_PATH") || DEFAULT_PATHS["ops-inventory"],
        "ops-location": optionalEnv(env, "DUNE_ADAPTER_OPS_LOCATION_PATH") || DEFAULT_PATHS["ops-location"],
        "ops-soc": optionalEnv(env, "DUNE_ADAPTER_OPS_SOC_PATH") || DEFAULT_PATHS["ops-soc"],
        "ops-prometheus": optionalEnv(env, "DUNE_ADAPTER_OPS_PROMETHEUS_PATH") || DEFAULT_PATHS["ops-prometheus"],
        "ops-dashboard": optionalEnv(env, "DUNE_ADAPTER_OPS_DASHBOARD_PATH") || DEFAULT_PATHS["ops-dashboard"]
      },
      methods: {
        health: parseMethod(env.DUNE_ADAPTER_HEALTH_METHOD, DEFAULT_METHODS.health),
        status: parseMethod(env.DUNE_ADAPTER_STATUS_METHOD, DEFAULT_METHODS.status),
        readiness: parseMethod(env.DUNE_ADAPTER_READINESS_METHOD, DEFAULT_METHODS.readiness),
        services: parseMethod(env.DUNE_ADAPTER_SERVICES_METHOD, DEFAULT_METHODS.services),
        population: parseMethod(env.DUNE_ADAPTER_POPULATION_METHOD, DEFAULT_METHODS.population),
        backups: parseMethod(env.DUNE_ADAPTER_BACKUPS_METHOD, DEFAULT_METHODS.backups),
        announcements: parseMethod(env.DUNE_ADAPTER_ANNOUNCEMENTS_METHOD, DEFAULT_METHODS.announcements),
        broadcast: parseMethod(env.DUNE_ADAPTER_BROADCAST_METHOD, DEFAULT_METHODS.broadcast),
        version: parseMethod(env.DUNE_ADAPTER_VERSION_METHOD, DEFAULT_METHODS.version),
        servers: parseMethod(env.DUNE_ADAPTER_SERVERS_METHOD, DEFAULT_METHODS.servers),
        ports: parseMethod(env.DUNE_ADAPTER_PORTS_METHOD, DEFAULT_METHODS.ports),
        db: parseMethod(env.DUNE_ADAPTER_DB_METHOD, DEFAULT_METHODS.db),
        "write-execute": parseMethod(env.DUNE_ADAPTER_WRITE_EXECUTE_METHOD, DEFAULT_METHODS["write-execute"]),
        "write-preview": parseMethod(env.DUNE_ADAPTER_WRITE_PREVIEW_METHOD, DEFAULT_METHODS["write-preview"]),
        "ops-activity": parseMethod(env.DUNE_ADAPTER_OPS_ACTIVITY_METHOD, DEFAULT_METHODS["ops-activity"]),
        "ops-combat": parseMethod(env.DUNE_ADAPTER_OPS_COMBAT_METHOD, DEFAULT_METHODS["ops-combat"]),
        "ops-resources": parseMethod(env.DUNE_ADAPTER_OPS_RESOURCES_METHOD, DEFAULT_METHODS["ops-resources"]),
        "ops-economy": parseMethod(env.DUNE_ADAPTER_OPS_ECONOMY_METHOD, DEFAULT_METHODS["ops-economy"]),
        "ops-inventory": parseMethod(env.DUNE_ADAPTER_OPS_INVENTORY_METHOD, DEFAULT_METHODS["ops-inventory"]),
        "ops-location": parseMethod(env.DUNE_ADAPTER_OPS_LOCATION_METHOD, DEFAULT_METHODS["ops-location"]),
        "ops-soc": parseMethod(env.DUNE_ADAPTER_OPS_SOC_METHOD, DEFAULT_METHODS["ops-soc"]),
        "ops-prometheus": parseMethod(env.DUNE_ADAPTER_OPS_PROMETHEUS_METHOD, DEFAULT_METHODS["ops-prometheus"]),
        "ops-dashboard": parseMethod(env.DUNE_ADAPTER_OPS_DASHBOARD_METHOD, DEFAULT_METHODS["ops-dashboard"])
      }
    }
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  const url = new URL(config.adapter.baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("DUNE_CONSOLE_API_URL must use http or https.");
  }

  for (const [name, path] of Object.entries(config.adapter.paths)) {
    if (!path.startsWith("/")) {
      throw new Error(`DUNE_ADAPTER_${name.toUpperCase()}_PATH must start with "/".`);
    }
  }

  for (const [name, method] of Object.entries(config.adapter.methods)) {
    if (!["GET", "POST"].includes(method)) {
      throw new Error(`DUNE_ADAPTER_${name.toUpperCase()}_METHOD must be GET or POST.`);
    }
  }

  if (config.discord.rbac.mode === "restricted" && !hasAnyRbacPrincipal(config.discord.rbac)) {
    throw new Error("Restricted RBAC requires at least one Discord role or user allow-list entry.");
  }

  return config;
}

function requiredEnv(env, name) {
  const value = optionalEnv(env, name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalEnv(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readSecret(env, valueName, fileName) {
  const directValue = optionalEnv(env, valueName);
  if (directValue) return directValue;

  const filePath = optionalEnv(env, fileName);
  if (!filePath) throw new Error(`Missing required environment variable: ${valueName} or ${fileName}`);
  const fileValue = readFileSync(filePath, "utf8").trim();
  if (!fileValue) throw new Error(`${fileName} points to an empty secret file.`);
  return fileValue;
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  if (/^(true|1|yes)$/i.test(value)) return true;
  if (/^(false|0|no)$/i.test(value)) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseRbacMode(value) {
  const mode = String(value || "restricted").trim().toLowerCase();
  if (!RBAC_MODES.has(mode)) throw new Error(`DISCORD_RBAC_MODE must be one of: ${[...RBAC_MODES].join(", ")}.`);
  return mode;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer value: ${value}`);
  return parsed;
}

function parseMethod(value, fallback) {
  return String(value || fallback).trim().toUpperCase();
}

function mergeRoleIds(...roleGroups) {
  return [...new Set(roleGroups.flat().filter(Boolean))];
}

function hasAnyRbacPrincipal(rbac) {
  return Boolean(
    rbac.allowedUserIds.length ||
    rbac.adminRoleIds.length ||
    rbac.observerRoleIds.length ||
    Object.values(rbac.commandRoleIds).some((roleIds) => roleIds.length)
  );
}
