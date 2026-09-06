import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgVersion = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8")).version;
import { checkCooldown, applyCooldown, cooldownStats } from "./cooldown.js";
import { executeBroadcast, sendBroadcastToAdapter } from "./broadcast.js";
import { formatError, formatPayload, redactSecrets } from "./format.js";
import { logInfo, logError } from "./logger.js";
import { resolveCompatEnv } from "./compatEnv.js";
import { getRegistryFromCache, fetchCoreCatalogForGuild, diffRegistries, getRegistryMetadata } from "./registryLoader.js";
import { duneEmbed, formatServicesSummaryEmbed, formatRolesEmbed, formatLogsEmbed, formatVersionEmbed, formatPlayerCommandEmbed, formatHelpEmbed, formatHealthEmbed, formatPingEmbed, formatStatusEmbed, formatPopulationEmbed, formatBackupsEmbed, formatGenericEmbed, formatDoctorEmbed, formatMapsEmbed, formatCooldownsEmbed, formatLatencyEmbed, formatEventsEmbed, formatStatusDetailEmbed, formatReadinessDetailEmbed, formatServicesDetailEmbed, formatMaintenanceEmbed, formatServersEmbed, formatPortsEmbed, formatDbEmbed, formatSetupEmbed, formatInventoryEmbed, formatStorageEmbed, formatFindEmbed, formatLinkEmbed, formatUnlinkEmbed, formatWhoamiEmbed , formatActivityEmbed, formatCombatEmbed, formatResourcesEmbed, formatEconomyEmbed, formatOpsInventoryEmbed, formatLocationEmbed, formatSocEmbed, formatPrometheusEmbed, formatDashboardEmbed, formatAnnouncementsEmbed, formatSyncCommandsEmbed, formatAlertsEmbed } from "./embedFormat.js";
import { sendEmbed, sendError, sendCard, sendText, sendEphemeral } from "./output/pipeline.js";
import { sendStatusCard, sendOpsCard } from "./statusCard.js";
import { handleWriteCommand } from "./writeHandler.js";
import { writesEnabled, canWrite, writeRoleIds } from "./writes.js";
import { OPS_SUBCOMMAND_NAMES, opsRouteFor, formatOpsPayload, opsDescriptionFor } from "./opsCommands.js";
import { getLatencyHistory, UNMERGED_ROUTES, MISSING_ROUTES } from "./adapterClient.js";
import { getIncidentHistory } from "./scheduler.js";
import { getGuildRoles, getGuildSettings, incrementCommandCount, getGuildFaction } from "./database.js";
import { resolveRoleLabel, resolveRoleLabels } from "./roleDisplay.js";
import { multiTenantActorTier, isGuildOwner, tierAtLeast } from "./rbac.js";
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
      .addSubcommand((c) => c.setName("services-detail").setDescription("Show detailed service state with logs."))
      .addSubcommand((c) => c.setName("maintenance").setDescription("Show current maintenance note or window (read-only).")))

    // ── data group ──
    // inventory/storage/find moved to player (2026-07-26) -- these are
    // per-player data (YOUR inventory, YOUR storage), not server-wide
    // data like population/backups/maps. Every player-related subcommand
    // now lives under /dune player, consistently, per explicit operator
    // direction -- do not add a new player-scoped subcommand here again.
    .addSubcommandGroup((g) => g.setName("data").setDescription("Server population, backups, and map data.")
      .addSubcommand((c) => c.setName("population").setDescription("Show aggregate player count and server population."))
      .addSubcommand((c) => c.setName("backups").setDescription("List recent backup metadata (read-only)."))
      .addSubcommand((c) => c.setName("maps").setDescription("Show active game maps with state and uptime.")))

    // ── player group ──
    // Split out of data (see the block comment above buildDuneCommand()).
    // inventory/storage/find joined this group 2026-07-26, moved from data
    // -- every subcommand here is scoped to the calling player's own
    // character/account, never server-wide data.
    .addSubcommandGroup((g) => g.setName("player").setDescription("Your character: linking, inventory, storage, and account management.")
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
        .addStringOption((o) => o.setName("character").setDescription("Player controller ID from /dune player characters (omit to unlink your single-link character)")))
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
      .addSubcommand((c) => c.setName("armory").setDescription(opsDescriptionFor("armory")))
      .addSubcommand((c) => c.setName("location").setDescription(opsDescriptionFor("location")))
      .addSubcommand((c) => c.setName("soc").setDescription(opsDescriptionFor("soc")))
      .addSubcommand((c) => c.setName("prometheus").setDescription(opsDescriptionFor("prometheus")))
      .addSubcommand((c) => c.setName("dashboard").setDescription(opsDescriptionFor("dashboard")))
      .addSubcommand((c) => c.setName("announcements").setDescription(opsDescriptionFor("announcements")))
      .addSubcommand((c) => c.setName("alerts").setDescription(opsDescriptionFor("alerts"))))

    // ── admin group ──
    .addSubcommandGroup((g) => g.setName("admin").setDescription("Admin-only diagnostics and management.")
      .addSubcommand((c) => c.setName("doctor").setDescription("Comprehensive system diagnostic across all subsystems."))
      .addSubcommand((c) => c.setName("sync-commands").setDescription("Check Core's command catalog for drift against the bot's registry."))
      .addSubcommand((c) => c.setName("cooldowns").setDescription("Show active command cooldowns."))
      .addSubcommand((c) => c.setName("latency").setDescription("Show adapter request latency history."))
      .addSubcommand((c) => c.setName("events").setDescription("Show recent server incidents and events."))
      .addSubcommand((c) => c.setName("roles").setDescription("Show configured admin/player roles, with current Discord role names."))
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

// #211: single definition (was duplicated inline at two dispatch sites).
const OPS_EMBEDS = { alerts: formatAlertsEmbed, activity: formatActivityEmbed, combat: formatCombatEmbed, resources: formatResourcesEmbed, economy: formatEconomyEmbed, armory: formatOpsInventoryEmbed, location: formatLocationEmbed, soc: formatSocEmbed, prometheus: formatPrometheusEmbed, dashboard: formatDashboardEmbed, announcements: formatAnnouncementsEmbed };

// #213: one shared source for the setup-portal URL (mirrors onboarding.js).
function setupPortalUrl(guildId = "") {
  const base = resolveCompatEnv(process.env, "SETUP_URL", { urlShaped: true }) || resolveCompatEnv(process.env, "BASE_URL", { urlShaped: true }) || "http://localhost:3100";
  return `${base}/setup${guildId ? `?guildId=${guildId}` : ""}`;
}

export async function executeDuneCommand(interaction, adapterClient, config, db = null) {
  if (!interaction.isChatInputCommand?.() || interaction.commandName !== "dune") return false;
  let embed;
  // #219: dispatch selects a formatter, never a built embed — embeds are
  // built AFTER redactSecrets(payload) runs below.
  let chosenFormatter = null;

  const group = interaction.options.getSubcommandGroup() || "";
  const subcommand = interaction.options.getSubcommand();
  const key = group ? `${group}:${subcommand}` : subcommand;
  const guildId = interaction.guildId;

  // #213/U4: an unconfigured multi-tenant guild used to be denied EVERY
  // command — including /dune core setup, the exact command the
  // onboarding DM names as the recovery path. Reply with the working
  // path instead of a dead end.
  //
  // Issue #238 code-review finding: this gate used to fire before
  // isCommandAllowed (and its isGuildOwner check) ever ran, so the real
  // guild owner was STILL locked out of a zero-role guild despite the
  // CHANGELOG's claim that this is "structurally impossible" -- the real
  // owner must bypass this gate too, exactly like isCommandAllowed does.
  if (config.multiTenant && db && guildId
    && !isInteractionGuildOwner(interaction)) {
    const settings = getGuildSettings(db, guildId);
    const mode = settings?.rbac_mode || "restricted";
    if (mode !== "open" && getGuildRoles(db, guildId).length === 0) {
      await interaction.reply({
        content: [
          "⚙️ **This server isn't connected to Mentat yet** (no role tiers are configured).",
          `Finish setup here: ${setupPortalUrl(guildId)}`,
          "You'll need your console URL, the adapter token, and at least one Discord role mapped to a tier (Player/Moderator/Admin/Owner).",
          "Once configured, run `/dune core help` to see available commands."
        ].join("\n"),
        ephemeral: true
      });
      return true;
    }
  }

  // Issue #238 code-review finding: a guild whose ONLY configured role
  // mapping is a legacy, pre-#238 "owner" row (now inert -- see rbac.js's
  // resolveActorAuthTier) resolves that holder's tier to null, same as
  // someone with no role at all -- they'd be denied by isCommandAllowed
  // below before ever reaching the roles viewer, the one command meant to
  // show them the "why did this stop working" notice. `admin:roles` is
  // read-only, non-sensitive (role ID mappings, not secrets), and its own
  // purpose already includes helping a locked-out user -- exempt it from
  // the normal RBAC gate, matching #213/U8's "name the fix, don't
  // dead-end" precedent above.
  if (key !== "admin:roles" && !isCommandAllowed(interaction, key, config, db, guildId)) {
    // #213/U8: name the fix, don't dead-end — the user's next step is a
    // role grant, and only a server admin can do it.
    await interaction.reply({
      content: "🔒 You are not authorized to use this command. Access requires one of this server's configured Mentat role tiers (Player, Moderator, Admin, or Owner) — ask a server admin to assign you one of the mapped Discord roles.",
      ephemeral: true
    });
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
    } else if (key === "server:maintenance") {
      payload = await adapterClient.maintenance(actor, guildId);
    }
    // ── data group ──
    else if (key === "data:population") {
      payload = populationPayload(await adapterClient.population(actor, guildId));
    } else if (key === "data:backups") {
      payload = backupPayload(await adapterClient.backups(actor, guildId));
    } else if (key === "data:maps") {
      const status = await adapterClient.status(actor, false, guildId);
      payload = { maps: status?.result?.maps || [] };
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
      // playerLink() (not playerLinkStart()) is the correct call here --
      // playerLink() hits the real, live V1 route (players-link ->
      // linkPlayerProvider(), the function tonight's FINDING-LINK-7 work
      // extended with hasSteam/playerControllerId). playerLinkStart()
      // hits player-links-start, the V2 multi-character route that is
      // still genuinely unmerged on Core -- calling it here was a
      // pre-existing bug (not introduced by tonight's work) that made
      // every /dune player link attempt fail with an "unmerged route"
      // error, regardless of the Steam-link fixes. Found via a live test
      // 2026-07-26.
      const result = await adapterClient.playerLink(actor, characterName, guildId);
      if (result?.hasSteam && config.steamLink?.enabled) {
        // Character has a Steam ID on file AND Steam linking is
        // configured on this server -- offer the instant path instead of
        // the whisper reply. If hasSteam is true but steamLink is NOT
        // enabled, fall through below to the normal whisper payload --
        // per FINDING-STEAM-5 this must degrade silently to whisper-only,
        // with no "not configured" error shown to the player.
        // username/channelId/roleIds captured here (via actorFromInteraction(),
        // the same helper every other command uses) because they're only
        // available from the real Discord interaction right now -- the
        // OAuth redirect round-trip that follows has no way to recover
        // them later. Core's normalizeDiscordActor() hard-requires
        // username/channelId on every actor object, and
        // requireSelfScopedCapability() needs real roleIds to resolve the
        // actor's tier correctly. Found missing via a live test 2026-07-26
        // (every real link-steam call failed with a 400 until this was
        // added).
        const callerActor = actorFromInteraction(interaction);
        const session = createSteamLinkSession({
          discordUserId: interaction.user?.id,
          username: callerActor.username,
          guildId,
          channelId: callerActor.channelId,
          roleIds: callerActor.roleIds,
          interactionToken: interaction.token,
          commandInteractionId: interaction.id,
          playerControllerId: result.playerControllerId,
          characterName
        });
        const startUrl = `${config.steamLink.baseUrl}/steam-link/start?state=${session.state}`;
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("Link via Steam").setStyle(ButtonStyle.Link).setURL(startUrl)
        );
        const steamEmbed = duneEmbed({
          title: "🔗 Steam Link Available",
          color: "success",
          description: `**${characterName}** is linked to a Steam account. Click below to verify instantly using your Discord\u2019s connected Steam account \u2014 no in-game whisper needed. This link expires in 10 minutes.`
        });
        await interaction.editReply({
          embeds: [steamEmbed],
          components: [row]
        });
        applyCooldown({ userId: interaction.user?.id, commandName: key, interaction, config });
        return true;
      }
      // No Steam ID on file, or Steam linking not configured on this
      // server -- existing whisper-code flow, UNCHANGED response shape.
      payload = result;
    } else if (key === "player:verify") {
      // FIX (2026-07-27, found via a real live production error --
      // /dune player unlink <character> failed with "not yet merged to
      // upstream"; verify was separately broken the same way, calling a
      // route that has never existed on Core at all). playerLinkVerify()
      // now calls Core's real, live PLAYERS_LINK_VERIFY route
      // (/players/link/verify) -- see its own comment in adapterClient.js
      // for the full history.
      const code = interaction.options.getString("code");
      payload = await adapterClient.playerLinkVerify(actor, code, guildId);
    } else if (key === "player:unlink") {
      // FIX (2026-07-27, same live production error): the "character"
      // option now expects a real playerControllerId (obtainable via
      // /dune player characters, fixed in the same session), not an
      // arbitrary "Character link ID" as the option's old description
      // suggested -- Core's real unlinkAccountProvider() has always
      // required playerControllerId specifically. playerUnlinkV2() (which
      // called a route that never existed on Core) is replaced by
      // playerAccountsUnlink(), which calls Core's real, live
      // PLAYERS_ACCOUNTS_UNLINK route.
      const playerControllerId = interaction.options.getString("character");
      if (playerControllerId) {
        payload = await adapterClient.playerAccountsUnlink(actor, playerControllerId, guildId);
      } else {
        payload = await adapterClient.playerUnlink(actor, guildId);
      }
    } else if (key === "player:faction") {
      const faction = interaction.options.getString("name");
      payload = await adapterClient.playerFaction(actor, faction, guildId);
    } else if (key === "player:whoami") {
      payload = await adapterClient.whoami(actor, guildId);
    } else if (key === "player:characters") {
      // FIX (2026-07-27, same live production error): playerLinks()
      // called a route that has never existed on Core at all.
      // playerAccountsList() calls Core's real, live PLAYERS_ACCOUNTS_LIST
      // route, returning each linked character's real playerControllerId
      // (needed for /dune player unlink above, since a user must be able
      // to see their own playerControllerId to actually use that command).
      payload = await adapterClient.playerAccountsList(actor, guildId);
    } else if (key === "player:enable") {
      const characterLinkId = interaction.options.getString("character");
      payload = await adapterClient.guildGrantsEnable(actor, characterLinkId, guildId);
    } else if (key === "player:disable") {
      const characterLinkId = interaction.options.getString("character");
      payload = await adapterClient.guildGrantsDisable(actor, characterLinkId, guildId);
    } else if (key === "player:default") {
      const characterLinkId = interaction.options.getString("character");
      payload = await adapterClient.guildGrantsDefault(actor, characterLinkId, guildId);
    } else if (key === "player:inventory") {
      const search = interaction.options.getString("search");
      if (search) {
        payload = await adapterClient.playerInventorySearch(actor, search, guildId);
      } else {
        payload = await adapterClient.playerInventory(actor, guildId);
      }
    } else if (key === "player:storage") {
      const scope = interaction.options.getString("scope") || "owned";
      // "guild" scope has a dedicated guild-scoped route; do not silently
      // fall back to the requester's own player-scoped storage, which would
      // mislabel one player's containers as guild-wide data.
      payload = scope === "guild"
        ? await adapterClient.guildStorage(actor, guildId)
        : await adapterClient.playerStorage(actor, scope, guildId);
    } else if (key === "player:find") {
      const query = interaction.options.getString("query");
      const scope = interaction.options.getString("scope") || "owned";
      // "guild" scope has a dedicated guild-scoped route; do not silently
      // fall back to the requester's own player-scoped find, which would
      // mislabel one player's results as guild-wide data (same fix as
      // player:storage above).
      payload = scope === "guild"
        ? await adapterClient.guildFind(actor, query, guildId)
        : await adapterClient.playerFind(actor, query, scope, guildId);
    }
    // ── logs group ──
    else if (group === "logs") {
      const rawLogs = await adapterClient.logs(actor, subcommand, guildId);
      payload = redactSecrets(rawLogs);
    }
    // ── ops group ──
    else if (OPS_SUBCOMMAND_NAMES.includes(subcommand)) {
      // #211/U2: `alerts` queries Prometheus directly, not through Core —
      // it must NOT fall through into the generic ops dispatch below,
      // which resolved a nonexistent adapterClient.opsAlerts() and
      // replied with a raw "is not a function" error (discarding the
      // correct embed and double-applying the cooldown).
      if (subcommand === "alerts") {
        payload = await fetchPrometheusAlerts(adapterClient, actor, guildId);
        chosenFormatter = (p) => (OPS_EMBEDS[subcommand] || formatGenericEmbed)(p, `ops ${subcommand}`);
      } else {
        const route = opsRouteFor(subcommand);
        if (route) {
          const methodName = route.replace(/-(\w)/g, (_, c) => c.toUpperCase());
          payload = formatOpsPayload(subcommand, await adapterClient[methodName](actor, guildId));
          chosenFormatter = (p) => (OPS_EMBEDS[subcommand] || formatGenericEmbed)(p, `ops ${subcommand}`);
        } else {
          payload = { ok: false, error: `Unknown OPS command: ${subcommand}` };
        }
      }
    }
    // ── admin group ──
    else if (key === "admin:doctor") {
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Doctor diagnostic requires admin or owner role.");
      payload = await doctorPayload(adapterClient, actor, config, guildId);
    } else if (key === "admin:sync-commands") {
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Sync-commands requires admin or owner role.");
      // Phase 3: Refresh command registry from Core
      payload = await syncCommandsPayload(adapterClient, actor, guildId);
    } else if (key === "admin:cooldowns") {
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Cooldowns viewer requires admin or owner role.");
      payload = cooldownStats();
    } else if (key === "admin:latency") {
      // #216: documented admin-only everywhere, but the gate was missing —
      // lower tiers could read admin diagnostics.
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Latency history requires admin or owner role.");
      payload = getLatencyHistory();
    } else if (key === "admin:events") {
      // #216: same missing gate as admin:latency.
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Incident log requires admin or owner role.");
      payload = getIncidentHistory();
    } else if (key === "admin:roles") {
      // Issue #238 code-review finding: intentionally NOT admin-gated (see
      // the matching bypass on isCommandAllowed above) -- a locked-out
      // legacy-owner-role holder must be able to see the notice explaining
      // why, and this payload carries only role ID mappings, not secrets.
      payload = rolesConfigPayload(interaction, config, db, guildId);
    } else if (key === "admin:broadcast") {
      const msg = interaction.options.getString("message");
      const result = await executeBroadcast({ interaction, adapterClient, config, userRequest: msg, guildId, db });
      if (result.ok && result.needsConfirmation) {
        payload = redactSecrets({ ok: true, action: "broadcast", message: result.message, idempotencyKey: result.idempotencyKey, confirmation: result.confirmationMessage });
      } else {
        payload = redactSecrets(result);
      }
    }
    // ── infra group ──
    else if (key === "infra:version") {
      payload = await adapterClient.version(actor, guildId);
      chosenFormatter = formatVersionEmbed;
    } else if (key === "infra:servers") {
      payload = await adapterClient.servers(actor, guildId);
    } else if (key === "infra:ports") {
      payload = await adapterClient.ports(actor, guildId);
    } else if (key === "infra:db") {
      payload = await adapterClient.db(actor, guildId);
    }
    // ── write group ──
    else if (group === "write") {
      payload = await handleWriteCommand({ subcommand, interaction, adapterClient, config, guildId, db });
    }
    else {
      payload = { ok: false, error: `Unknown command: ${key}` };
    }

    // Pull confirmation UI builder objects (EmbedBuilder/ActionRowBuilder)
    // out before redaction: redactSecrets() walks plain object entries and
    // would strip their prototypes/toJSON(), breaking interaction.editReply().
    const confirmationEmbed = payload?.confirmationEmbed;
    const confirmationRow = payload?.confirmationRow;
    if (payload && typeof payload === "object" && "confirmationEmbed" in payload) {
      const { confirmationEmbed: _e, confirmationRow: _r, ...rest } = payload;
      payload = rest;
    }

    // Sanitize all output before sending to Discord
    payload = redactSecrets(payload);

    // ── Embed selection ──
    // #210: guarded on !embed — branches above (ops group, infra:version)
    // pick their dedicated formatter at dispatch time, and the final
    // `else` here used to unconditionally OVERWRITE those with the
    // generic debug-dump formatter, leaving every dedicated ops/version
    // embed computed and then discarded.
    if (chosenFormatter) {
      // #219: built HERE, from the redacted payload — never at dispatch.
      embed = chosenFormatter(payload);
    } else if (subcommand === "about") {
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
    } else if (subcommand === "help") {
      // #210/U1: the flagship discovery surface — the generic formatter
      // sliced its arrays to 5 items, hiding ~90% of the command surface.
      embed = formatHelpEmbed(payload);
    } else if (subcommand === "sync-commands") {
      embed = formatSyncCommandsEmbed(payload);
    } else if (subcommand === "roles") {
      embed = formatRolesEmbed(payload);
    } else if (subcommand === "services") {
      embed = formatServicesSummaryEmbed(payload);
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
      // #210/T2/P3: code-block log rendering with a real line budget,
      // instead of 5 bold-mangled lines from the generic formatter.
      embed = formatLogsEmbed(payload, subcommand);
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

    if (confirmationEmbed && confirmationRow) {
      // Button-based confirmation for write commands (see writeConfirmation.js
      // and docs/rw-confirmation-flow.md). Confirming/cancelling is handled by
      // handleWriteButtonInteraction() in index.js's InteractionCreate listener.
      await interaction.editReply({ embeds: [confirmationEmbed], components: [confirmationRow] });
    } else if (embed) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await sendEmbed(interaction, { embed: formatGenericEmbed({ result: payload, title: `Dune ${key}` }) });
    }
  } catch (error) {
    // Provide better error messages for unmerged routes
    if (error instanceof Error && UNMERGED_ROUTES.has(error.route)) {
      const routeName = error.route.replace(/-/g, " ");
      await sendError(interaction, { error: new Error(
        `${routeName} is implemented in feature/discord-player-inventory but not yet merged to upstream. ` +
        `Apply the branch to your console to enable this command.`
      ) });
    } else if (error instanceof Error && MISSING_ROUTES.has(error.route)) {
      // Issue #172 (upstream compat pin refresh, v1.3.79 -> v1.3.87): a
      // real, live-blast-radius upstream regression -- players-accounts-list/
      // players-accounts-unlink (and ops-dashboard) were reclassified from
      // LIVE_ROUTES to MISSING_ROUTES after direct verification against a
      // fresh upstream clone showed these routes never existed in any
      // tagged upstream release (players-accounts-*) or were silently
      // dropped from routes.js's dispatch table between v1.3.79 and
      // v1.3.87 (ops-dashboard). Before this fix, a 404 from Core surfaced
      // here as a raw "Adapter <route> returned HTTP 404." message via the
      // else branch below -- confusing for an operator with no way to know
      // whether that's a bug in their Core install, a misconfigured
      // adapter URL, or (as is actually the case for these specific
      // routes) a feature this bot's client expects that this version of
      // Core genuinely does not implement. Give the real, actionable
      // explanation instead.
      const routeName = error.route.replace(/-/g, " ");
      await sendError(interaction, { error: new Error(
        `${routeName} is not available on this Core installation -- this feature is not yet supported by the version of ` +
        `dune-awakening-selfhost-docker this server's console is running. This is a known limitation, not a ` +
        `configuration problem with this bot. See arrakis-control-panel#172 for details.`
      ) });
    } else {
      await sendError(interaction, { error: error.message || String(error) });
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
  // The real Discord guild owner always passes, in every mode -- owner is a
  // live Discord fact (interaction.guild.ownerId), never something an RBAC
  // mode/role config can deny (see rbac.js's isGuildOwner / issue #238).
  if (isInteractionGuildOwner(interaction)) return true;

  if (config.multiTenant && db && guildId) {
    const settings = getGuildSettings(db, guildId);
    const mode = settings?.rbac_mode || "restricted";
    if (mode === "open") return true;
    // Multi-tenant gating is tier-based: any configured guild_roles row the
    // actor holds lets them through (restricted mode = "must hold a
    // configured role"). Moderator/admin/observer rows are honored here;
    // legacy "owner" rows are deliberately excluded -- owner is decided
    // above, by real guild ownership, never by a role (issue #238).
    return multiTenantActorTier(interaction.user?.id, resolveGuildOwnerId(interaction), db, guildId, extractRoleIds(interaction)) != null;
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

// resolveGuildOwnerId: single source of truth for "who does Discord say owns
// this guild" from an interaction (issue #238 code-review finding). Prefers
// the live, already-cached interaction.guild.ownerId, but falls back to the
// bot's own client-wide guild cache (interaction.client.guilds.cache) via
// guildId when interaction.guild is null/uncached -- a real, reachable gap
// during a gateway reconnect or a guild-unavailable window, where
// interaction.guildId is still populated but interaction.guild is not.
export function resolveGuildOwnerId(interaction) {
  if (interaction.guild?.ownerId) return interaction.guild.ownerId;
  const guildId = interaction.guildId;
  if (!guildId) return undefined;
  return interaction.client?.guilds?.cache?.get(guildId)?.ownerId;
}

// isInteractionGuildOwner: every gating call site (isCommandAllowed,
// isAdminActor in this file, canWrite in writes.js, executeDuneCommand's
// zero-role gate) uses this ONE function rather than re-deriving
// isGuildOwner(interaction.user?.id, interaction.guild?.ownerId) inline --
// centralizing both the ownership check and the reconnect-window fallback
// above, per issue #238's own code-review finding that duplicated copies of
// this exact check had already drifted once (a role-shaped guard running
// ahead of it in one of three copies).
export function isInteractionGuildOwner(interaction) {
  return isGuildOwner(interaction.user?.id, resolveGuildOwnerId(interaction));
}

// resolveOwnerLabel: the owner tier has no role concept (issue #238) -- it
// is always the real Discord guild owner. Cache-only lookup (no live fetch),
// matching resolveRoleLabel's cache-only approach; falls back to the bare
// ID when the member cache doesn't have it (this bot only requests the
// Guilds intent, not GuildMembers, so the cache is frequently sparse -- a
// bare ID is still the honest, correct answer here, just less pretty).
function resolveOwnerLabel(guild) {
  const ownerId = guild?.ownerId;
  if (!ownerId) return "(unknown -- no guild context)";
  const cachedTag = guild.members?.cache?.get(ownerId)?.user?.tag;
  return cachedTag ? `${cachedTag} (${ownerId})` : `Discord server owner (${ownerId})`;
}

// rolesConfigPayload: shows the currently configured admin/moderator/observer
// role mappings for this guild, resolved to "RoleName (RoleID)" using the
// live Discord role cache (interaction.guild.roles.cache) -- added
// 2026-07-26 after a real incident where stale role IDs in guild_roles
// silently caused every non-open-mode command to reject a legitimate admin,
// with no way to spot the mismatch from a bare numeric ID. Covers both
// multiTenant (DB-backed guild_roles table) and single-tenant
// (config.discord.rbac env vars) configuration paths, since
// isCommandAllowed()/isAdminActor() branch on the same two paths for the
// actual authorization decision. owner is never a role mapping (issue
// #238) -- it's always shown separately, resolved live from guild ownership.
function rolesConfigPayload(interaction, config, db = null, guildId = null) {
  const guild = interaction.guild;
  const ownerLabel = resolveOwnerLabel(guild);

  if (config.multiTenant && db && guildId) {
    const roles = getGuildRoles(db, guildId);
    const settings = getGuildSettings(db, guildId);
    const legacyOwnerRows = roles.filter((r) => r.role_type === "owner");
    const resolved = resolveRoleLabels(guild, roles.filter((r) => r.role_type !== "owner"));
    return {
      ok: true,
      source: "database (multi-tenant)",
      rbacMode: settings?.rbac_mode || "restricted",
      owner: ownerLabel,
      roles: resolved.length
        ? resolved.map((r) => `${r.roleType}: ${r.label}`)
        : ["(no admin/moderator/player roles configured -- only allowedUserIds, open mode, or the real guild owner can authorize commands)"],
      ...(legacyOwnerRows.length
        ? { notice: "This guild has a legacy 'Owner Role' mapping from before issue #238 -- it no longer grants owner-tier access. Only the real Discord server owner (shown above) does." }
        : {})
    };
  }

  const rbac = config.discord.rbac;
  const adminLabels = (rbac.adminRoleIds || []).map((id) => resolveRoleLabel(guild, id));
  const observerLabels = (rbac.observerRoleIds || []).map((id) => resolveRoleLabel(guild, id));
  // Reuses writes.js's own parse of this env var (issue #238 code-review
  // finding: this used to be re-parsed independently here, risking silent
  // drift from writes.js's actual admin-equivalent role set).
  const legacyOwnerRoleIds = writeRoleIds().owner;
  return {
    ok: true,
    source: "environment variables (single-tenant)",
    rbacMode: rbac.mode,
    owner: ownerLabel,
    admin: adminLabels.length ? adminLabels : ["(none configured)"],
    observer: observerLabels.length ? observerLabels : ["(none configured)"],
    allowedUserIds: rbac.allowedUserIds?.length ? rbac.allowedUserIds : ["(none configured)"],
    ...(legacyOwnerRoleIds.length
      ? { notice: "DISCORD_WRITE_OWNER_ROLE_IDS is set but no longer grants owner-tier access (issue #238) -- only the real Discord server owner does. Those role IDs are still folded into the admin-tier check." }
      : {})
  };
}

// ── Helpers ──
export function isAdminActor(interaction, config, db = null, guildId = null) {
  // Real guild owner always passes (never via a role -- issue #238).
  if (isInteractionGuildOwner(interaction)) return true;

  if (config.multiTenant && db && guildId) {
    // Admin gate = admin tier or above. Moderator does not pass (it is
    // below admin on the unified ladder). Owner is already handled above.
    const tier = multiTenantActorTier(interaction.user?.id, resolveGuildOwnerId(interaction), db, guildId, extractRoleIds(interaction));
    return tierAtLeast(tier, "admin");
  }

  const roleIds = extractRoleIds(interaction);
  // DISCORD_WRITE_OWNER_ROLE_IDS is intentionally still folded in here as an
  // ADMIN-equivalent set (not owner-equivalent) for single-tenant back-compat
  // -- see writes.js's writeRoleIds() header comment for why the env var
  // itself is deprecated for granting owner-tier access specifically.
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

// #221/F6: missing values stay null (fmt() renders "— None —") instead of
// the truthy string "unknown" bolded inside a green embed.
export function statusSummaryPayload(status) {
  const s = status?.result || {};
  return { ok: status?.ok === true, overall: s.overall || "UNKNOWN", region: s.region ?? null, mode: s.mode ?? null, population: s.population ?? null, automation: { autoscaler: s.automation?.autoscaler ?? null, autoUpdates: s.automation?.autoUpdates ?? null } };
}

export function aboutPayload(config) {
  // readOnly reflects the bot's actual data-mutation surface: character linking
  // (data:link/verify/unlink/faction/enable/disable/default) writes to the local
  // multi-tenant database regardless of the DUNE_DISCORD_WRITES_ENABLED flag, so
  // the bot has not been strictly read-only since V2 player linking shipped.
  // writesEnabled reflects only the separate operator write-command group
  // (src/writeHandler.js), which stays disabled unless explicitly configured.
  return { ok: true, bot: { name: "arrakis-control-panel", version: pkgVersion, readOnly: false, writesEnabled: writesEnabled(config) }, adapter: { origin: new URL(config.adapter.baseUrl).origin, timeoutMs: config.adapter.timeoutMs }, discord: { rbacMode: config.discord.rbac.mode, defaultEphemeral: config.discord.defaultEphemeral }, boundary: { dockerSocket: false, databaseDirect: false, gameFiles: false, shellCommands: false } };
}

// #215/A7: missing counts stay null (not the truthy string "unknown",
// which rendered a green "unknown players online" success embed).
export function populationPayload(p) { const r = p?.result || {}; return { ok: p?.ok === true, online: r.onlinePlayers ?? null, total: r.totalPlayers ?? null, aggregate: r.aggregate ?? true, detailsSuppressed: r.detailsSuppressed ?? true }; }

export function backupPayload(b) { const list = Array.isArray(b?.result?.backups) ? b.result.backups.slice(0, 10) : []; return { ok: b?.ok === true, count: list.length, backups: list.map(x => ({ name: x.name || "unknown", date: x.date || x.createdAt || "unknown", size: x.size || "unknown" })) }; }

function setupPayload(config, interaction) {
  const clientId = process.env.DISCORD_CLIENT_ID || config?.discord?.clientId || "";
  const guildId = interaction?.guildId || "";
  const inviteUrl = clientId
    ? `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands`
    : "*(Client ID not configured — ask the bot host for the invite link)*";
  // #213/A1: in multi-tenant mode the working setup path is the portal,
  // and the onboarding DM's own recovery instruction is "run /dune core
  // setup" — so this payload MUST carry the portal link (the old embed
  // showed only single-tenant self-host instructions, a different
  // deployment model entirely).
  return {
    ok: true,
    clientId,
    guildId,
    inviteUrl,
    multiTenant: config?.multiTenant === true,
    setupUrl: config?.multiTenant ? setupPortalUrl(guildId) : ""
  };
}

// FIXED 2026-08-06: this list previously contained only 32 entries and
// silently omitted the ENTIRE player group (12 subcommands), the ENTIRE
// logs group (7 subcommands), and 3 server subcommands (readiness-detail,
// services-detail, maintenance) -- every one of them registered and
// dispatchable. A user running /dune help had no way to discover
// /dune player inventory or any other player/logs command. The list now
// mirrors buildDuneCommand()'s full registered surface (54 entries, 66
// with the write group) in registration order. Keep it in sync with the
// registration block when commands change.
const WRITE_HELP_ENTRIES = [
  { name: "write:maintenance-note", desc: "Set a maintenance note.", role: "admin" },
  { name: "write:maintenance-window", desc: "Set a maintenance window.", role: "admin" },
  { name: "write:alert-channel", desc: "Set alert notification channel.", role: "admin" },
  { name: "write:alert-threshold", desc: "Set alert thresholds.", role: "admin" },
  { name: "write:digest-schedule", desc: "Set digest schedule interval.", role: "admin" },
  { name: "write:post-schedule", desc: "Set scheduled post type.", role: "admin" },
  { name: "write:add-channel", desc: "Add channel for scheduled posts.", role: "admin" },
  { name: "write:remove-channel", desc: "Remove channel from scheduled posts.", role: "admin" },
  { name: "write:backup", desc: "Create a database backup.", role: "admin" },
  { name: "write:restart", desc: "Restart a game service.", role: "admin" },
  { name: "write:update", desc: "Trigger a game or server update.", role: "admin" },
  { name: "write:cache", desc: "Clear server caches.", role: "admin" }
];

export function helpPayload(config, interaction, db = null, guildId = null) {
  const all = [
    // ── core ──
    { name: "core:about", desc: "Show safe bot and adapter metadata.", role: "player" },
    { name: "core:ping", desc: "Measure Discord and adapter latency.", role: "player" },
    { name: "core:help", desc: "Show available commands for your role.", role: "player" },
    { name: "core:setup", desc: "How to add this bot to your own Discord server.", role: "player" },
    // ── server ──
    { name: "server:health", desc: "Check the console Discord adapter.", role: "player" },
    { name: "server:status", desc: "Show high-level server status.", role: "player" },
    { name: "server:summary", desc: "Show compact aggregate server status.", role: "player" },
    { name: "server:readiness", desc: "Show readiness and preflight state.", role: "player" },
    { name: "server:readiness-detail", desc: "Show grouped readiness detail with issues.", role: "player" },
    { name: "server:services", desc: "Show service container state.", role: "player" },
    { name: "server:services-detail", desc: "Show detailed service state with logs.", role: "player" },
    { name: "server:maintenance", desc: "Show current maintenance note or window (read-only).", role: "player" },
    // ── data ──
    { name: "data:population", desc: "Show aggregate player count.", role: "player" },
    { name: "data:backups", desc: "List recent backup metadata.", role: "player" },
    { name: "data:maps", desc: "Show active game maps.", role: "player" },
    // ── player ──
    { name: "player:link", desc: "Link your Discord to your game character.", role: "player" },
    { name: "player:verify", desc: "Verify a pending character link with a code.", role: "player" },
    { name: "player:characters", desc: "List your verified characters.", role: "player" },
    { name: "player:enable", desc: "Enable a character in this guild.", role: "player" },
    { name: "player:disable", desc: "Disable a character in this guild.", role: "player" },
    { name: "player:default", desc: "Set your default character for this guild.", role: "player" },
    { name: "player:unlink", desc: "Unlink a character from your Discord.", role: "player" },
    { name: "player:faction", desc: "Set your faction for themed embeds.", role: "player" },
    { name: "player:whoami", desc: "Show your linked game character info.", role: "player" },
    { name: "player:inventory", desc: "View your personal inventory.", role: "player" },
    { name: "player:storage", desc: "View your storage containers grouped by map.", role: "player" },
    { name: "player:find", desc: "Search for items across your containers.", role: "player" },
    // ── logs ──
    { name: "logs:dune-cache", desc: "Show dune-cache container logs.", role: "player" },
    { name: "logs:dune-generated", desc: "Show dune-generated container logs.", role: "player" },
    { name: "logs:dune-server", desc: "Show dune-server container logs.", role: "player" },
    { name: "logs:dune-steam", desc: "Show dune-steam container logs.", role: "player" },
    { name: "logs:dune-work", desc: "Show dune-work container logs.", role: "player" },
    { name: "logs:orchestrator", desc: "Show orchestrator container logs.", role: "player" },
    { name: "logs:redblink-dune-docker-console", desc: "Show console adapter logs.", role: "player" },
    // ── ops ──
    { name: "ops:activity", desc: opsDescriptionFor("activity"), role: "player" },
    { name: "ops:combat", desc: opsDescriptionFor("combat"), role: "player" },
    { name: "ops:resources", desc: opsDescriptionFor("resources"), role: "player" },
    { name: "ops:economy", desc: opsDescriptionFor("economy"), role: "player" },
    { name: "ops:armory", desc: opsDescriptionFor("armory"), role: "player" },
    { name: "ops:location", desc: opsDescriptionFor("location"), role: "player" },
    { name: "ops:soc", desc: opsDescriptionFor("soc"), role: "player" },
    { name: "ops:prometheus", desc: opsDescriptionFor("prometheus"), role: "player" },
    { name: "ops:dashboard", desc: opsDescriptionFor("dashboard"), role: "player" },
    { name: "ops:announcements", desc: opsDescriptionFor("announcements"), role: "player" },
    // Regression fix (issue #162): ops:alerts is registered and
    // dispatchable (buildDuneCommand()'s ops group, commands.js's
    // OPS_SUBCOMMAND_NAMES special-case for querying Prometheus alerts
    // directly rather than through Core) but had been silently omitted
    // from this hardcoded list -- exactly the same class of bug this
    // test's own regression-guard comment above already describes for
    // the player/logs groups. `/dune help` was hiding a real command.
    { name: "ops:alerts", desc: opsDescriptionFor("alerts"), role: "player" },
    // ── admin ──
    { name: "admin:doctor", desc: "Comprehensive system diagnostic.", role: "admin" },
    { name: "admin:cooldowns", desc: "Show active cooldowns.", role: "admin" },
    { name: "admin:latency", desc: "Adapter latency history.", role: "admin" },
    { name: "admin:events", desc: "Recent incident log.", role: "admin" },
    { name: "admin:roles", desc: "Show configured admin/player roles with current names.", role: "admin" },
    { name: "admin:broadcast", desc: "Send a message to all players.", role: "admin" },
    { name: "admin:sync-commands", desc: "Check Core's command catalog for drift against the bot's registry.", role: "admin" },
    // ── infra ──
    { name: "infra:version", desc: "Dune stack version.", role: "player" },
    { name: "infra:servers", desc: "List game servers.", role: "player" },
    { name: "infra:ports", desc: "Network port status.", role: "player" },
    { name: "infra:db", desc: "Database status and health.", role: "player" },
  ];
  // The write group is only registered when writes are enabled
  // (buildDuneCommand() appends it conditionally) -- list it here only in
  // that same case so help always mirrors what is actually registered.
  if (writesEnabled(config)) {
    all.push(...WRITE_HELP_ENTRIES);
  }
  const available = []; const locked = [];
  for (const cmd of all) {
    // Write commands are gated by write-owner/write-admin roles
    // (canWrite()), not the normal observer/admin RBAC used by
    // isCommandAllowed() -- classify them with their real gate.
    if (cmd.name.startsWith("write:")) {
      if (canWrite(interaction, config, null, db, guildId)) available.push(cmd); else locked.push(cmd);
    } else if (cmd.name === "admin:roles" || isCommandAllowed(interaction, cmd.name, config, db, guildId)) {
      // admin:roles matches executeDuneCommand's own bypass above -- it
      // must not show as "locked" in help when it's actually invokable.
      available.push(cmd);
    } else {
      locked.push(cmd);
    }
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
async function fetchPrometheusAlerts(adapterClient, actor, guildId) {
  const prometheusUrl = process.env.DUNE_PROMETHEUS_URL || "http://localhost:9090";
  try {
    const resp = await fetch(`${prometheusUrl}/api/v1/alerts`);
    const data = await resp.json();
    const alerts = data?.data?.alerts || [];

    const firing = alerts.filter(a => a.state === "firing");
    const pending = alerts.filter(a => a.state === "pending");

    return {
      ok: true,
      alerts: {
        total: alerts.length,
        firing: firing.length,
        pending: pending.length,
        summary: firing.map(a => ({
          alertname: a.labels?.alertname || "unknown",
          severity: a.labels?.severity || "none",
          instance: a.labels?.instance || "unknown",
          summary: a.annotations?.summary || a.annotations?.description || "",
          startsAt: a.activeAt || a.startsAt,
          state: a.state
        })).sort((a, b) => {
          const order = { critical: 0, warning: 1, info: 2 };
          return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
        })
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: `Failed to query Prometheus alerts: ${error.message}`,
      hint: "Is Prometheus running? Try `dune metrics start` on your server."
    };
  }
}

/**
 * /dune admin sync-commands — Core catalog drift check (issues #192/#196).
 *
 * Read-only by design: fetches the INVOKING guild's own Core catalog,
 * validates it, and reports how it differs from the bot's committed
 * registry artifact. It never mutates shared state — in multi-tenant
 * mode each guild talks to its own Core, and caching one tenant's
 * catalog process-wide let any tenant poison what every other tenant
 * and the public API saw (#192). Nothing re-registers Discord slash
 * commands at runtime either (registration happens at deploy from
 * code), so the old "bot will use updated commands" claim was false
 * (#196) — drift reported here is acted on by regenerating the
 * committed artifact (npm run registry:generate) and deploying.
 */
async function syncCommandsPayload(adapterClient, actor, guildId) {
  try {
    const committed = getRegistryFromCache();
    const meta = getRegistryMetadata();
    const fetched = await fetchCoreCatalogForGuild(adapterClient, actor, guildId);
    const drift = diffRegistries(committed, fetched);

    logInfo("sync_commands.drift_check", {
      guildId,
      inSync: drift.inSync,
      added: drift.added.length,
      removed: drift.removed.length
    });

    return {
      ok: true,
      action: "sync-commands",
      message: drift.inSync
        ? "Core's catalog matches the bot's committed registry."
        : "Core's catalog has drifted from the bot's committed registry.",
      registry: { version: meta.version, groups: meta.groups, commandCount: meta.commandCount },
      coreCatalog: {
        version: fetched.version,
        groups: fetched.groups.length,
        commandCount: fetched.groups.reduce((sum, g) => sum + (g.subcommands?.length || 0), 0)
      },
      drift: {
        inSync: drift.inSync,
        // Capped so a hostile/buggy Core can't flood the Discord reply
        added: drift.added.slice(0, 15),
        removed: drift.removed.slice(0, 15),
        addedCount: drift.added.length,
        removedCount: drift.removed.length
      },
      timestamp: new Date().toISOString(),
      note: "Read-only drift check. Slash-command registration only changes on bot deploy; regenerate src/commands-registry.json (npm run registry:generate) to update the committed artifact."
    };
  } catch (error) {
    logError("sync_commands.failed", error, { guildId, status: error?.status });

    // SEC-2: map failures to generic user messages (never leak internals).
    // Classified by the adapter's real HTTP status, preserved on the
    // error by fetchCoreCatalogForGuild() — never by message substrings,
    // which misfired on timeout durations containing "500" (#199).
    const isTimeout = /timed?\s?out/i.test(error.message || "");
    let userMessage = "Failed to check Core's catalog. Check Core status and try again.";
    if (isTimeout) {
      userMessage = "Request timed out. Core may be unresponsive.";
    } else if (error.status === 401) {
      userMessage = "Authentication failed. Check adapter configuration.";
    } else if (error.status === 403) {
      userMessage = "Permission denied. Check Core admin settings.";
    } else if (error.status === 404) {
      userMessage = "Core does not expose a command catalog (endpoint not found). Your Core version may predate command discovery.";
    } else if (typeof error.status === "number" && error.status >= 500) {
      userMessage = "Core encountered an error. Try again in a few minutes.";
    }

    return {
      ok: false,
      error: userMessage,
      hint: "Run /dune core help for more information.",
      timestamp: new Date().toISOString()
    };
  }
}

export function requiredRoleIdsForCommand(command, rbac) { return rbac?.commandRoleIds?.[command] || []; }

// Public command registry for the landing page and docs auto-generation.
// Served verbatim by GET /api/commands (setupServer.js) to the
// acp-landing accordion — the shape below IS the public contract
// ({ group, title, commands: [{ name, desc, role }] }) and is pinned by
// a regression test. Issues #193/#203: this must stay a curated,
// display-only projection of the commands buildDuneCommand() actually
// registers — never the internal Core-catalog registry, which both
// diverges from the real command tree (#196) and leaks Core's adapter
// routes/capabilities/methods to unauthenticated callers (#203).
export function getCommandRegistry() {
  return [
    {
      group: "server",
      title: "Sietch Watch — Server Health",
      commands: [
        { name: "health", desc: "Check the console Discord adapter", role: "player" },
        { name: "status", desc: "Show high-level server status", role: "player" },
        { name: "summary", desc: "Show compact aggregate server status", role: "player" },
        { name: "readiness", desc: "Show readiness and preflight state", role: "player" },
        { name: "readiness-detail", desc: "Show grouped readiness detail with issues", role: "player" },
        { name: "services", desc: "Show service container state", role: "player" },
        { name: "services-detail", desc: "Show detailed service state with logs", role: "player" },
        { name: "maintenance", desc: "Show maintenance mode status (read-only)", role: "player" }
      ]
    },
    {
      group: "player",
      title: "The Personal Ledger — Player Tools",
      commands: [
        { name: "link <name>", desc: "Link Discord to your in-game character", role: "player" },
        { name: "verify <code>", desc: "Verify a pending character link with a code", role: "player" },
        { name: "characters", desc: "List your verified characters", role: "player" },
        { name: "enable <id>", desc: "Enable a character in this guild", role: "player" },
        { name: "disable <id>", desc: "Disable a character in this guild", role: "player" },
        { name: "default <id>", desc: "Set your default character for this guild", role: "player" },
        { name: "unlink <id>", desc: "Unlink a character from your Discord", role: "player" },
        { name: "faction <name>", desc: "Set your faction for themed embeds", role: "player" },
        { name: "whoami", desc: "Show your linked game character info", role: "player" },
        { name: "inventory", desc: "View your personal inventory", role: "player" },
        { name: "storage", desc: "View your storage containers grouped by map", role: "player" },
        { name: "find <item>", desc: "Search for items across your containers", role: "player" }
      ]
    },
    {
      group: "ops",
      title: "Deep Desert Intel — Operations",
      commands: [
        { name: "activity", desc: "Player activity statistics", role: "player" },
        { name: "combat", desc: "Combat and death statistics", role: "player" },
        { name: "resources", desc: "Resource field data (spice, water, minerals)", role: "player" },
        { name: "economy", desc: "Currency, trading, and tax data", role: "player" },
        { name: "armory", desc: "Server-wide aggregate inventory stats", role: "player" },
        { name: "location", desc: "Show map location activity (markers, density)", role: "player" },
        { name: "prometheus", desc: "Container and infrastructure metrics", role: "player" },
        { name: "soc", desc: "Bridge health and request stats", role: "player" },
        { name: "dashboard", desc: "Aggregated operational summary", role: "player" },
        { name: "announcements", desc: "Show recent server announcements", role: "player" },
        { name: "alerts", desc: "Show active Prometheus alerts", role: "player" }
      ]
    },
    {
      group: "data",
      title: "Data Archives — Server Archives",
      commands: [
        { name: "population", desc: "Show server population statistics", role: "player" },
        { name: "backups", desc: "List recent database backups", role: "player" },
        { name: "maps", desc: "Show active game maps", role: "player" }
      ]
    },
    {
      group: "logs",
      title: "Logs Explorer — Server Logs",
      // #217/C4 + #217/A8: roles corrected to match real enforcement
      // (observer tier, displayed as "player"); the last entry's name is
      // the REAL registered subcommand (there is no /dune logs console).
      commands: [
        { name: "dune-cache", desc: "View game cache service logs", role: "player" },
        { name: "dune-generated", desc: "View game generated logs", role: "player" },
        { name: "dune-server", desc: "View game server logs by name", role: "player" },
        { name: "dune-steam", desc: "View Steam integration logs", role: "player" },
        { name: "dune-work", desc: "View game work logs", role: "player" },
        { name: "orchestrator", desc: "View orchestrator service logs", role: "player" },
        { name: "redblink-dune-docker-console", desc: "View the console's own container logs", role: "player" }
      ]
    },
    {
      group: "admin",
      title: "Kanly Council — Admin",
      commands: [
        { name: "doctor", desc: "Full system diagnostic across all services", role: "admin" },
        { name: "cooldowns", desc: "Show active command cooldowns", role: "admin" },
        { name: "latency", desc: "Adapter request latency history", role: "admin" },
        { name: "events", desc: "Recent server incidents and alerts", role: "admin" },
        { name: "roles", desc: "Show configured Discord role mappings", role: "admin" },
        { name: "broadcast <msg>", desc: "Send a message to all in-game players", role: "admin" },
        { name: "sync-commands", desc: "Check Core's command catalog for drift", role: "admin" }
      ]
    },
    {
      group: "infra",
      title: "Foundation Stones — Infrastructure",
      commands: [
        { name: "version", desc: "Dune stack version", role: "player" },
        { name: "servers", desc: "List game servers", role: "player" },
        { name: "ports", desc: "Network port status", role: "player" },
        { name: "db", desc: "Database status and health", role: "player" }
      ]
    },
    {
      group: "core",
      title: "Mentat — Core Commands",
      commands: [
        { name: "about", desc: "Bot version, security info, connection details", role: "player" },
        { name: "ping", desc: "Test Discord and adapter latency", role: "player" },
        { name: "help", desc: "List all commands you have permission to use", role: "player" },
        { name: "setup", desc: "How to add this bot to your own Discord server", role: "player" }
      ]
    }
  ];
}
