import { Client, Events, GatewayIntentBits } from "discord.js";
import { AdapterClient } from "./adapterClient.js";
import { createAnnouncementBridge, announcementConfig } from "./announcements.js";
import { executeDuneCommand } from "./commands.js";
import { loadRegistryAtStartup } from "./registryLoader.js";
import { loadConfig } from "./config.js";
import { startHealthState } from "./healthState.js";
import { logError, logInfo } from "./logger.js";
import { startScheduler, startDailyDigest } from "./scheduler.js";
import { alertSubscriber } from "./notifications.js";
import { createDatabase, getGuild, getGuildRoles, getGuildSettings } from "./database.js";
import { createSetupServer } from "./setupServer.js";
import { createSteamLinkServer } from "./steamLinkServer.js";
import { handleGuildCreate, handleGuildDelete } from "./onboarding.js";
import { startStatsPusher } from "./statsPusher.js";
import { handleWriteButtonInteraction } from "./writeConfirmation.js";
import { isEncryptionConfigured, checkSecretFilePermissions } from "./secretsCrypto.js";
import { proxySharedSecret } from "./proxyAuth.js";

const config = loadConfig();
const db = config.multiTenant ? createDatabase(config.dbPath) : null;

// Phase 3: Load command registry artifact at startup
// CRITICAL-2 FIX: Registry loading is mandatory - bot cannot function without it
try {
  loadRegistryAtStartup();
  logInfo("startup.registry_loaded", { stage: "configuration" });
} catch (error) {
  logError("startup.registry_load_failed", error, { fatal: true });
  console.error("[FATAL] Registry loading failed. Bot cannot start without command registry.");
  console.error(`Error: ${error.message}`);
  process.exit(1); // Fail startup explicitly
}
// In multi-tenant mode, guilds.adapter_token holds a live credential for
// every connected operator's Core adapter API in one shared SQLite file.
// secretsCrypto.js encrypts it transparently once ACP_SECRETS_KEY(_FILE)
// is set, but falls back to plaintext-compatible storage when it is not
// (see secretsCrypto.js's own module comment for why this is a soft
// warning rather than a hard startup failure). Surface it loudly here so
// a host operator notices at boot rather than discovering it during an
// incident.
if (config.multiTenant && db && !isEncryptionConfigured()) {
  logInfo("security.secrets_at_rest_unencrypted", {
    detail: "ACP_SECRETS_KEY/ACP_SECRETS_KEY_FILE is not set. Per-guild adapter tokens and " +
      "OAuth access tokens are being stored in plaintext in this bot's shared database. " +
      "See docs/security/multi-tenant-secrets-at-rest.md to generate and configure a key."
  });
}
// SEC-1 (issue #107): ACP_SECRETS_KEY as a direct env var is visible to
// any process that can read this process's /proc/<pid>/environ (or, on
// some hosts, `ps` output showing env for the invoking shell) --
// anyone with that access recovers the raw key, not just an encrypted
// value. The _FILE variant (already supported, see secretsCrypto.js's
// loadKey()) avoids this: the key lives in a file with restrictive
// permissions, never in this process's environment block at all. This
// is a warning, not a hard failure -- ACP_SECRETS_KEY continues to work
// exactly as before; deprecating it outright would break every existing
// deployment that has it set, and the KEK/DEK path (ACP_KEK_FILE) is
// itself always file-based and unaffected by this specific gap.
if (process.env.ACP_SECRETS_KEY) {
  logInfo("security.secrets_key_env_var_deprecated", {
    detail: "ACP_SECRETS_KEY is set as a direct environment variable, which is visible to any " +
      "process that can read /proc/<pid>/environ for this bot's PID. Switch to " +
      "ACP_SECRETS_KEY_FILE (pointing at a mode-0600 file containing the same key) to avoid " +
      "this exposure. See docs/security-secrets-at-rest.md."
  });
}
// SEC-4: startup file-permission check for every configured secret file
// this bot reads directly off disk. A loose permission (world- or
// group-readable) doesn't stop the bot from functioning -- unlike a
// wrong/missing key -- so this warns rather than refusing to start.
for (const [envVar, label] of [
  ["ACP_SECRETS_KEY_FILE", "ACP_SECRETS_KEY_FILE"],
  ["ACP_AGE_IDENTITY_FILE", "ACP_AGE_IDENTITY_FILE"],
  ["ACP_KEK_FILE", "ACP_KEK_FILE"],
  ["MENTAT_PROXY_SHARED_SECRET_FILE", "MENTAT_PROXY_SHARED_SECRET_FILE"]
]) {
  const path = process.env[envVar];
  if (path) checkSecretFilePermissions(path, label);
}

// mentat#283 (Security Architect + Cloud Security hat findings, Layer 2
// audit of PR #280): two loud, non-blocking startup warnings for
// MENTAT_PROXY_SHARED_SECRET, since a mistake here is either a silent
// no-op (weak secret) or a real production outage (wrong rollout order),
// neither of which should first be discovered during an incident.
{
  const proxySecret = proxySharedSecret();
  if (proxySecret) {
    if (proxySecret.length < 32) {
      logInfo("security.proxy_shared_secret_too_short", {
        detail: "MENTAT_PROXY_SHARED_SECRET is set but shorter than 32 characters. " +
          "mentat-backend.darkdante.org's hostname is discoverable via public Certificate " +
          "Transparency logs, so a short/guessable secret is brute-forceable once this is the " +
          "only thing standing between a direct request and the live setup/OAuth/Steam-link " +
          "endpoints. Generate a real random value, e.g. `openssl rand -hex 32` -- and never " +
          "paste it into a chat session (see compliance/evidence/incidents/" +
          "2026-09-06-discord-bot-token-chat-exposure.md for why that matters)."
      });
    }
    logInfo("security.proxy_shared_secret_enforcement_active", {
      detail: "MENTAT_PROXY_SHARED_SECRET is configured -- every request to the gated routes on " +
        "this process now requires a matching X-Mentat-Proxy-Secret header. Confirm the SAME " +
        "value is already set on the mentat-link Pages project BEFORE this deploy reaches " +
        "production, not after: enabling this here first (backend before client) rejects every " +
        "legitimate request through the proxy until the client side catches up, which is a real " +
        "self-inflicted outage, not just a safe no-op."
    });
  }
}
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
let dailyDigest = { active: false, stop() {} };
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
    const populationTimer = setInterval(() => alertSub.checkPopulation(), alertIntervalMs);
    const spiceTimer = setInterval(() => alertSub.checkSpiceFields(), alertIntervalMs);
    const dbHealthTimer = setInterval(() => alertSub.checkDbHealth(), alertIntervalMs);
    const bridgeTimer = setInterval(() => alertSub.checkBridgeErrors(), alertIntervalMs);
    readinessTimer.unref?.();
    servicesTimer.unref?.();
    populationTimer.unref?.();
    spiceTimer.unref?.();
    dbHealthTimer.unref?.();
    bridgeTimer.unref?.();

    alerts = {
      active: true,
      stop() {
        clearInterval(readinessTimer);
        clearInterval(servicesTimer);
        clearInterval(populationTimer);
        clearInterval(spiceTimer);
        clearInterval(dbHealthTimer);
        clearInterval(bridgeTimer);
      }
    };

    logInfo("alerts.started", {
      channel: alertChannelId,
      intervalMs: alertIntervalMs
    });
  }

  const digestChannelId = process.env.DUNE_DIGEST_CHANNEL_ID || alertChannelId;
  if (digestChannelId) {
    const digestHour = Number.parseInt(process.env.DUNE_DIGEST_HOUR || "8", 10) || 8;
    dailyDigest = startDailyDigest({
      adapterClient,
      client,
      channelId: digestChannelId,
      hour: digestHour,
      consoleDashboardUrl: config.consoleDashboardUrl,
      grafanaDashboardUrl: config.grafanaDashboardUrl,
      onError: (error) => logError("digest.failed", error)
    });
    if (dailyDigest.active) {
      logInfo("digest.started", { channel: digestChannelId, hour: digestHour });
    }
  }

  statsPusher = startStatsPusher({ client, db, adapterClient });
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Write-confirmation buttons (confirm/cancel/timeout) are real,
    // handled component interactions -- route them first.
    if (interaction.isButton?.()) {
      await handleWriteButtonInteraction(interaction);
      return;
    }
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
    dailyDigest.stop();
    statsPusher.stop();
    if (db) db.close();
    await client.destroy();
    healthState.stop();
    process.exit(0);
  });
}

await client.login(config.discord.token);
