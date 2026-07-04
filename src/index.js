import { Client, Events, GatewayIntentBits } from "discord.js";
import { AdapterClient } from "./adapterClient.js";
import { executeDuneCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { startHealthState } from "./healthState.js";
import { logError, logInfo } from "./logger.js";
import { startScheduler } from "./scheduler.js";

const config = loadConfig();
const adapterClient = new AdapterClient(config);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const healthState = startHealthState({
  onError: (error) => logError("health_state.write_failed", error)
});
let scheduler = { active: false, stop() {} };

client.once(Events.ClientReady, (readyClient) => {
  healthState.markReady();
  logInfo("discord.ready", {
    botUserId: readyClient.user.id
  });
  scheduler = startScheduler({
    client,
    adapterClient,
    config,
    onError: (error) => logError("scheduler.failed", error)
  });
  if (scheduler.active) {
    logInfo("scheduler.started", {
      scheduleType: scheduler.scheduleType,
      channels: scheduler.allowedChannels
    });
  }
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
    scheduler.stop();
    await client.destroy();
    healthState.stop();
    process.exit(0);
  });
}

await client.login(config.discord.token);
