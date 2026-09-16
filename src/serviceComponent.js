// serviceComponent.js (mentat#372): the generalized On Duty/Off Duty/
// Apply button component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md and
// the Layer 1 audit findings register (mentat#372 issue comments) for
// why each piece of this file is shaped the way it is.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { duneEmbed } from "./embedFormat.js";
import { listOnDuty, getServiceChannel, setDutyStatus, clearDutyStatus, getPendingApplication } from "./serviceChannels.js";
import { getGuildSettings } from "./database.js";
import { postOrEditLiveMessage } from "./liveMessage.js";
import { extractRoleIds } from "./commands.js";

export function buildServiceStatusEmbed(db, guildId, serviceKey, serviceDisplayName) {
  const onDuty = listOnDuty(db, guildId, serviceKey);
  const rosterValue = onDuty.length === 0
    ? "No one currently on duty"
    : onDuty.map(row => `<@${row.user_id}>`).join("\n");

  const embed = duneEmbed({
    title: `${serviceDisplayName} Duty Status`,
    description: "Click below to go on/off duty, or apply for this role.",
    fields: [{ name: "On Duty", value: rosterValue }]
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`service:onduty:${serviceKey}`).setLabel("On Duty").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`service:offduty:${serviceKey}`).setLabel("Off Duty").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`service:apply:${serviceKey}`).setLabel("Apply").setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

async function refreshServiceStatusMessage({ client, db, guildId, serviceChannel, serviceKey }) {
  const { embeds, components } = buildServiceStatusEmbed(db, guildId, serviceKey, serviceKey);
  await postOrEditLiveMessage({
    client, db, guildId,
    channelId: serviceChannel.channel_id,
    messageKey: `service:duty:${serviceKey}`,
    content: { embeds, components }
  });
}

async function toggleGenericOnDutyRole(interaction, db, guildId, grant) {
  const settings = getGuildSettings(db, guildId);
  if (!settings?.on_duty_role_id) return; // Not configured -- optional infra, skip silently.
  if (grant) {
    await interaction.member.roles.add(settings.on_duty_role_id);
  } else {
    await interaction.member.roles.remove(settings.on_duty_role_id);
  }
}

export async function handleServiceButtonInteraction(interaction, db, client, config) {
  if (!interaction?.isButton?.()) return false;
  const parts = String(interaction.customId || "").split(":");
  if (parts[0] !== "service") return false;
  // Third customId segment: a serviceKey for onduty/offduty/apply, but an
  // applicationId (numeric) for approve/deny -- kept as one destructured
  // `identifier` to make that distinction explicit rather than reusing a
  // `serviceKey`-named variable for something that isn't one in half the
  // branches below.
  const [, action, identifier] = parts;
  const guildId = interaction.guildId;

  if (action === "onduty" || action === "offduty") {
    const serviceKey = identifier;
    const serviceChannel = getServiceChannel(db, guildId, serviceKey);
    const hasRole = extractRoleIds(interaction).includes(serviceChannel?.role_id);
    if (!hasRole) {
      await interaction.reply({
        content: `You need the \`${serviceKey}\` role first — click Apply below.`,
        ephemeral: true
      });
      return true;
    }
    if (action === "onduty") {
      setDutyStatus(db, guildId, serviceKey, interaction.user.id);
      await toggleGenericOnDutyRole(interaction, db, guildId, true);
    } else {
      clearDutyStatus(db, guildId, serviceKey, interaction.user.id);
      await toggleGenericOnDutyRole(interaction, db, guildId, false);
    }
    await refreshServiceStatusMessage({ client, db, guildId, serviceChannel, serviceKey });
    await interaction.reply({ content: action === "onduty" ? "You're now on duty." : "You're now off duty.", ephemeral: true });
    return true;
  }

  if (action === "apply") {
    const serviceKey = identifier;
    const serviceChannel = getServiceChannel(db, guildId, serviceKey);
    const hasRole = extractRoleIds(interaction).includes(serviceChannel?.role_id);
    if (hasRole) {
      await interaction.reply({ content: `You're already a \`${serviceKey}\`.`, ephemeral: true });
      return true;
    }
    if (getPendingApplication(db, guildId, serviceKey, interaction.user.id)) {
      await interaction.reply({ content: "You already have a pending application.", ephemeral: true });
      return true;
    }
    const modal = new ModalBuilder()
      .setCustomId(`service:applymodal:${serviceKey}`)
      .setTitle(`Apply: ${serviceKey}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("characterName").setLabel("Character Name").setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("proofLink").setLabel("Proof Link (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false)
        )
      );
    await interaction.showModal(modal);
    return true;
  }

  return false;
}
