import { SlashCommandBuilder } from "discord.js";
import { readFileSync } from "node:fs";
import { formatError, formatPayload } from "./format.js";

const PACKAGE = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const SUBCOMMANDS = new Set(["about", "health", "status", "readiness", "services"]);

export function buildDuneCommand() {
  return new SlashCommandBuilder()
    .setName("dune")
    .setDescription("Read Dune server state from the console Discord adapter.")
    .addSubcommand((command) => command.setName("about").setDescription("Show safe bot and adapter metadata."))
    .addSubcommand((command) => command.setName("health").setDescription("Check the console Discord adapter."))
    .addSubcommand((command) => command.setName("status").setDescription("Show high-level server status."))
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

  await interaction.deferReply({ ephemeral: config.discord.defaultEphemeral });

  try {
    const payload = subcommand === "about"
      ? aboutPayload(config)
      : await adapterClient[subcommand](actorFromInteraction(interaction));
    await interaction.editReply(formatPayload(`Dune ${subcommand}`, payload));
  } catch (error) {
    await interaction.editReply(formatError(error));
  }

  return true;
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

function adapterOrigin(baseUrl) {
  return new URL(baseUrl).origin;
}
