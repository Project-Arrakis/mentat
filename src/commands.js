import { SlashCommandBuilder } from "discord.js";
import { readFileSync } from "node:fs";
import { checkCooldown, applyCooldown } from "./cooldown.js";
import { executeBroadcast, sendBroadcastToAdapter } from "./broadcast.js";
import { formatError, formatPayload } from "./format.js";
import { OPS_SUBCOMMAND_NAMES, opsRouteFor, formatOpsPayload, opsDescriptionFor } from "./opsCommands.js";

const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const SUBCOMMANDS = new Set(["about", "ping", "health", "status", "status-summary", "readiness", "services", "population", "backups", "broadcast", "help", "doctor", ...OPS_SUBCOMMAND_NAMES]);

export function buildDuneCommand() {
  return new SlashCommandBuilder()
    .setName("dune")
    .setDescription("Read Dune server state from the console Discord adapter.")
    .addSubcommand((command) => command.setName("about").setDescription("Show safe bot and adapter metadata."))
    .addSubcommand((command) => command.setName("ping").setDescription("Measure Discord and adapter latency."))
    .addSubcommand((command) => command.setName("health").setDescription("Check the console Discord adapter."))
    .addSubcommand((command) => command.setName("status").setDescription("Show high-level server status."))
    .addSubcommand((command) => command.setName("status-summary").setDescription("Show compact aggregate server status."))
    .addSubcommand((command) => command.setName("readiness").setDescription("Show readiness and preflight state."))
    .addSubcommand((command) => command.setName("services").setDescription("Show service state."))
    .addSubcommand((command) => command.setName("population").setDescription("Show aggregate player count and server population."))
    .addSubcommand((command) => command.setName("backups").setDescription("List recent backup metadata (read-only, no create/restore/delete)."))
    .addSubcommand((command) => command.setName("broadcast").setDescription("Send a message to in-game players (moderator+).")
      .addStringOption((option) => option.setName("message").setDescription("Message to broadcast").setRequired(true).setMaxLength(500)))
    .addSubcommand((command) => command.setName("help").setDescription("Show available commands for your role."))
    .addSubcommand((command) => command.setName("doctor").setDescription("Admin-only: comprehensive system diagnostic across all subsystems."))
    .addSubcommand((command) => command.setName("activity").setDescription(opsDescriptionFor("activity")))
    .addSubcommand((command) => command.setName("combat").setDescription(opsDescriptionFor("combat")))
    .addSubcommand((command) => command.setName("resources").setDescription(opsDescriptionFor("resources")))
    .addSubcommand((command) => command.setName("economy").setDescription(opsDescriptionFor("economy")))
    .addSubcommand((command) => command.setName("inventory").setDescription(opsDescriptionFor("inventory")))
    .addSubcommand((command) => command.setName("location").setDescription(opsDescriptionFor("location")))
    .addSubcommand((command) => command.setName("soc").setDescription(opsDescriptionFor("soc")))
    .addSubcommand((command) => command.setName("prometheus").setDescription(opsDescriptionFor("prometheus")))
    .addSubcommand((command) => command.setName("dashboard").setDescription(opsDescriptionFor("dashboard")));
}

export function commandDefinitions() {
  return [buildDuneCommand().toJSON()];
}

export async function executeDuneCommand(interaction, adapterClient, config) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "dune") return false;

  const subcommand = interaction.options.getSubcommand();
  if (!SUBCOMMANDS.has(subcommand)) {
    await interaction.reply({ content: "Unsupported Dune command.", ephemeral: true });
    return true;
  }

  if (!isCommandAllowed(interaction, subcommand, config.discord.rbac)) {
    await interaction.reply({ content: "You are not authorized to use this command.", ephemeral: true });
    return true;
  }

  const cooldown = checkCooldown({
    userId: interaction.user?.id,
    commandName: subcommand,
    interaction,
    config
  });
  if (!cooldown.allowed) {
    const secs = Math.ceil(cooldown.remainingMs / 1000);
    await interaction.reply({ content: `Please wait ${secs}s before using this command again.`, ephemeral: true });
    return true;
  }

  const startedAt = Date.now();
  const actor = actorFromInteraction(interaction);
  await interaction.deferReply({ ephemeral: config.discord.defaultEphemeral });
  const deferReplyMs = elapsedMs(startedAt);

  try {
    let payload;
    if (subcommand === "about") {
      payload = aboutPayload(config);
    } else if (subcommand === "ping") {
      payload = await pingPayload(adapterClient, actor, deferReplyMs);
    } else if (subcommand === "status-summary") {
      payload = statusSummaryPayload(await adapterClient.status(actor));
    } else if (subcommand === "backups") {
      payload = backupPayload(await adapterClient.backups(actor));
    } else if (subcommand === "broadcast") {
      const msg = interaction.options.getString("message");
      const result = await executeBroadcast({ interaction, adapterClient, config, userRequest: msg });
      if (result.ok && result.needsConfirmation) {
        payload = { ok: true, action: "broadcast", message: result.message, idempotencyKey: result.idempotencyKey, confirmation: result.confirmationMessage };
      } else {
        payload = result;
      }
    } else if (subcommand === "help") {
      payload = helpPayload(config, interaction);
    } else if (subcommand === "doctor") {
      if (!isAdminActor(interaction, config)) throw new Error("Doctor diagnostic requires admin or owner role.");
      payload = await doctorPayload(adapterClient, actor, config);
    } else if (subcommand === "population") {
      payload = populationPayload(await adapterClient.population(actor));
    } else if (OPS_SUBCOMMAND_NAMES.includes(subcommand)) {
      const route = opsRouteFor(subcommand);
      if (route) {
        payload = formatOpsPayload(subcommand, await adapterClient[route](actor));
      } else {
        payload = { ok: false, error: `Unknown OPS command: ${subcommand}` };
      }
    } else {
      payload = await adapterClient[subcommand](actor);
    }
    await interaction.editReply(formatPayload(`Dune ${subcommand}`, payload));
  } catch (error) {
    await interaction.editReply(formatError(error));
  }

  applyCooldown({
    userId: interaction.user?.id,
    commandName: subcommand,
    interaction,
    config
  });

  return true;
}

export async function pingPayload(adapterClient, actor, deferReplyMs = 0) {
  const startedAt = Date.now();
  const health = await adapterClient.health(actor);

  return {
    ok: health?.ok === true,
    discord: {
      deferReplyMs: normalizeDuration(deferReplyMs)
    },
    adapter: {
      route: "health",
      roundTripMs: elapsedMs(startedAt),
      ok: health?.ok === true,
      enabled: health?.enabled === true,
      readOnly: health?.readOnly === true,
      writesEnabled: health?.writesEnabled === true
    }
  };
}

export function statusSummaryPayload(status) {
  const summary = status?.result?.summary || {};
  const automation = summary.automation || {};

  return {
    ok: status?.ok === true,
    overall: summaryValue(summary.overall, "UNKNOWN"),
    region: summaryValue(summary.region, "unknown"),
    mode: summaryValue(summary.mode, "unknown"),
    population: summaryValue(summary.population, "unknown"),
    automation: {
      autoscaler: summaryValue(automation.autoscaler, "unknown"),
      autoUpdates: summaryValue(automation.autoUpdates, "unknown")
    }
  };
}

export function aboutPayload(config) {
  return {
    ok: true,
    bot: {
      name: PACKAGE.name,
      version: PACKAGE.version,
      readOnly: true,
      writesEnabled: false
    },
    adapter: {
      origin: adapterOrigin(config.adapter.baseUrl),
      timeoutMs: config.adapter.timeoutMs
    },
    discord: {
      rbacMode: config.discord.rbac.mode,
      defaultEphemeral: config.discord.defaultEphemeral
    },
    boundary: {
      dockerSocket: false,
      databaseDirect: false,
      gameFiles: false,
      shellCommands: false
    }
  };
}

export function actorFromInteraction(interaction) {
  return {
    userId: interaction.user?.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    roleIds: extractRoleIds(interaction)
  };
}

export function isCommandAllowed(interaction, command, rbac) {
  if (!rbac?.commandRoleIds?.[command]) return false;
  if (rbac.mode === "open") return true;

  if (rbac.allowedUserIds?.includes(interaction.user?.id)) return true;

  const roleIds = new Set(extractRoleIds(interaction));
  return rbac.commandRoleIds[command].some((roleId) => roleIds.has(roleId));
}

export function requiredRoleIdsForCommand(command, rbac) {
  return rbac?.commandRoleIds?.[command] || [];
}

export function extractRoleIds(interaction) {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles.map(String);
  if (roles.cache?.keys) return [...roles.cache.keys()];
  if (roles instanceof Set) return [...roles].map(String);
  return [];
}

function elapsedMs(startedAt) {
  return normalizeDuration(Date.now() - startedAt);
}

function normalizeDuration(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function summaryValue(value, fallback) {
  return value === undefined || value === null || value === "" ? fallback : value;
}

function adapterOrigin(baseUrl) {
  return new URL(baseUrl).origin;
}

export function populationPayload(population) {
  const result = population?.result || {};
  return {
    ok: population?.ok === true,
    online: result.onlinePlayers ?? "unknown",
    total: result.totalPlayers ?? "unknown",
    aggregate: result.aggregate ?? true,
    detailsSuppressed: result.detailsSuppressed ?? true
  };
}

export function backupPayload(backups) {
  const result = backups?.result || {};
  const list = Array.isArray(result.backups) ? result.backups.slice(0, 10) : [];
  return {
    ok: backups?.ok === true,
    count: list.length,
    backups: list.map((b) => ({
      name: b.name || "unknown",
      date: b.date || b.createdAt || "unknown",
      size: b.size || "unknown"
    }))
  };
}

function isAdminActor(interaction, config) {
  const roleIds = extractRoleIds(interaction);
  const adminRoles = new Set([
    ...(parseCsv(process.env.DISCORD_ADMIN_ROLE_IDS)),
    ...(parseCsv(process.env.DISCORD_WRITE_ADMIN_ROLE_IDS)),
    ...(parseCsv(process.env.DISCORD_WRITE_OWNER_ROLE_IDS)),
    ...(Array.isArray(config?.discord?.rbac?.adminRoleIds) ? config.discord.rbac.adminRoleIds : [])
  ]);
  const allowedUsers = new Set(parseCsv(process.env.DISCORD_ALLOWED_USER_IDS));
  return roleIds.some((r) => adminRoles.has(r)) || allowedUsers.has(interaction?.user?.id);
}

function parseCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function helpPayload(config, interaction) {
  const allCommands = [
    { name: "about", desc: "Show safe bot and adapter metadata.", role: "observer" },
    { name: "ping", desc: "Measure Discord and adapter latency.", role: "observer" },
    { name: "health", desc: "Check the console Discord adapter.", role: "observer" },
    { name: "status", desc: "Show high-level server status.", role: "observer" },
    { name: "status-summary", desc: "Show compact aggregate server status.", role: "observer" },
    { name: "readiness", desc: "Show readiness and preflight state.", role: "observer" },
    { name: "services", desc: "Show service state.", role: "observer" },
    { name: "population", desc: "Show aggregate player count.", role: "observer" },
    { name: "backups", desc: "List recent backup metadata.", role: "observer" },
    { name: "activity", desc: opsDescriptionFor("activity"), role: "observer" },
    { name: "combat", desc: opsDescriptionFor("combat"), role: "observer" },
    { name: "resources", desc: opsDescriptionFor("resources"), role: "observer" },
    { name: "economy", desc: opsDescriptionFor("economy"), role: "observer" },
    { name: "inventory", desc: opsDescriptionFor("inventory"), role: "observer" },
    { name: "location", desc: opsDescriptionFor("location"), role: "observer" },
    { name: "soc", desc: opsDescriptionFor("soc"), role: "observer" },
    { name: "prometheus", desc: opsDescriptionFor("prometheus"), role: "observer" },
    { name: "dashboard", desc: opsDescriptionFor("dashboard"), role: "observer" },
    { name: "broadcast", desc: "Send a message to all players.", role: "admin" },
    { name: "doctor", desc: "Comprehensive system diagnostic.", role: "admin" }
  ];

  const available = [];
  const locked = [];
  for (const cmd of allCommands) {
    if (isCommandAllowed(interaction, cmd.name, config.discord.rbac)) {
      available.push(cmd);
    } else {
      locked.push(cmd);
    }
  }

  return {
    ok: true,
    total: allCommands.length,
    available: available.map((c) => c.name),
    locked: locked.map((c) => c.name),
    availableCount: available.length,
    rbacMode: config.discord.rbac.mode
  };
}

async function doctorPayload(adapterClient, actor, config) {
  const [health, status, readiness, services] = await Promise.all([
    adapterClient.health(actor).catch(() => ({ ok: false, error: "health failed" })),
    adapterClient.status(actor).catch(() => ({ ok: false, error: "status failed" })),
    adapterClient.readiness(actor).catch(() => ({ ok: false, error: "readiness failed" })),
    adapterClient.services(actor).catch(() => ({ ok: false, error: "services failed" }))
  ]);

  return {
    ok: health?.ok !== false && status?.ok !== false,
    health: { ok: health?.ok === true, enabled: health?.enabled, readOnly: health?.readOnly, writesEnabled: health?.writesEnabled },
    status: { ok: status?.ok === true, summary: status?.result?.summary || {} },
    readiness: { ok: readiness?.ok === true, ready: readiness?.result?.ready, issues: readiness?.result?.issues || [] },
    services: { ok: services?.ok === true, overall: services?.result?.overall, count: (services?.result?.services || []).length },
    timestamp: new Date().toISOString()
  };
}
