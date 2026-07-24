import { readFileSync } from "node:fs";

const DEFAULT_PATHS = Object.freeze({
  health: "/api/integrations/discord/health",
  status: "/api/integrations/discord/status",
  readiness: "/api/integrations/discord/readiness",
  services: "/api/integrations/discord/services",
  population: "/api/integrations/discord/population",
  logs: "/api/integrations/discord/logs",
  "map-state": "/api/integrations/discord/map-state",
  maintenance: "/api/integrations/discord/maintenance",
  backups: "/api/integrations/discord/backups/list",
  announcements: "/api/integrations/discord/announcements",
  broadcast: "/api/integrations/discord/broadcast",
  version: "/api/integrations/discord/version",
  servers: "/api/integrations/discord/servers",
  ports: "/api/integrations/discord/ports",
  db: "/api/integrations/discord/db",
  "write-execute": "/api/integrations/discord/write/execute",
  "write-preview": "/api/integrations/discord/write/preview",
  "players-link": "/api/integrations/discord/players/link",
  "players-unlink": "/api/integrations/discord/players/unlink",
  "players-me": "/api/integrations/discord/players/me",
  "players-faction": "/api/integrations/discord/players/faction",
  "players-inventory": "/api/integrations/discord/players/inventory",
  "players-inventory-search": "/api/integrations/discord/players/inventory-search",
  "players-storage": "/api/integrations/discord/players/storage",
  "players-find": "/api/integrations/discord/players/find",
  "guild-storage": "/api/integrations/discord/guilds/storage",
  "guild-find": "/api/integrations/discord/guilds/find",
  "ops-activity": "/api/integrations/discord/ops/activity",
  "ops-combat": "/api/integrations/discord/ops/combat",
  "ops-resources": "/api/integrations/discord/ops/resources",
  "ops-economy": "/api/integrations/discord/ops/economy",
  "ops-inventory": "/api/integrations/discord/ops/inventory",
  "ops-location": "/api/integrations/discord/ops/location",
  "ops-soc": "/api/integrations/discord/ops/soc",
  "ops-prometheus": "/api/integrations/discord/ops/prometheus",
  "ops-dashboard": "/api/integrations/discord/ops/dashboard",
  "player-links-start": "/api/integrations/discord/player-links/start",
  "player-links-verify": "/api/integrations/discord/player-links/verify",
  "player-links": "/api/integrations/discord/player-links",
  "player-links-unlink": "/api/integrations/discord/player-links/unlink",
  "guild-grants": "/api/integrations/discord/guild-character-grants",
  "guild-grants-enable": "/api/integrations/discord/guild-character-grants/enable",
  "guild-grants-disable": "/api/integrations/discord/guild-character-grants/disable",
  "guild-grants-default": "/api/integrations/discord/guild-character-grants/default",
  "player-inventory-v2": "/api/integrations/discord/player/inventory",
  "players-accounts-resolve-steam": "/api/integrations/discord/players/accounts/resolve-steam",
  "players-accounts-link-steam": "/api/integrations/discord/players/accounts/link-steam"
});

const DEFAULT_METHODS = Object.freeze({
  health: "GET",
  status: "POST",
  readiness: "POST",
  services: "POST",
  population: "POST",
  logs: "POST",
  "map-state": "POST",
  maintenance: "POST",
  backups: "GET",
  announcements: "POST",
  broadcast: "POST",
  version: "GET",
  servers: "POST",
  ports: "POST",
  db: "POST",
  "write-execute": "POST",
  "write-preview": "POST",
  "players-link": "POST",
  "players-unlink": "POST",
  "players-me": "POST",
  "players-faction": "POST",
  "players-inventory": "POST",
  "players-inventory-search": "POST",
  "players-storage": "POST",
  "players-find": "POST",
  "guild-storage": "POST",
  "guild-find": "POST",
  "ops-activity": "POST",
  "ops-combat": "POST",
  "ops-resources": "POST",
  "ops-economy": "POST",
  "ops-inventory": "POST",
  "ops-location": "POST",
  "ops-soc": "POST",
  "ops-prometheus": "POST",
  "ops-dashboard": "POST",
  "player-links-start": "POST",
  "player-links-verify": "POST",
  "player-links": "GET",
  "player-links-unlink": "POST",
  "guild-grants": "GET",
  "guild-grants-enable": "POST",
  "guild-grants-disable": "POST",
  "guild-grants-default": "POST",
  "player-inventory-v2": "POST",
  "players-accounts-resolve-steam": "POST",
  "players-accounts-link-steam": "POST"
});

const RBAC_MODES = new Set(["restricted", "open"]);

export function loadConfig(env = process.env) {
  const legacyAllowedRoleIds = parseCsv(env.DISCORD_ALLOWED_ROLE_IDS);
  const observerRoleIds = mergeRoleIds(parseCsv(env.DISCORD_OBSERVER_ROLE_IDS), legacyAllowedRoleIds);
  const adminRoleIds = parseCsv(env.DISCORD_ADMIN_ROLE_IDS);
  const multiTenant = parseBoolean(env.ACP_MULTI_TENANT, false);
  const config = {
    multiTenant,
    dbPath: env.ACP_DB_PATH || "data/acp.db",
    baseUrl: optionalEnv(env, "ACP_BASE_URL") || "http://localhost:3100",
    setupPort: parsePositiveInteger(env.ACP_SETUP_PORT, 3100),
    oauthRedirectUri: optionalEnv(env, "ACP_OAUTH_REDIRECT_URI"),
    // steamLink: the /dune player link Steam-connections feature's own
    // small Express app (src/steamLinkServer.js), started unconditionally
    // regardless of multiTenant -- see docs/steam-link-architecture.md's Single-Tenant
    // Deployment Note for why this can't be gated behind multiTenant like
    // setupServer.js is. Port defaults differently (3101, not 3100) so both
    // servers can run simultaneously in multi-tenant mode without a
    // collision. enabled is computed from whether a client secret is
    // configured at all -- see the discord.clientSecret comment above.
    steamLink: {
      enabled: Boolean(
        optionalEnv(env, "DISCORD_CLIENT_SECRET") ||
        readOptionalSecretFile(env, "DISCORD_CLIENT_SECRET_FILE") ||
        multiTenant
      ),
      port: parsePositiveInteger(env.ACP_STEAM_LINK_PORT, 3101),
      baseUrl: optionalEnv(env, "ACP_STEAM_LINK_BASE_URL") || optionalEnv(env, "ACP_BASE_URL") || "http://localhost:3101"
    },
    discord: {
      token: readSecret(env, "DISCORD_BOT_TOKEN", "DISCORD_BOT_TOKEN_FILE"),
      clientId: requiredEnv(env, "DISCORD_CLIENT_ID"),
      // multiTenant mode has always required this secret (setupServer.js's
      // OAuth flow). Single-tenant mode never did until the Steam-link
      // feature -- and per docs/steam-link-security-review.md's
      // FINDING-STEAM-5, it must remain OPTIONAL there: the bot must start
      // and run normally with this unset, with only /dune player link's
      // Steam-connections flow (no character argument) refusing to work
      // (see config.steamLink.enabled below).
      clientSecret: multiTenant
        ? readSecret(env, "DISCORD_CLIENT_SECRET", "DISCORD_CLIENT_SECRET_FILE")
        : (optionalEnv(env, "DISCORD_CLIENT_SECRET") || readOptionalSecretFile(env, "DISCORD_CLIENT_SECRET_FILE")),
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
      baseUrl: multiTenant ? (optionalEnv(env, "DUNE_CONSOLE_API_URL") || "http://placeholder") : requiredEnv(env, "DUNE_CONSOLE_API_URL"),
      token: multiTenant ? (readSecret(env, "DUNE_DISCORD_ADAPTER_TOKEN", "DUNE_DISCORD_ADAPTER_TOKEN_FILE") || "placeholder") : readSecret(env, "DUNE_DISCORD_ADAPTER_TOKEN", "DUNE_DISCORD_ADAPTER_TOKEN_FILE"),
      timeoutMs: parsePositiveInteger(env.REQUEST_TIMEOUT_MS, 8000),
      paths: {
        health: optionalEnv(env, "DUNE_ADAPTER_HEALTH_PATH") || DEFAULT_PATHS.health,
        status: optionalEnv(env, "DUNE_ADAPTER_STATUS_PATH") || DEFAULT_PATHS.status,
        readiness: optionalEnv(env, "DUNE_ADAPTER_READINESS_PATH") || DEFAULT_PATHS.readiness,
        services: optionalEnv(env, "DUNE_ADAPTER_SERVICES_PATH") || DEFAULT_PATHS.services,
        population: optionalEnv(env, "DUNE_ADAPTER_POPULATION_PATH") || DEFAULT_PATHS.population,
        logs: optionalEnv(env, "DUNE_ADAPTER_LOGS_PATH") || DEFAULT_PATHS.logs,
        "map-state": optionalEnv(env, "DUNE_ADAPTER_MAP_STATE_PATH") || DEFAULT_PATHS["map-state"],
        maintenance: optionalEnv(env, "DUNE_ADAPTER_MAINTENANCE_PATH") || DEFAULT_PATHS.maintenance,
        backups: optionalEnv(env, "DUNE_ADAPTER_BACKUPS_PATH") || DEFAULT_PATHS.backups,
        announcements: optionalEnv(env, "DUNE_ADAPTER_ANNOUNCEMENTS_PATH") || DEFAULT_PATHS.announcements,
        broadcast: optionalEnv(env, "DUNE_ADAPTER_BROADCAST_PATH") || DEFAULT_PATHS.broadcast,
        version: optionalEnv(env, "DUNE_ADAPTER_VERSION_PATH") || DEFAULT_PATHS.version,
        servers: optionalEnv(env, "DUNE_ADAPTER_SERVERS_PATH") || DEFAULT_PATHS.servers,
        ports: optionalEnv(env, "DUNE_ADAPTER_PORTS_PATH") || DEFAULT_PATHS.ports,
        db: optionalEnv(env, "DUNE_ADAPTER_DB_PATH") || DEFAULT_PATHS.db,
        "write-execute": optionalEnv(env, "DUNE_ADAPTER_WRITE_EXECUTE_PATH") || DEFAULT_PATHS["write-execute"],
        "write-preview": optionalEnv(env, "DUNE_ADAPTER_WRITE_PREVIEW_PATH") || DEFAULT_PATHS["write-preview"],
        "players-link": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_LINK_PATH") || DEFAULT_PATHS["players-link"],
        "players-unlink": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_UNLINK_PATH") || DEFAULT_PATHS["players-unlink"],
        "players-me": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_ME_PATH") || DEFAULT_PATHS["players-me"],
        "players-faction": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_FACTION_PATH") || DEFAULT_PATHS["players-faction"],
        "players-inventory": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_INVENTORY_PATH") || DEFAULT_PATHS["players-inventory"],
        "players-inventory-search": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_INVENTORY_SEARCH_PATH") || DEFAULT_PATHS["players-inventory-search"],
        "players-storage": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_STORAGE_PATH") || DEFAULT_PATHS["players-storage"],
        "players-find": optionalEnv(env, "DUNE_ADAPTER_PLAYERS_FIND_PATH") || DEFAULT_PATHS["players-find"],
        "guild-storage": optionalEnv(env, "DUNE_ADAPTER_GUILD_STORAGE_PATH") || DEFAULT_PATHS["guild-storage"],
        "guild-find": optionalEnv(env, "DUNE_ADAPTER_GUILD_FIND_PATH") || DEFAULT_PATHS["guild-find"],
        "ops-activity": optionalEnv(env, "DUNE_ADAPTER_OPS_ACTIVITY_PATH") || DEFAULT_PATHS["ops-activity"],
        "ops-combat": optionalEnv(env, "DUNE_ADAPTER_OPS_COMBAT_PATH") || DEFAULT_PATHS["ops-combat"],
        "ops-resources": optionalEnv(env, "DUNE_ADAPTER_OPS_RESOURCES_PATH") || DEFAULT_PATHS["ops-resources"],
        "ops-economy": optionalEnv(env, "DUNE_ADAPTER_OPS_ECONOMY_PATH") || DEFAULT_PATHS["ops-economy"],
        "ops-inventory": optionalEnv(env, "DUNE_ADAPTER_OPS_INVENTORY_PATH") || DEFAULT_PATHS["ops-inventory"],
        "ops-location": optionalEnv(env, "DUNE_ADAPTER_OPS_LOCATION_PATH") || DEFAULT_PATHS["ops-location"],
        "ops-soc": optionalEnv(env, "DUNE_ADAPTER_OPS_SOC_PATH") || DEFAULT_PATHS["ops-soc"],
        "ops-prometheus": optionalEnv(env, "DUNE_ADAPTER_OPS_PROMETHEUS_PATH") || DEFAULT_PATHS["ops-prometheus"],
        "ops-dashboard": optionalEnv(env, "DUNE_ADAPTER_OPS_DASHBOARD_PATH") || DEFAULT_PATHS["ops-dashboard"],
        "player-links-start": optionalEnv(env, "DUNE_ADAPTER_PLAYER_LINKS_START_PATH") || DEFAULT_PATHS["player-links-start"],
        "player-links-verify": optionalEnv(env, "DUNE_ADAPTER_PLAYER_LINKS_VERIFY_PATH") || DEFAULT_PATHS["player-links-verify"],
        "player-links": optionalEnv(env, "DUNE_ADAPTER_PLAYER_LINKS_PATH") || DEFAULT_PATHS["player-links"],
        "player-links-unlink": optionalEnv(env, "DUNE_ADAPTER_PLAYER_LINKS_UNLINK_PATH") || DEFAULT_PATHS["player-links-unlink"],
        "guild-grants": optionalEnv(env, "DUNE_ADAPTER_GUILD_GRANTS_PATH") || DEFAULT_PATHS["guild-grants"],
        "guild-grants-enable": optionalEnv(env, "DUNE_ADAPTER_GUILD_GRANTS_ENABLE_PATH") || DEFAULT_PATHS["guild-grants-enable"],
        "guild-grants-disable": optionalEnv(env, "DUNE_ADAPTER_GUILD_GRANTS_DISABLE_PATH") || DEFAULT_PATHS["guild-grants-disable"],
        "guild-grants-default": optionalEnv(env, "DUNE_ADAPTER_GUILD_GRANTS_DEFAULT_PATH") || DEFAULT_PATHS["guild-grants-default"],
        "player-inventory-v2": optionalEnv(env, "DUNE_ADAPTER_PLAYER_INVENTORY_V2_PATH") || DEFAULT_PATHS["player-inventory-v2"]
      },
      methods: {
        health: parseMethod(env.DUNE_ADAPTER_HEALTH_METHOD, DEFAULT_METHODS.health),
        status: parseMethod(env.DUNE_ADAPTER_STATUS_METHOD, DEFAULT_METHODS.status),
        readiness: parseMethod(env.DUNE_ADAPTER_READINESS_METHOD, DEFAULT_METHODS.readiness),
        services: parseMethod(env.DUNE_ADAPTER_SERVICES_METHOD, DEFAULT_METHODS.services),
        population: parseMethod(env.DUNE_ADAPTER_POPULATION_METHOD, DEFAULT_METHODS.population),
        logs: parseMethod(env.DUNE_ADAPTER_LOGS_METHOD, DEFAULT_METHODS.logs),
        "map-state": parseMethod(env.DUNE_ADAPTER_MAP_STATE_METHOD, DEFAULT_METHODS["map-state"]),
        maintenance: parseMethod(env.DUNE_ADAPTER_MAINTENANCE_METHOD, DEFAULT_METHODS.maintenance),
        backups: parseMethod(env.DUNE_ADAPTER_BACKUPS_METHOD, DEFAULT_METHODS.backups),
        announcements: parseMethod(env.DUNE_ADAPTER_ANNOUNCEMENTS_METHOD, DEFAULT_METHODS.announcements),
        broadcast: parseMethod(env.DUNE_ADAPTER_BROADCAST_METHOD, DEFAULT_METHODS.broadcast),
        version: parseMethod(env.DUNE_ADAPTER_VERSION_METHOD, DEFAULT_METHODS.version),
        servers: parseMethod(env.DUNE_ADAPTER_SERVERS_METHOD, DEFAULT_METHODS.servers),
        ports: parseMethod(env.DUNE_ADAPTER_PORTS_METHOD, DEFAULT_METHODS.ports),
        db: parseMethod(env.DUNE_ADAPTER_DB_METHOD, DEFAULT_METHODS.db),
        "write-execute": parseMethod(env.DUNE_ADAPTER_WRITE_EXECUTE_METHOD, DEFAULT_METHODS["write-execute"]),
        "write-preview": parseMethod(env.DUNE_ADAPTER_WRITE_PREVIEW_METHOD, DEFAULT_METHODS["write-preview"]),
        "players-link": parseMethod(env.DUNE_ADAPTER_PLAYERS_LINK_METHOD, DEFAULT_METHODS["players-link"]),
        "players-unlink": parseMethod(env.DUNE_ADAPTER_PLAYERS_UNLINK_METHOD, DEFAULT_METHODS["players-unlink"]),
        "players-me": parseMethod(env.DUNE_ADAPTER_PLAYERS_ME_METHOD, DEFAULT_METHODS["players-me"]),
        "players-faction": parseMethod(env.DUNE_ADAPTER_PLAYERS_FACTION_METHOD, DEFAULT_METHODS["players-faction"]),
        "players-inventory": parseMethod(env.DUNE_ADAPTER_PLAYERS_INVENTORY_METHOD, DEFAULT_METHODS["players-inventory"]),
        "players-inventory-search": parseMethod(env.DUNE_ADAPTER_PLAYERS_INVENTORY_SEARCH_METHOD, DEFAULT_METHODS["players-inventory-search"]),
        "players-storage": parseMethod(env.DUNE_ADAPTER_PLAYERS_STORAGE_METHOD, DEFAULT_METHODS["players-storage"]),
        "players-find": parseMethod(env.DUNE_ADAPTER_PLAYERS_FIND_METHOD, DEFAULT_METHODS["players-find"]),
        "guild-storage": parseMethod(env.DUNE_ADAPTER_GUILD_STORAGE_METHOD, DEFAULT_METHODS["guild-storage"]),
        "guild-find": parseMethod(env.DUNE_ADAPTER_GUILD_FIND_METHOD, DEFAULT_METHODS["guild-find"]),
        "ops-activity": parseMethod(env.DUNE_ADAPTER_OPS_ACTIVITY_METHOD, DEFAULT_METHODS["ops-activity"]),
        "ops-combat": parseMethod(env.DUNE_ADAPTER_OPS_COMBAT_METHOD, DEFAULT_METHODS["ops-combat"]),
        "ops-resources": parseMethod(env.DUNE_ADAPTER_OPS_RESOURCES_METHOD, DEFAULT_METHODS["ops-resources"]),
        "ops-economy": parseMethod(env.DUNE_ADAPTER_OPS_ECONOMY_METHOD, DEFAULT_METHODS["ops-economy"]),
        "ops-inventory": parseMethod(env.DUNE_ADAPTER_OPS_INVENTORY_METHOD, DEFAULT_METHODS["ops-inventory"]),
        "ops-location": parseMethod(env.DUNE_ADAPTER_OPS_LOCATION_METHOD, DEFAULT_METHODS["ops-location"]),
        "ops-soc": parseMethod(env.DUNE_ADAPTER_OPS_SOC_METHOD, DEFAULT_METHODS["ops-soc"]),
        "ops-prometheus": parseMethod(env.DUNE_ADAPTER_OPS_PROMETHEUS_METHOD, DEFAULT_METHODS["ops-prometheus"]),
        "ops-dashboard": parseMethod(env.DUNE_ADAPTER_OPS_DASHBOARD_METHOD, DEFAULT_METHODS["ops-dashboard"]),
        "player-links-start": parseMethod(env.DUNE_ADAPTER_PLAYER_LINKS_START_METHOD, DEFAULT_METHODS["player-links-start"]),
        "player-links-verify": parseMethod(env.DUNE_ADAPTER_PLAYER_LINKS_VERIFY_METHOD, DEFAULT_METHODS["player-links-verify"]),
        "player-links": parseMethod(env.DUNE_ADAPTER_PLAYER_LINKS_METHOD, DEFAULT_METHODS["player-links"]),
        "player-links-unlink": parseMethod(env.DUNE_ADAPTER_PLAYER_LINKS_UNLINK_METHOD, DEFAULT_METHODS["player-links-unlink"]),
        "guild-grants": parseMethod(env.DUNE_ADAPTER_GUILD_GRANTS_METHOD, DEFAULT_METHODS["guild-grants"]),
        "guild-grants-enable": parseMethod(env.DUNE_ADAPTER_GUILD_GRANTS_ENABLE_METHOD, DEFAULT_METHODS["guild-grants-enable"]),
        "guild-grants-disable": parseMethod(env.DUNE_ADAPTER_GUILD_GRANTS_DISABLE_METHOD, DEFAULT_METHODS["guild-grants-disable"]),
        "guild-grants-default": parseMethod(env.DUNE_ADAPTER_GUILD_GRANTS_DEFAULT_METHOD, DEFAULT_METHODS["guild-grants-default"]),
        "player-inventory-v2": parseMethod(env.DUNE_ADAPTER_PLAYER_INVENTORY_V2_METHOD, DEFAULT_METHODS["player-inventory-v2"])
      }
    }
  };
  validateConfig(config);
  return config;
}

export function validateConfig(config) {
  if (!config.multiTenant) {
    const url = new URL(config.adapter.baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("DUNE_CONSOLE_API_URL must use http or https.");
    }
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

  if (!config.multiTenant && config.discord.rbac.mode === "restricted" && !hasAnyRbacPrincipal(config.discord.rbac)) {
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

// readOptionalSecretFile: like readSecret()'s file-path branch, but never
// throws -- returns undefined if the *_FILE env var is unset, the file
// doesn't exist, or it's empty. Used for secrets that are optional in
// single-tenant mode (see discord.clientSecret / steamLink.enabled above),
// where readSecret()'s required-throw behavior would break bots that never
// intend to use the feature that needs this secret.
function readOptionalSecretFile(env, fileName) {
  const filePath = optionalEnv(env, fileName);
  if (!filePath) return undefined;
  try {
    const fileValue = readFileSync(filePath, "utf8").trim();
    return fileValue || undefined;
  } catch {
    return undefined;
  }
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
