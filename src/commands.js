import { SlashCommandBuilder } from "discord.js";
import { readFileSync } from "node:fs";
import { formatError, formatPayload } from "./format.js";

const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const SUBCOMMANDS = new Set(["about", "ping", "health", "status", "status-summary", "readiness", "services"]);

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
    .addSubcommand((command) => command.setName("services").setDescription("Show service state."));
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
    } else {
      payload = await adapterClient[subcommand](actor);
    }
    await interaction.editReply(formatPayload(`Dune ${subcommand}`, payload));
  } catch (error) {
    await interaction.editReply(formatError(error));
  }

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
