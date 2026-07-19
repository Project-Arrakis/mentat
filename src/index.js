import { Client, Events, GatewayIntentBits } from "discord.js";
import { AdapterClient } from "./adapterClient.js";
import { createAnnouncementBridge, announcementConfig } from "./announcements.js";
import { executeDuneCommand } from "./commands.js";
import { loadConfig } from "./config.js";
import { startHealthState } from "./healthState.js";
import { logError, logInfo } from "./logger.js";
import { startScheduler } from "./scheduler.js";
import { alertSubscriber } from "./notifications.js";
import { createDatabase, getGuild, getGuildRoles, getGuildSettings, initBotStats, incrementCommandCount } from "./database.js";
import { createSetupServer } from "./setupServer.js";
import { handleGuildCreate, handleGuildDelete } from "./onboarding.js";
import { startStatsPusher } from "./statsPusher.js";

const config = loadConfig();
const db = config.multiTenant ? createDatabase(config.dbPath) : null;
if (db) initBotStats(db);
const adapterClient = new AdapterClient(config, {
  getGuildConfig: db ? (guildId) => {
    const guild = getGuild(db, guildId);
    if (!guild || guild.status !== "active") return null;
    return {
      adapter: {
        baseUrl: guild.console_url,
        token: guild.adapter_token,
        timeoutMs: config.adapter.timeoutMs,
        paths: config.adapter.paths,
        methods: config.adapter.methods
      }
    };
  } : null
});
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const healthState = startHealthState({
  onError: (error) => logError("health_state.write_failed", error)
});
let scheduler = { active: false, stop() {} };
let announcementBridge = { active: false, stop() {} };
let alerts = { active: false, stop() {} };
let statsPusher = { active: false, stop() {} };

if (config.multiTenant) {
  const setupApp = createSetupServer({
    dbPath: config.dbPath,
    discordClientId: config.discord.clientId,
    discordClientSecret: config.discord.clientSecret,
    baseUrl: config.baseUrl,
    oauthRedirectUri: config.oauthRedirectUri
  });
  const setupPort = config.setupPort || 3100;
  setupApp.listen(setupPort, () => {
    logInfo("setup_server.started", { port: setupPort });
  });
}

client.once(Events.ClientReady, (readyClient) => {
  healthState.markReady();
  logInfo("discord.ready", {
    botUserId: readyClient.user.id,
    multiTenant: config.multiTenant
  });
  scheduler = startScheduler({
    client,
    adapterClient,
    config,
    db,
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

  statsPusher = startStatsPusher({ client, db, adapterClient });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    await executeDuneCommand(interaction, adapterClient, config, db);
  } catch (error) {
    logError("discord.interaction_failed", error);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  logInfo("guild.joined", { guildId: guild.id, guildName: guild.name });
  if (config.multiTenant) {
    await handleGuildCreate(client, guild, db);
  }
});

client.on(Events.GuildDelete, async (guild) => {
  logInfo("guild.left", { guildId: guild.id, guildName: guild.name });
  if (config.multiTenant) {
    await handleGuildDelete(client, guild, db);
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
    statsPusher.stop();
    if (db) db.close();
    await client.destroy();
    healthState.stop();
    process.exit(0);
  });
}

await client.login(config.discord.token);
