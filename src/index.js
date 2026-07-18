import { Client, Events, GatewayIntentBits } from "discord.js";
import { AdapterClient } from "./adapterClient.js";
import { createAnnouncementBridge, announcementConfig } from "./announcements.js";
import { executeDuneCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { startHealthState } from "./healthState.js";
import { logError, logInfo } from "./logger.js";
import { startScheduler } from "./scheduler.js";
import { alertSubscriber } from "./notifications.js";

const config = loadConfig();
const adapterClient = new AdapterClient(config);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const healthState = startHealthState({
  onError: (error) => logError("health_state.write_failed", error)
});
let scheduler = { active: false, stop() {} };
let announcementBridge = { active: false, stop() {} };
let alerts = { active: false, stop() {} };

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

  const annConfig = announcementConfig();
  if (annConfig.enabled && annConfig.channelId) {
    announcementBridge = createAnnouncementBridge({
      adapterClient,
      client,
      channelId: annConfig.channelId,
      onError: (error) => logError("announcements.failed", error)
    });
    announcementBridge.start(annConfig.pollIntervalMs);
    logInfo("announcements.started", {
      channel: annConfig.channelId,
      pollIntervalMs: annConfig.pollIntervalMs
    });
  }

  // Wire up alert subscriber if configured
  const alertChannelId = process.env.DUNE_ALERT_CHANNEL_ID;
  if (alertChannelId) {
    const alertIntervalMs = Number.parseInt(process.env.DUNE_ALERT_INTERVAL_MS || "300000", 10) || 300000;
    const alertSub = alertSubscriber({
      adapterClient,
      client,
      channelId: alertChannelId,
      onError: (error) => logError("alerts.failed", error)
    });

    const readinessTimer = setInterval(() => alertSub.checkReadiness(), alertIntervalMs);
    const servicesTimer = setInterval(() => alertSub.checkServices(), alertIntervalMs);
    readinessTimer.unref?.();
    servicesTimer.unref?.();

    alerts = {
      active: true,
      stop() {
        clearInterval(readinessTimer);
        clearInterval(servicesTimer);
      }
    };

    logInfo("alerts.started", {
      channel: alertChannelId,
      intervalMs: alertIntervalMs
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
    if (scheduler && typeof scheduler.stop === "function") {
      scheduler.stop();
    }
    announcementBridge.stop();
    alerts.stop();
    await client.destroy();
    healthState.stop();
    process.exit(0);
  });
}

await client.login(config.discord.token);
