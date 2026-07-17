import { SlashCommandBuilder } from "discord.js";
import { checkCooldown, applyCooldown, cooldownStats } from "./cooldown.js";
import { executeBroadcast, sendBroadcastToAdapter } from "./broadcast.js";
import { formatError, formatPayload } from "./format.js";
import { formatHealthEmbed, formatPingEmbed, formatStatusEmbed, formatPopulationEmbed, formatBackupsEmbed, formatGenericEmbed, formatDoctorEmbed, formatMapsEmbed, formatCooldownsEmbed, formatLatencyEmbed, formatEventsEmbed, formatStatusDetailEmbed, formatReadinessDetailEmbed, formatServicesDetailEmbed, formatMaintenanceEmbed, formatServersEmbed, formatPortsEmbed, formatDbEmbed, formatSetupEmbed, formatInventoryEmbed, formatStorageEmbed, formatFindEmbed, formatLinkEmbed, formatUnlinkEmbed, formatWhoamiEmbed } from "./embedFormat.js";
import { sendStatusCard } from "./statusCard.js";
import { handleWriteCommand } from "./writeHandler.js";
import { writesEnabled } from "./writes.js";
import { OPS_SUBCOMMAND_NAMES, opsRouteFor, formatOpsPayload, opsDescriptionFor } from "./opsCommands.js";
import { getLatencyHistory } from "./adapterClient.js";
import { getIncidentHistory } from "./scheduler.js";

// Group -> subcommand -> handler config
// Each group can have up to 25 subcommands; we have 6 groups with room for many more.

export function buildDuneCommand({ includeWriteGroup = false } = {}) {
  const builder = new SlashCommandBuilder()
    .setName("dune")
    .setDescription("Dune server operations and observability.")

    // ── core group ──
    .addSubcommandGroup((g) => g.setName("core").setDescription("Bot information and help.")
      .addSubcommand((c) => c.setName("about").setDescription("Show safe bot and adapter metadata."))
      .addSubcommand((c) => c.setName("ping").setDescription("Measure Discord and adapter latency."))
      .addSubcommand((c) => c.setName("help").setDescription("Show available commands for your role."))
      .addSubcommand((c) => c.setName("setup").setDescription("How to add this bot to your own Discord server.")))

    // ── server group ──
    .addSubcommandGroup((g) => g.setName("server").setDescription("Server health, status, and services.")
      .addSubcommand((c) => c.setName("health").setDescription("Check the console Discord adapter."))
      .addSubcommand((c) => c.setName("status").setDescription("Show high-level server status.")
        .addBooleanOption((o) => o.setName("diagnostic").setDescription("Admin-only: full diagnostic with containers table.")))
      .addSubcommand((c) => c.setName("summary").setDescription("Show compact aggregate server status."))
      .addSubcommand((c) => c.setName("readiness").setDescription("Show readiness and preflight state.")
        .addBooleanOption((o) => o.setName("diagnostic").setDescription("Admin-only: detailed readiness checks.")))
      .addSubcommand((c) => c.setName("readiness-detail").setDescription("Show grouped readiness detail with issues."))
      .addSubcommand((c) => c.setName("services").setDescription("Show service container state."))
      .addSubcommand((c) => c.setName("services-detail").setDescription("Show detailed service state with logs.")))

    // ── data group ──
    .addSubcommandGroup((g) => g.setName("data").setDescription("Server population, backups, map, inventory, and storage.")
      .addSubcommand((c) => c.setName("population").setDescription("Show aggregate player count and server population."))
      .addSubcommand((c) => c.setName("backups").setDescription("List recent backup metadata (read-only)."))
      .addSubcommand((c) => c.setName("maps").setDescription("Show active game maps with state and uptime."))
      .addSubcommand((c) => c.setName("maintenance").setDescription("Show maintenance window metadata (read-only)."))
      .addSubcommand((c) => c.setName("link").setDescription("Link your Discord to your game character.")
        .addStringOption((o) => o.setName("character").setDescription("Your character name").setRequired(true)))
      .addSubcommand((c) => c.setName("unlink").setDescription("Unlink your Discord from your game character."))
      .addSubcommand((c) => c.setName("faction").setDescription("Set your faction for themed embeds.")
        .addStringOption((o) => o.setName("name").setDescription("atreides, harkonnen, or fremen").setRequired(true)
          .addChoices({ name: "Atreides", value: "atreides" }, { name: "Harkonnen", value: "harkonnen" }, { name: "Fremen", value: "fremen" })))
      .addSubcommand((c) => c.setName("whoami").setDescription("Show your linked game character info."))
      .addSubcommand((c) => c.setName("inventory").setDescription("View your personal inventory.")
        .addStringOption((o) => o.setName("search").setDescription("Filter by item name (optional)")))
      .addSubcommand((c) => c.setName("storage").setDescription("View your storage containers grouped by map.")
        .addStringOption((o) => o.setName("scope").setDescription("owned (default), guild, or all (admin)")
          .addChoices({ name: "owned", value: "owned" }, { name: "guild", value: "guild" })))
      .addSubcommand((c) => c.setName("find").setDescription("Search for items across your containers.")
        .addStringOption((o) => o.setName("query").setDescription("Item name to search for").setRequired(true))
        .addStringOption((o) => o.setName("scope").setDescription("owned (default), guild, or all (admin)")
          .addChoices({ name: "owned", value: "owned" }, { name: "guild", value: "guild" }))))

    // ── ops group ──
    .addSubcommandGroup((g) => g.setName("ops").setDescription("Operational observability from the OPS addon.")
      .addSubcommand((c) => c.setName("activity").setDescription(opsDescriptionFor("activity")))
      .addSubcommand((c) => c.setName("combat").setDescription(opsDescriptionFor("combat")))
      .addSubcommand((c) => c.setName("resources").setDescription(opsDescriptionFor("resources")))
      .addSubcommand((c) => c.setName("economy").setDescription(opsDescriptionFor("economy")))
      .addSubcommand((c) => c.setName("inventory").setDescription(opsDescriptionFor("inventory")))
      .addSubcommand((c) => c.setName("location").setDescription(opsDescriptionFor("location")))
      .addSubcommand((c) => c.setName("soc").setDescription(opsDescriptionFor("soc")))
      .addSubcommand((c) => c.setName("prometheus").setDescription(opsDescriptionFor("prometheus")))
      .addSubcommand((c) => c.setName("dashboard").setDescription(opsDescriptionFor("dashboard"))))

    // ── admin group ──
    .addSubcommandGroup((g) => g.setName("admin").setDescription("Admin-only diagnostics and management.")
      .addSubcommand((c) => c.setName("doctor").setDescription("Comprehensive system diagnostic across all subsystems."))
      .addSubcommand((c) => c.setName("cooldowns").setDescription("Show active command cooldowns."))
      .addSubcommand((c) => c.setName("latency").setDescription("Show adapter request latency history."))
      .addSubcommand((c) => c.setName("events").setDescription("Show recent server incidents and events."))
      .addSubcommand((c) => c.setName("broadcast").setDescription("Send a message to all in-game players (moderator+).")
        .addStringOption((o) => o.setName("message").setDescription("Message to broadcast").setRequired(true).setMaxLength(500))))

    // ── infra group ──
    .addSubcommandGroup((g) => g.setName("infra").setDescription("Infrastructure: version, ports, servers, database.")
      .addSubcommand((c) => c.setName("version").setDescription("Show Dune stack version."))
      .addSubcommand((c) => c.setName("servers").setDescription("List game servers."))
      .addSubcommand((c) => c.setName("ports").setDescription("Show network port and listener status."))
      .addSubcommand((c) => c.setName("db").setDescription("Show database status and health.")));

  // ── write group ── conditionally appended, requires DUNE_DISCORD_WRITES_ENABLED=true
  if (includeWriteGroup) {
    builder.addSubcommandGroup((g) =>
      g.setName("write").setDescription("Write commands — gated behind DUNE_DISCORD_WRITES_ENABLED.")
        .addSubcommand((c) => c.setName("maintenance-note").setDescription("Set a maintenance note.")
          .addStringOption((o) => o.setName("note").setDescription("Maintenance note text").setRequired(true).setMaxLength(500)))
        .addSubcommand((c) => c.setName("maintenance-window").setDescription("Set a maintenance window.")
          .addStringOption((o) => o.setName("start").setDescription("Start time (ISO 8601)").setRequired(true))
          .addIntegerOption((o) => o.setName("duration").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(1440)))
        .addSubcommand((c) => c.setName("alert-channel").setDescription("Set alert notification channel.")
          .addStringOption((o) => o.setName("channel").setDescription("Discord channel ID").setRequired(true)))
        .addSubcommand((c) => c.setName("alert-threshold").setDescription("Set alert thresholds.")
          .addStringOption((o) => o.setName("metric").setDescription("Metric").setRequired(true))
          .addStringOption((o) => o.setName("condition").setDescription("Condition (lt/gt/eq)").setRequired(true))
          .addIntegerOption((o) => o.setName("value").setDescription("Threshold value").setRequired(true)))
        .addSubcommand((c) => c.setName("digest-schedule").setDescription("Set digest schedule interval.")
          .addIntegerOption((o) => o.setName("minutes").setDescription("Interval in minutes").setRequired(true).setMinValue(5).setMaxValue(1440)))
        .addSubcommand((c) => c.setName("post-schedule").setDescription("Set scheduled post type.")
          .addStringOption((o) => o.setName("type").setDescription("status/status-summary/readiness/services/none").setRequired(true)))
        .addSubcommand((c) => c.setName("add-channel").setDescription("Add channel for scheduled posts.")
          .addStringOption((o) => o.setName("channel").setDescription("Discord channel ID").setRequired(true)))
        .addSubcommand((c) => c.setName("remove-channel").setDescription("Remove channel from scheduled posts.")
          .addStringOption((o) => o.setName("channel").setDescription("Discord channel ID").setRequired(true)))
        .addSubcommand((c) => c.setName("backup").setDescription("Create a database backup.")
          .addStringOption((o) => o.setName("label").setDescription("Backup label").setRequired(true).setMaxLength(100)))
        .addSubcommand((c) => c.setName("restart").setDescription("Restart a game service.")
          .addStringOption((o) => o.setName("service").setDescription("Service name").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("Reason for restart").setRequired(true).setMaxLength(200)))
        .addSubcommand((c) => c.setName("update").setDescription("Trigger a game or server update.")
          .addStringOption((o) => o.setName("type").setDescription("Update type (game/steamcmd/self)").setRequired(true)))
        .addSubcommand((c) => c.setName("cache").setDescription("Clear server caches.")
          .addStringOption((o) => o.setName("type").setDescription("Cache type (steam/maps/derived)").setRequired(true))));
  }

  return builder;
}

export function commandDefinitions({ includeWriteGroup = false } = {}) {
  return [buildDuneCommand({ includeWriteGroup }).toJSON()];
}

export async function executeDuneCommand(interaction, adapterClient, config) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "dune") return false;

  const group = interaction.options.getSubcommandGroup() || "";
  const subcommand = interaction.options.getSubcommand();
  const key = group ? `${group}:${subcommand}` : subcommand;

  if (!isCommandAllowed(interaction, key, config.discord.rbac)) {
    await interaction.reply({ content: "You are not authorized to use this command.", ephemeral: true });
    return true;
  }

  const cooldown = checkCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
  if (!cooldown.allowed) {
    const secs = Math.ceil(cooldown.remainingMs / 1000);
    await interaction.reply({ content: `Please wait ${secs}s before using this command again.`, ephemeral: true });
    return true;
  }

  const diagnostic = interaction.options.getBoolean("diagnostic") || false;
  if (diagnostic && !isAdminActor(interaction, config)) {
    await interaction.reply({ content: "Diagnostic mode requires admin or owner role.", ephemeral: true });
    return true;
  }

  const startedAt = Date.now();
  const actor = actorFromInteraction(interaction);
  await interaction.deferReply({ ephemeral: config.discord.defaultEphemeral });
  const deferReplyMs = elapsedMs(startedAt);

  try {
    let payload;
    // ── core group ──
    if (key === "core:about") {
      payload = aboutPayload(config);
    } else if (key === "core:ping") {
      payload = await pingPayload(adapterClient, actor, deferReplyMs);
    } else if (key === "core:help") {
      payload = helpPayload(config, interaction);
    } else if (key === "core:setup") {
      payload = setupPayload(config, interaction);
    }
    // ── server group ──
    else if (key === "server:health") {
      payload = await adapterClient.health(actor);
    } else if (key === "server:status") {
      payload = await adapterClient.status(actor, diagnostic);
      if (!diagnostic) {
        const statusData = payload?.result || payload || {};
        await sendStatusCard({ interaction, statusData: payload, title: statusData.title, adapterClient });
        applyCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
        return true;
      }
    } else if (key === "server:summary") {
      payload = statusSummaryPayload(await adapterClient.status(actor));
    } else if (key === "server:readiness") {
      payload = await adapterClient.readiness(actor, diagnostic);
    } else if (key === "server:readiness-detail") {
      payload = await adapterClient.readiness(actor, true);
    } else if (key === "server:services") {
      payload = await adapterClient.services(actor);
    } else if (key === "server:services-detail") {
      const services = await adapterClient.services(actor);
      const logs = await adapterClient.logs(actor);
      const mapState = await adapterClient.mapState(actor);
      payload = { services, logs, mapState };
    }
    // ── data group ──
    else if (key === "data:population") {
      payload = populationPayload(await adapterClient.population(actor));
    } else if (key === "data:backups") {
      payload = backupPayload(await adapterClient.backups(actor));
    } else if (key === "data:maps") {
      const status = await adapterClient.status(actor);
      payload = { maps: status?.result?.maps || [] };
    } else if (key === "data:maintenance") {
      payload = await adapterClient.maintenance(actor);
    }
    else if (key === "data:link") {
      const characterName = interaction.options.getString("character");
      payload = await adapterClient.playerLink(actor, characterName);
    } else if (key === "data:unlink") {
      payload = await adapterClient.playerUnlink(actor);
    } else if (key === "data:faction") {
      const faction = interaction.options.getString("name");
      payload = await adapterClient.playerFaction(actor, faction);
    } else if (key === "data:whoami") {
      payload = await adapterClient.whoami(actor);
    } else if (key === "data:inventory") {
      const search = interaction.options.getString("search");
      if (search) {
        payload = await adapterClient.playerInventorySearch(actor, search);
      } else {
        payload = await adapterClient.playerInventory(actor);
      }
    } else if (key === "data:storage") {
      const scope = interaction.options.getString("scope") || "owned";
      payload = await adapterClient.playerStorage(actor, scope);
    } else if (key === "data:find") {
      const query = interaction.options.getString("query");
      const scope = interaction.options.getString("scope") || "owned";
      payload = await adapterClient.playerFind(actor, query, scope);
    }
    // ── ops group ──
    else if (OPS_SUBCOMMAND_NAMES.includes(subcommand)) {
      const route = opsRouteFor(subcommand);
      if (route) {
        const methodName = route.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        payload = formatOpsPayload(subcommand, await adapterClient[methodName](actor));
      } else {
        payload = { ok: false, error: `Unknown OPS command: ${subcommand}` };
      }
    }
    // ── admin group ──
    else if (key === "admin:doctor") {
      if (!isAdminActor(interaction, config)) throw new Error("Doctor diagnostic requires admin or owner role.");
      payload = await doctorPayload(adapterClient, actor, config);
    } else if (key === "admin:cooldowns") {
      if (!isAdminActor(interaction, config)) throw new Error("Cooldowns viewer requires admin or owner role.");
      payload = cooldownStats();
    } else if (key === "admin:latency") {
      payload = getLatencyHistory();
    } else if (key === "admin:events") {
      payload = getIncidentHistory();
    } else if (key === "admin:broadcast") {
      const msg = interaction.options.getString("message");
      const result = await executeBroadcast({ interaction, adapterClient, config, userRequest: msg });
      if (result.ok && result.needsConfirmation) {
        payload = { ok: true, action: "broadcast", message: result.message, idempotencyKey: result.idempotencyKey, confirmation: result.confirmationMessage };
      } else {
        payload = result;
      }
    }
    // ── infra group ──
    else if (key === "infra:version") {
      payload = await adapterClient.version(actor);
    } else if (key === "infra:servers") {
      payload = await adapterClient.servers(actor);
    } else if (key === "infra:ports") {
      payload = await adapterClient.ports(actor);
    } else if (key === "infra:db") {
      payload = await adapterClient.db(actor);
    }
    // ── write group ──
    else if (group === "write") {
      payload = await handleWriteCommand({ subcommand, interaction, adapterClient, config });
    }
    else {
      payload = { ok: false, error: `Unknown command: ${key}` };
    }

    // ── Embed selection ──
    let embed;
    if (subcommand === "about") {
      embed = formatGenericEmbed(payload, "about");
    } else if (subcommand === "setup") {
      embed = formatSetupEmbed(payload);
    } else if (subcommand === "ping") {
      embed = formatPingEmbed(payload);
    } else if (subcommand === "health") {
      embed = formatHealthEmbed(payload);
    } else if (subcommand === "status") {
      embed = diagnostic ? formatStatusDetailEmbed(payload) : formatStatusEmbed(payload, "status");
    } else if (subcommand === "summary") {
      embed = formatStatusEmbed(payload, "summary");
    } else if (subcommand === "readiness") {
      embed = diagnostic ? formatReadinessDetailEmbed(payload) : formatGenericEmbed(payload, "readiness");
    } else if (subcommand === "readiness-detail") {
      embed = formatReadinessDetailEmbed(payload);
    } else if (subcommand === "services-detail") {
      embed = formatServicesDetailEmbed(payload);
    } else if (subcommand === "maintenance") {
      embed = formatMaintenanceEmbed(payload);
    } else if (subcommand === "population") {
      embed = formatPopulationEmbed(payload);
    } else if (subcommand === "backups") {
      embed = formatBackupsEmbed(payload);
    } else if (subcommand === "maps") {
      embed = formatMapsEmbed(payload);
    } else if (subcommand === "link") {
      embed = formatLinkEmbed(payload);
    } else if (subcommand === "unlink") {
      embed = formatUnlinkEmbed(payload);
    } else if (subcommand === "whoami") {
      embed = formatWhoamiEmbed(payload);
    } else if (subcommand === "inventory") {
      embed = formatInventoryEmbed(payload);
    } else if (subcommand === "storage") {
      embed = formatStorageEmbed(payload);
    } else if (subcommand === "find") {
      embed = formatFindEmbed(payload);
    } else if (subcommand === "doctor") {
      embed = formatDoctorEmbed(payload);
    } else if (subcommand === "cooldowns") {
      embed = formatCooldownsEmbed(payload);
    } else if (subcommand === "latency") {
      embed = formatLatencyEmbed(payload);
    } else if (subcommand === "events") {
      embed = formatEventsEmbed(payload);
    } else if (subcommand === "servers") {
      embed = formatServersEmbed(payload);
    } else if (subcommand === "ports") {
      embed = formatPortsEmbed(payload);
    } else if (subcommand === "db") {
      embed = formatDbEmbed(payload);
    } else {
      embed = formatGenericEmbed(payload, subcommand);
    }

    if (embed) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.editReply(formatPayload(`Dune ${key}`, payload));
    }
  } catch (error) {
    await interaction.editReply(formatError(error));
  }

  applyCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
  return true;
}

// ── Actor ──
export function actorFromInteraction(interaction) {
  return {
    userId: interaction.user?.id,
    username: interaction.user?.username || interaction.user?.displayName || "unknown",
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    roleIds: extractRoleIds(interaction)
  };
}

// ── RBAC ──
export function isCommandAllowed(interaction, command, rbac) {
  if (rbac.mode === "open") return true;
  if (rbac.allowedUserIds?.includes(interaction.user?.id)) return true;
  const roleIds = new Set(extractRoleIds(interaction));
  const cmdRoles = rbac?.commandRoleIds?.[command];
  if (cmdRoles && cmdRoles.length > 0) return cmdRoles.some((roleId) => roleIds.has(roleId));
  const allKnown = new Set([...(rbac?.observerRoleIds || []), ...(rbac?.adminRoleIds || [])]);
  return allKnown.size > 0 && [...roleIds].some((r) => allKnown.has(r));
}

export function extractRoleIds(interaction) {
  const roles = interaction.member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles.map(String);
  if (roles.cache?.keys) return [...roles.cache.keys()];
  if (roles instanceof Set) return [...roles].map(String);
  return [];
}

// ── Helpers ──
function isAdminActor(interaction, config) {
  const roleIds = extractRoleIds(interaction);
  const adminRoles = new Set([
    ...parseCsv(process.env.DISCORD_ADMIN_ROLE_IDS),
    ...parseCsv(process.env.DISCORD_WRITE_ADMIN_ROLE_IDS),
    ...parseCsv(process.env.DISCORD_WRITE_OWNER_ROLE_IDS),
    ...(Array.isArray(config?.discord?.rbac?.adminRoleIds) ? config.discord.rbac.adminRoleIds : [])
  ]);
  const allowedUsers = new Set(parseCsv(process.env.DISCORD_ALLOWED_USER_IDS));
  return roleIds.some((r) => adminRoles.has(r)) || allowedUsers.has(interaction?.user?.id);
}

function parseCsv(value) { return String(value || "").split(",").map(s => s.trim()).filter(Boolean); }
function elapsedMs(startedAt) { const d = Date.now() - startedAt; return Number.isFinite(d) && d > 0 ? Math.round(d) : 0; }
function adapterOrigin(baseUrl) { return new URL(baseUrl).origin; }

// ── Payload formatters ──
export async function pingPayload(adapterClient, actor, deferReplyMs = 0) {
  const startedAt = Date.now();
  const health = await adapterClient.health(actor);
  return {
    ok: health?.ok === true,
    discord: { deferReplyMs: elapsedMs(startedAt) },
    adapter: { route: "health", roundTripMs: 0, ok: health?.ok === true, enabled: health?.enabled === true, readOnly: health?.readOnly === true, writesEnabled: health?.writesEnabled === true }
  };
}

export function statusSummaryPayload(status) {
  const s = status?.result?.summary || {};
  return { ok: status?.ok === true, overall: s.overall || "UNKNOWN", region: s.region || "unknown", mode: s.mode || "unknown", population: s.population || "unknown", automation: { autoscaler: s.automation?.autoscaler || "unknown", autoUpdates: s.automation?.autoUpdates || "unknown" } };
}

export function aboutPayload(config) {
  return { ok: true, bot: { name: "dune-awakening-selfhost-discordbot", version: "1.5.0", readOnly: true, writesEnabled: false }, adapter: { origin: new URL(config.adapter.baseUrl).origin, timeoutMs: config.adapter.timeoutMs }, discord: { rbacMode: config.discord.rbac.mode, defaultEphemeral: config.discord.defaultEphemeral }, boundary: { dockerSocket: false, databaseDirect: false, gameFiles: false, shellCommands: false } };
}

export function populationPayload(p) { const r = p?.result || {}; return { ok: p?.ok === true, online: r.onlinePlayers ?? "unknown", total: r.totalPlayers ?? "unknown", aggregate: r.aggregate ?? true, detailsSuppressed: r.detailsSuppressed ?? true }; }

export function backupPayload(b) { const list = Array.isArray(b?.result?.backups) ? b.result.backups.slice(0, 10) : []; return { ok: b?.ok === true, count: list.length, backups: list.map(x => ({ name: x.name || "unknown", date: x.date || x.createdAt || "unknown", size: x.size || "unknown" })) }; }

function setupPayload(config, interaction) {
  const clientId = process.env.DISCORD_CLIENT_ID || config?.discord?.clientId || "";
  const guildId = interaction?.guildId || "";
  const inviteUrl = clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands`
    : "*(Client ID not configured — ask the bot host for the invite link)*";
  return { ok: true, clientId, guildId, inviteUrl };
}

function helpPayload(config, interaction) {
  const all = [
    { name: "core:about", desc: "Show safe bot and adapter metadata.", role: "observer" },
    { name: "core:ping", desc: "Measure Discord and adapter latency.", role: "observer" },
    { name: "core:help", desc: "Show available commands for your role.", role: "observer" },
    { name: "core:setup", desc: "How to add this bot to your own Discord server.", role: "observer" },
    { name: "server:health", desc: "Check the console Discord adapter.", role: "observer" },
    { name: "server:status", desc: "Show high-level server status.", role: "observer" },
    { name: "server:summary", desc: "Show compact aggregate server status.", role: "observer" },
    { name: "server:readiness", desc: "Show readiness and preflight state.", role: "observer" },
    { name: "server:services", desc: "Show service container state.", role: "observer" },
    { name: "data:population", desc: "Show aggregate player count.", role: "observer" },
    { name: "data:backups", desc: "List recent backup metadata.", role: "observer" },
    { name: "data:maps", desc: "Show active game maps.", role: "observer" },
    { name: "ops:activity", desc: opsDescriptionFor("activity"), role: "observer" },
    { name: "ops:combat", desc: opsDescriptionFor("combat"), role: "observer" },
    { name: "ops:resources", desc: opsDescriptionFor("resources"), role: "observer" },
    { name: "ops:economy", desc: opsDescriptionFor("economy"), role: "observer" },
    { name: "ops:inventory", desc: opsDescriptionFor("inventory"), role: "observer" },
    { name: "ops:location", desc: opsDescriptionFor("location"), role: "observer" },
    { name: "ops:soc", desc: opsDescriptionFor("soc"), role: "observer" },
    { name: "ops:prometheus", desc: opsDescriptionFor("prometheus"), role: "observer" },
    { name: "ops:dashboard", desc: opsDescriptionFor("dashboard"), role: "observer" },
    { name: "admin:doctor", desc: "Comprehensive system diagnostic.", role: "admin" },
    { name: "admin:cooldowns", desc: "Show active cooldowns.", role: "admin" },
    { name: "admin:latency", desc: "Adapter latency history.", role: "admin" },
    { name: "admin:events", desc: "Recent incident log.", role: "admin" },
    { name: "admin:broadcast", desc: "Send a message to all players.", role: "admin" },
    { name: "infra:version", desc: "Dune stack version.", role: "observer" },
    { name: "infra:servers", desc: "List game servers.", role: "observer" },
    { name: "infra:ports", desc: "Network port status.", role: "observer" },
    { name: "infra:db", desc: "Database status and health.", role: "observer" },
  ];
  const available = []; const locked = [];
  for (const cmd of all) {
    if (isCommandAllowed(interaction, cmd.name, config.discord.rbac)) available.push(cmd); else locked.push(cmd);
  }
  return { ok: true, total: all.length, available: available.map(c => c.name), locked: locked.map(c => c.name), availableCount: available.length, rbacMode: config.discord.rbac.mode };
}

async function doctorPayload(adapterClient, actor, config) {
  const [health, status, readiness, services] = await Promise.all([
    adapterClient.health(actor).catch(() => ({ ok: false })),
    adapterClient.status(actor).catch(() => ({ ok: false })),
    adapterClient.readiness(actor).catch(() => ({ ok: false })),
    adapterClient.services(actor).catch(() => ({ ok: false }))
  ]);
  return { ok: health?.ok !== false && status?.ok !== false, health: { ok: health?.ok === true, enabled: health?.enabled, readOnly: health?.readOnly, writesEnabled: health?.writesEnabled }, status: { ok: status?.ok === true, summary: status?.result?.summary || {} }, readiness: { ok: readiness?.ok === true, ready: readiness?.result?.ready, issues: readiness?.result?.issues || [] }, services: { ok: services?.ok === true, overall: services?.result?.overall, count: (services?.result?.services || []).length }, timestamp: new Date().toISOString() };
}
export function requiredRoleIdsForCommand(command, rbac) { return rbac?.commandRoleIds?.[command] || []; }
