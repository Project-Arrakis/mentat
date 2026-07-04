import { SlashCommandBuilder } from "discord.js";
import { readFileSync } from "node:fs";
import { checkCooldown, applyCooldown } from "./cooldown.js";
import { executeBroadcast, sendBroadcastToAdapter } from "./broadcast.js";
import { formatError, formatPayload } from "./format.js";
import { OPS_SUBCOMMAND_NAMES, opsRouteFor, formatOpsPayload, opsDescriptionFor } from "./opsCommands.js";

const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const SUBCOMMANDS = new Set(["about", "ping", "health", "status", "status-summary", "readiness", "services", "population", "backups", "broadcast", ...OPS_SUBCOMMAND_NAMES]);

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
