import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgVersion = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version;
import { checkCooldown, applyCooldown, cooldownStats } from "./cooldown.js";
import { executeBroadcast, sendBroadcastToAdapter } from "./broadcast.js";
import { formatError, formatPayload, redactSecrets } from "./format.js";
import { formatHealthEmbed, formatPingEmbed, formatStatusEmbed, formatPopulationEmbed, formatBackupsEmbed, formatGenericEmbed, formatDoctorEmbed, formatMapsEmbed, formatCooldownsEmbed, formatLatencyEmbed, formatEventsEmbed, formatStatusDetailEmbed, formatReadinessDetailEmbed, formatServicesDetailEmbed, formatMaintenanceEmbed, formatServersEmbed, formatPortsEmbed, formatDbEmbed, formatSetupEmbed, formatInventoryEmbed, formatStorageEmbed, formatFindEmbed, formatLinkEmbed, formatUnlinkEmbed, formatWhoamiEmbed, formatActivityEmbed, formatCombatEmbed, formatResourcesEmbed, formatEconomyEmbed, formatOpsInventoryEmbed, formatLocationEmbed, formatSocEmbed, formatPrometheusEmbed, formatDashboardEmbed, formatAnnouncementsEmbed } from "./embedFormat.js";
import { sendStatusCard, sendOpsCard } from "./statusCard.js";
import { handleWriteCommand } from "./writeHandler.js";
import { writesEnabled } from "./writes.js";
import { OPS_SUBCOMMAND_NAMES, opsRouteFor, formatOpsPayload, opsDescriptionFor } from "./opsCommands.js";
import { getLatencyHistory, isRouteMissing, routeStatus, UNMERGED_ROUTES } from "./adapterClient.js";
import { getIncidentHistory } from "./scheduler.js";
import { getGuildRoles, getGuildSettings, incrementCommandCount, getGuildFaction } from "./database.js";
import { createSteamLinkSession } from "./steamLinkStore.js";

// Group -> subcommand -> handler config
// Each group can have up to 25 subcommands; a top-level command can have up
// to 25 subcommand groups. We have 8 non-write groups (9 with write
// enabled) with room for many more.
//
// player group split out of data (2026-07-24): identity/linking commands
// (link, verify, characters, enable, disable, default, unlink, faction,
// whoami) were originally under data, which had grown to 15/25 subcommands
// by mixing three unrelated concerns (identity/linking, inventory/storage,
// server/world data). Moved to their own top-level group so both groups
// have headroom and a coherent purpose. This was a deliberate, documented
// breaking rename -- see docs/steam-link-design.md's "Scope Addition"
// section and docs/changes/ for the full old-to-new command mapping.

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
      .addSubcommand((c) => c.setName("inventory").setDescription("View your personal inventory.")
        .addStringOption((o) => o.setName("search").setDescription("Filter by item name (optional)")))
      .addSubcommand((c) => c.setName("storage").setDescription("View your storage containers grouped by map.")
        .addStringOption((o) => o.setName("scope").setDescription("owned (default), guild, or all (admin)")
          .addChoices({ name: "owned", value: "owned" }, { name: "guild", value: "guild" })))
      .addSubcommand((c) => c.setName("find").setDescription("Search for items across your containers.")
        .addStringOption((o) => o.setName("query").setDescription("Item name to search for").setRequired(true))
        .addStringOption((o) => o.setName("scope").setDescription("owned (default), guild, or all (admin)")
          .addChoices({ name: "owned", value: "owned" }, { name: "guild", value: "guild" }))))

    // ── player group ──
    // Split out of data (see the block comment above buildDuneCommand()).
    .addSubcommandGroup((g) => g.setName("player").setDescription("Link your Discord to your game character, and manage linked characters.")
      .addSubcommand((c) => c.setName("link").setDescription("Link your Discord to your game character.")
        .addStringOption((o) => o.setName("character").setDescription("Your character name").setRequired(true)))
      .addSubcommand((c) => c.setName("verify").setDescription("Verify a pending character link with a code.")
        .addStringOption((o) => o.setName("code").setDescription("Verification code from in-game whisper").setRequired(true)))
      .addSubcommand((c) => c.setName("characters").setDescription("List your verified characters."))
      .addSubcommand((c) => c.setName("enable").setDescription("Enable a character in this guild.")
        .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
      .addSubcommand((c) => c.setName("disable").setDescription("Disable a character in this guild.")
        .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
      .addSubcommand((c) => c.setName("default").setDescription("Set your default character for this guild.")
        .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
      .addSubcommand((c) => c.setName("unlink").setDescription("Unlink a character from your Discord.")
        .addStringOption((o) => o.setName("character").setDescription("Character link ID").setRequired(true)))
      .addSubcommand((c) => c.setName("faction").setDescription("Set your faction for themed embeds.")
        .addStringOption((o) => o.setName("name").setDescription("atreides, harkonnen, or fremen").setRequired(true)
          .addChoices({ name: "Atreides", value: "atreides" }, { name: "Harkonnen", value: "harkonnen" }, { name: "Fremen", value: "fremen" })))
      .addSubcommand((c) => c.setName("whoami").setDescription("Show your linked game character info.")))

    // ── logs group ──
    .addSubcommandGroup((g) => g.setName("logs").setDescription("View logs from specific game services.")
      .addSubcommand((c) => c.setName("dune-cache").setDescription("Show dune-cache container logs."))
      .addSubcommand((c) => c.setName("dune-generated").setDescription("Show dune-generated container logs."))
      .addSubcommand((c) => c.setName("dune-server").setDescription("Show dune-server container logs."))
      .addSubcommand((c) => c.setName("dune-steam").setDescription("Show dune-steam container logs."))
      .addSubcommand((c) => c.setName("dune-work").setDescription("Show dune-work container logs."))
      .addSubcommand((c) => c.setName("orchestrator").setDescription("Show orchestrator container logs."))
      .addSubcommand((c) => c.setName("redblink-dune-docker-console").setDescription("Show console adapter logs.")))

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
      .addSubcommand((c) => c.setName("dashboard").setDescription(opsDescriptionFor("dashboard")))
      .addSubcommand((c) => c.setName("announcements").setDescription(opsDescriptionFor("announcements"))))

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

export async function executeDuneCommand(interaction, adapterClient, config, db = null) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "dune") return false;

  const group = interaction.options.getSubcommandGroup() || "";
  const subcommand = interaction.options.getSubcommand();
  const key = group ? `${group}:${subcommand}` : subcommand;
  const guildId = interaction.guildId;

  if (!isCommandAllowed(interaction, key, config, db, guildId)) {
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
  if (diagnostic && !isAdminActor(interaction, config, db, guildId)) {
    await interaction.reply({ content: "Diagnostic mode requires admin or owner role.", ephemeral: true });
    return true;
  }

  const startedAt = Date.now();
  const actor = actorFromInteraction(interaction);
  if (db) incrementCommandCount(db);
  await interaction.deferReply({ ephemeral: config.discord.defaultEphemeral });
  const deferReplyMs = elapsedMs(startedAt);

  try {
    let payload;
    // ── core group ──
    if (key === "core:about") {
      payload = aboutPayload(config);
    } else if (key === "core:ping") {
      payload = await pingPayload(adapterClient, actor, deferReplyMs, guildId);
    } else if (key === "core:help") {
      payload = helpPayload(config, interaction, db, guildId);
    } else if (key === "core:setup") {
      payload = setupPayload(config, interaction);
    }
    // ── server group ──
    else if (key === "server:health") {
      payload = await adapterClient.health(actor, guildId);
    } else if (key === "server:status") {
      payload = await adapterClient.status(actor, diagnostic, guildId);
      if (!diagnostic) {
        const statusData = payload?.result || payload || {};
        await sendStatusCard({ interaction, statusData: payload, title: statusData.title, adapterClient, guildId, db });
        applyCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
        return true;
      }
    } else if (key === "server:summary") {
      payload = statusSummaryPayload(await adapterClient.status(actor, false, guildId));
    } else if (key === "server:readiness") {
      payload = await adapterClient.readiness(actor, diagnostic, guildId);
    } else if (key === "server:readiness-detail") {
      payload = await adapterClient.readiness(actor, true, guildId);
    } else if (key === "server:services") {
      payload = await adapterClient.services(actor, guildId);
    } else if (key === "server:services-detail") {
      const services = await adapterClient.services(actor, guildId);
      const logs = await adapterClient.logs(actor, undefined, guildId);
      const mapState = await adapterClient.mapState(actor, guildId);
      payload = { services, logs: redactSecrets(logs), mapState };
    }
    // ── data group ──
    else if (key === "data:population") {
      payload = populationPayload(await adapterClient.population(actor, guildId));
    } else if (key === "data:backups") {
      payload = backupPayload(await adapterClient.backups(actor, guildId));
    } else if (key === "data:maps") {
      const status = await adapterClient.status(actor, false, guildId);
      payload = { maps: status?.result?.maps || [] };
    } else if (key === "data:inventory") {
      const search = interaction.options.getString("search");
      if (search) {
        payload = await adapterClient.playerInventorySearch(actor, search, guildId);
      } else {
        payload = await adapterClient.playerInventory(actor, guildId);
      }
    } else if (key === "data:storage") {
      const scope = interaction.options.getString("scope") || "owned";
      payload = await adapterClient.playerStorage(actor, scope, guildId);
    } else if (key === "data:find") {
      const query = interaction.options.getString("query");
      const scope = interaction.options.getString("scope") || "owned";
      payload = await adapterClient.playerFind(actor, query, scope, guildId);
    }
    // ── player group ──
    // Split out of data (2026-07-24) -- see the block comment above
    // buildDuneCommand() for why.
    else if (key === "player:link") {
      // character stays REQUIRED (2026-07-24, second revision) -- an
      // earlier implementation made it optional and branched on whether
      // it was provided, but that made the Steam-connections flow
      // reachable only by NOT typing something, which is not a
      // discoverable UI signal (Discord's autocomplete shows the option
      // as available the whole time a player is typing, so nearly every
      // player types a name out of habit). The bot now decides server-side,
      // from Core's response, whether to show the whisper reply or a
      // "Link via Steam" button -- never both, and never based on
      // argument presence. See docs/steam-link-design.md's revision note.
      const characterName = interaction.options.getString("character");
      const result = await adapterClient.playerLinkStart(actor, characterName, guildId);
      if (result?.hasSteam && config.steamLink?.enabled) {
        // Character has a Steam ID on file AND Steam linking is
        // configured on this server -- offer the instant path instead of
        // the whisper reply. If hasSteam is true but steamLink is NOT
        // enabled, fall through below to the normal whisper payload --
        // per FINDING-STEAM-5 this must degrade silently to whisper-only,
        // with no "not configured" error shown to the player.
        const session = createSteamLinkSession({
          discordUserId: interaction.user?.id,
          guildId,
          interactionToken: interaction.token,
          commandInteractionId: interaction.id,
          playerControllerId: result.playerControllerId,
          characterName
        });
        const startUrl = `${config.steamLink.baseUrl}/steam-link/start?state=${session.state}`;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Link via Steam").setStyle(ButtonStyle.Link).setURL(startUrl)
        );
        await interaction.editReply({
          content: `**${characterName}** is linked to a Steam account. Click below to verify instantly ` +
            "using your Discord's connected Steam account -- no in-game whisper needed. " +
            "This link expires in 10 minutes.",
          components: [row]
        });
        applyCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
        return true;
      }
      // No Steam ID on file, or Steam linking not configured on this
      // server -- existing whisper-code flow, UNCHANGED response shape.
      payload = result;
    } else if (key === "player:verify") {
      const code = interaction.options.getString("code");
      payload = await adapterClient.playerLinkVerify(actor, code, guildId);
    } else if (key === "player:unlink") {
      const characterLinkId = interaction.options.getString("character");
      if (characterLinkId) {
        payload = await adapterClient.playerUnlinkV2(actor, characterLinkId, guildId);
      } else {
        payload = await adapterClient.playerUnlink(actor, guildId);
      }
    } else if (key === "player:faction") {
      const faction = interaction.options.getString("name");
      payload = await adapterClient.playerFaction(actor, faction, guildId);
    } else if (key === "player:whoami") {
      payload = await adapterClient.whoami(actor, guildId);
    } else if (key === "player:characters") {
      payload = await adapterClient.playerLinks(actor, guildId);
    } else if (key === "player:enable") {
      const characterLinkId = interaction.options.getString("character");
      payload = await adapterClient.guildGrantsEnable(actor, characterLinkId, guildId);
    } else if (key === "player:disable") {
      const characterLinkId = interaction.options.getString("character");
      payload = await adapterClient.guildGrantsDisable(actor, characterLinkId, guildId);
    } else if (key === "player:default") {
      const characterLinkId = interaction.options.getString("character");
      payload = await adapterClient.guildGrantsDefault(actor, characterLinkId, guildId);
    }
    // ── logs group ──
    else if (group === "logs") {
      const rawLogs = await adapterClient.logs(actor, subcommand, guildId);
      payload = redactSecrets(rawLogs);
    }
    // ── ops group ──
    else if (OPS_SUBCOMMAND_NAMES.includes(subcommand)) {
      const route = opsRouteFor(subcommand);
      if (route) {
        const methodName = route.replace(/-(\w)/g, (_, c) => c.toUpperCase());
        payload = formatOpsPayload(subcommand, await adapterClient[methodName](actor, guildId));
        await sendOpsCard({ interaction, payload, subcommand, adapterClient, guildId, db });
        applyCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
        return true;
      } else {
        payload = { ok: false, error: `Unknown OPS command: ${subcommand}` };
      }
    }
    // ── admin group ──
    else if (key === "admin:doctor") {
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Doctor diagnostic requires admin or owner role.");
      payload = await doctorPayload(adapterClient, actor, config, guildId);
    } else if (key === "admin:cooldowns") {
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Cooldowns viewer requires admin or owner role.");
      payload = cooldownStats();
    } else if (key === "admin:latency") {
      payload = getLatencyHistory();
    } else if (key === "admin:events") {
      payload = getIncidentHistory();
    } else if (key === "admin:broadcast") {
      const msg = interaction.options.getString("message");
      const result = await executeBroadcast({ interaction, adapterClient, config, userRequest: msg, guildId });
      if (result.ok && result.needsConfirmation) {
        payload = redactSecrets({ ok: true, action: "broadcast", message: result.message, idempotencyKey: result.idempotencyKey, confirmation: result.confirmationMessage });
      } else {
        payload = redactSecrets(result);
      }
    }
    // ── infra group ──
    else if (key === "infra:version") {
      payload = await adapterClient.version(actor, guildId);
    } else if (key === "infra:servers") {
      payload = await adapterClient.servers(actor, guildId);
    } else if (key === "infra:ports") {
      payload = await adapterClient.ports(actor, guildId);
    } else if (key === "infra:db") {
      payload = await adapterClient.db(actor, guildId);
    }
    // ── write group ──
    else if (group === "write") {
      payload = await handleWriteCommand({ subcommand, interaction, adapterClient, config, guildId });
    }
    else {
      payload = { ok: false, error: `Unknown command: ${key}` };
    }

    // Sanitize all output before sending to Discord
    payload = redactSecrets(payload);

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
    } else if (subcommand === "services") {
      embed = formatGenericEmbed(payload, "services");
    } else if (subcommand === "services-detail") {
      embed = formatServicesDetailEmbed(payload);
    } else if (subcommand === "population") {
      embed = formatPopulationEmbed(payload);
    } else if (subcommand === "backups") {
      embed = formatBackupsEmbed(payload);
    } else if (subcommand === "maps") {
      embed = formatMapsEmbed(payload);
    } else if (subcommand === "link") {
      embed = formatLinkEmbed(payload);
    } else if (subcommand === "verify") {
      embed = formatGenericEmbed(payload, "verify");
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
    } else if (group === "logs") {
      embed = formatGenericEmbed(payload, `logs:${subcommand}`);
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
    // Provide better error messages for unmerged routes
    if (error instanceof Error && UNMERGED_ROUTES.has(error.route)) {
      const routeName = error.route.replace(/-/g, " ");
      await interaction.editReply(formatError(new Error(
        `${routeName} is implemented in feature/discord-player-inventory but not yet merged to upstream. ` +
        `Apply the branch to your console to enable this command.`
      )));
    } else {
      await interaction.editReply(formatError(error));
    }
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
export function isCommandAllowed(interaction, command, config, db = null, guildId = null) {
  if (config.multiTenant && db && guildId) {
    const roles = getGuildRoles(db, guildId);
    const settings = getGuildSettings(db, guildId);
    const mode = settings?.rbac_mode || "restricted";
    if (mode === "open") return true;
    const roleIds = new Set(extractRoleIds(interaction));
    const observerIds = new Set((roles || []).filter(r => r.role_type === "observer").map(r => r.role_id));
    const adminIds = new Set((roles || []).filter(r => r.role_type === "admin").map(r => r.role_id));
    if (observerIds.size > 0 && [...roleIds].some(r => observerIds.has(r))) return true;
    if (adminIds.size > 0 && [...roleIds].some(r => adminIds.has(r))) return true;
    return false;
  }

  const rbac = config.discord.rbac;
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
function isAdminActor(interaction, config, db = null, guildId = null) {
  if (config.multiTenant && db && guildId) {
    const roles = getGuildRoles(db, guildId);
    const roleIds = extractRoleIds(interaction);
    const adminIds = new Set((roles || []).filter(r => r.role_type === "admin").map(r => r.role_id));
    return roleIds.some(r => adminIds.has(r));
  }

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
export async function pingPayload(adapterClient, actor, deferReplyMs = 0, guildId = null) {
  const startedAt = Date.now();
  const health = await adapterClient.health(actor, guildId);
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
  return { ok: true, bot: { name: "arrakis-control-panel", version: pkgVersion, readOnly: true, writesEnabled: false }, adapter: { origin: new URL(config.adapter.baseUrl).origin, timeoutMs: config.adapter.timeoutMs }, discord: { rbacMode: config.discord.rbac.mode, defaultEphemeral: config.discord.defaultEphemeral }, boundary: { dockerSocket: false, databaseDirect: false, gameFiles: false, shellCommands: false } };
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

function helpPayload(config, interaction, db = null, guildId = null) {
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
    { name: "ops:announcements", desc: opsDescriptionFor("announcements"), role: "observer" },
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
    if (isCommandAllowed(interaction, cmd.name, config, db, guildId)) available.push(cmd); else locked.push(cmd);
  }
  const rbacMode = config.multiTenant ? "multi-tenant" : config.discord.rbac.mode;
  return { ok: true, total: all.length, available: available.map(c => c.name), locked: locked.map(c => c.name), availableCount: available.length, rbacMode };
}

async function doctorPayload(adapterClient, actor, config, guildId = null) {
  const [health, status, readiness, services] = await Promise.all([
    adapterClient.health(actor, guildId).catch(() => ({ ok: false })),
    adapterClient.status(actor, false, guildId).catch(() => ({ ok: false })),
    adapterClient.readiness(actor, false, guildId).catch(() => ({ ok: false })),
    adapterClient.services(actor, guildId).catch(() => ({ ok: false }))
  ]);
  return { ok: health?.ok !== false && status?.ok !== false, health: { ok: health?.ok === true, enabled: health?.enabled, readOnly: health?.readOnly, writesEnabled: health?.writesEnabled }, status: { ok: status?.ok === true, summary: status?.result?.summary || {} }, readiness: { ok: readiness?.ok === true, ready: readiness?.result?.ready, issues: readiness?.result?.issues || [] }, services: { ok: services?.ok === true, overall: services?.result?.overall, count: (services?.result?.services || []).length }, timestamp: new Date().toISOString() };
}
export function requiredRoleIdsForCommand(command, rbac) { return rbac?.commandRoleIds?.[command] || []; }
