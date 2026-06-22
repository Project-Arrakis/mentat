import { Client, Events, GatewayIntentBits } from "discord.js";
import { AdapterClient } from "./adapterClient.js";
import { executeDuneCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { logError, logInfo } from "./logger.js";

const config = loadConfig();
const adapterClient = new AdapterClient(config);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (readyClient) => {
  logInfo("discord.ready", {
    botUserId: readyClient.user.id
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await executeDuneCommand(interaction, adapterClient, config);
  } catch (error) {
    logError("discord.interaction_failed", error);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    logInfo("process.shutdown", { signal });
    await client.destroy();
    process.exit(0);
  });
}

await client.login(config.discord.token);
