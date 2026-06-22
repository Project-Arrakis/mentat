import { REST, Routes } from "discord.js";
import { commandDefinitions } from "../src/commands.js";
import { loadConfig } from "../src/config.js";
import { logInfo } from "../src/logger.js";

const config = loadConfig();
const rest = new REST({ version: "10" }).setToken(config.discord.token);
const commands = commandDefinitions();

if (config.discord.guildId) {
  await rest.put(Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId), { body: commands });
  logInfo("discord.commands_registered", { commandSets: commands.length, scope: "guild" });
} else {
  await rest.put(Routes.applicationCommands(config.discord.clientId), { body: commands });
  logInfo("discord.commands_registered", { commandSets: commands.length, scope: "global" });
}
