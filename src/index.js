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
import { createSteamLinkServer } from "./steamLinkServer.js";
import { handleGuildCreate, handleGuildDelete } from "./onboarding.js";
import { startStatsPusher } from "./statsPusher.js";
import { runAuditLogPruning } from "./auditLog.js";

const config = loadConfig();
// SQLite is now opened UNCONDITIONALLY, regardless of config.multiTenant
// (2026-07-24, audit-log feature) -- see docs/audit-log-design.md's
// Single-Tenant Persistence section. Every other table this db object
// serves (guilds, guild_roles, guild_settings, oauth_sessions,
// player_links) is only ever WRITTEN in multi-tenant-only code paths
// (onboarding.js, setupServer.js), so this has no behavioral effect on
// single-tenant deployments for anything except audit_log, which is the
// one table this feature specifically needs to work in BOTH modes --
// most real deployments of this bot are single-tenant, and an audit log
// that silently does nothing for the majority of installs would defeat
// the entire point of building one. dbPath still defaults to the same
// "data/acp.db" path either way (ACP_DB_PATH), so a single-tenant
// operator gains one new local SQLite file they didn't have before, with
// no other observable change to existing single-tenant behavior.
const db = createDatabase(config.dbPath);
initBotStats(db);
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

// steamLinkServer starts UNCONDITIONALLY, unlike setupServer above — see
// docs/steam-link-architecture.md's Single-Tenant Deployment Note. Most
// real deployments of this bot are single-tenant, and /dune player link's
// Steam-connections verification path (offered automatically for
// characters with a Steam ID on file) must work there too.
// config.steamLink.enabled (computed from whether a Discord OAuth client
// secret is configured at all) gates only whether the "Link via Steam"
// button is ever offered, not whether this server starts — the server
// itself is cheap to run idle and its /health route is useful either way.
const steamLinkApp = createSteamLinkServer({ config, adapterClient, client });
steamLinkApp.listen(config.steamLink.port, () => {
  logInfo("steam_link_server.started", { port: config.steamLink.port, enabled: config.steamLink.enabled });
});

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

// Audit log pruning: runs once at startup, then every 24 hours, matching
// statsPusher.js's setInterval+unref() convention for background
// maintenance tasks. 14-day retention -- see docs/audit-log-design.md's
// Retention section. unref() so this timer never keeps the process alive
// on its own during shutdown (same reasoning as every other timer in
// this file).
const AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
function pruneAuditLogNow() {
  const deleted = runAuditLogPruning(db);
  if (deleted > 0) logInfo("audit.pruned", { deleted });
}
pruneAuditLogNow();
const auditPruneTimer = setInterval(pruneAuditLogNow, AUDIT_PRUNE_INTERVAL_MS);
auditPruneTimer.unref?.();

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Closes a previously-total gap: this handler used to only ever check
    // isChatInputCommand?.() inside executeDuneCommand() and silently fall
    // through (return false) for anything else, including component
    // interactions. /dune player link's Steam-connections flow's "Sign in
    // with Discord" button is a Link-style component, which Discord's
    // client opens directly with NO interaction event sent to the bot at
    // all — so this branch doesn't need to do anything for that specific
    // button today.
    // It exists so (a) that fact is explicit and tested rather than
    // implicitly relying on "nothing happens to reach here," and (b) any
    // future non-Link-style component (a confirm/cancel button, a select
    // menu) has an obvious, already-wired place to add its own handling
    // rather than needing to discover and add this branch from scratch.
    if (interaction.isMessageComponent?.()) {
      return;
    }
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
    clearInterval(auditPruneTimer);
    if (db) db.close();
    await client.destroy();
    healthState.stop();
    process.exit(0);
  });
}

await client.login(config.discord.token);
