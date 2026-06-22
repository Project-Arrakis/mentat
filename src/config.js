import { readFileSync } from "node:fs";

const DEFAULT_PATHS = Object.freeze({
  health: "/api/integrations/discord/health",
  status: "/api/integrations/discord/status",
  readiness: "/api/integrations/discord/readiness",
  services: "/api/integrations/discord/services"
});

const DEFAULT_METHODS = Object.freeze({
  health: "GET",
  status: "POST",
  readiness: "POST",
  services: "POST"
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
          services: mergeRoleIds(observerRoleIds, adminRoleIds, parseCsv(env.DISCORD_SERVICES_ROLE_IDS))
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
        services: optionalEnv(env, "DUNE_ADAPTER_SERVICES_PATH") || DEFAULT_PATHS.services
      },
      methods: {
        health: parseMethod(env.DUNE_ADAPTER_HEALTH_METHOD, DEFAULT_METHODS.health),
        status: parseMethod(env.DUNE_ADAPTER_STATUS_METHOD, DEFAULT_METHODS.status),
        readiness: parseMethod(env.DUNE_ADAPTER_READINESS_METHOD, DEFAULT_METHODS.readiness),
        services: parseMethod(env.DUNE_ADAPTER_SERVICES_METHOD, DEFAULT_METHODS.services)
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
