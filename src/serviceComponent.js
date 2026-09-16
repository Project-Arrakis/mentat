// serviceComponent.js (mentat#372): the generalized On Duty/Off Duty/
// Apply button component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md and
// the Layer 1 audit findings register (mentat#372 issue comments) for
// why each piece of this file is shaped the way it is.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { duneEmbed } from "./embedFormat.js";
import { listOnDuty, getServiceChannel, setDutyStatus, clearDutyStatus, getPendingApplication, createApplication, setApplicationReviewMessage, resolveApplication } from "./serviceChannels.js";
import { getGuildSettings } from "./database.js";
import { postOrEditLiveMessage } from "./liveMessage.js";
import { extractRoleIds, isAdminActor } from "./commands.js";

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

  if (action === "approve" || action === "deny") {
    if (!isAdminActor(interaction, config, db, guildId)) {
      await interaction.reply({ content: "You are not authorized to review applications.", ephemeral: true });
      return true;
    }

    const applicationId = Number(identifier);
    // The guild_id !== interaction.guildId check happens inside
    // resolveApplication() itself -- it returns null for a cross-guild
    // or nonexistent ID, and we treat that the same way (never leak
    // whether a differently-scoped row exists) -- there's no need to
    // pre-fetch the application separately here.
    const status = action === "approve" ? "approved" : "denied";
    const resolved = resolveApplication(db, guildId, applicationId, { status, reviewedBy: interaction.user.id });
    if (!resolved) {
      await interaction.reply({ content: "That application could not be found.", ephemeral: true });
      return true;
    }

    const serviceChannel = getServiceChannel(db, guildId, resolved.service_key);
    let roleGrantFailed = false;
    if (action === "approve") {
      try {
        const guild = await interaction.client?.guilds?.fetch?.(guildId) ?? { members: { fetch: async () => { throw new Error("no guild"); } } };
        const member = await guild.members.fetch(resolved.applicant_id);
        await member.roles.add(serviceChannel.role_id);
      } catch {
        roleGrantFailed = true;
      }
    }

    // Edit the review message to remove the buttons and show the outcome.
    try {
      const reviewChannel = await client.channels.fetch(serviceChannel.review_channel_id);
      const reviewMessage = await reviewChannel.messages.fetch(resolved.review_message_id);
      const outcomeLine = action === "approve"
        ? (roleGrantFailed
          ? `Approved by <@${interaction.user.id}> — role grant FAILED, add \`@${serviceChannel.role_id}\` manually`
          : `Approved by <@${interaction.user.id}>`)
        : `Denied by <@${interaction.user.id}>`;
      await reviewMessage.edit({ content: outcomeLine, embeds: [], components: [] });
    } catch {
      // Stale/deleted review message -- the DB mutation above already
      // happened and is the source of truth; don't throw.
    }

    // Best-effort DM -- never blocks the transaction above.
    try {
      const applicantUser = await interaction.client.users.fetch(resolved.applicant_id);
      await applicantUser.send({ content: `Your \`${resolved.service_key}\` application was ${status}.` });
    } catch {
      // DMs closed or user unreachable -- swallow, per design.
    }

    return true;
  }

  return false;
}

export async function handleServiceModalSubmit(interaction, db, client) {
  if (!interaction?.isModalSubmit?.()) return false;
  const parts = String(interaction.customId || "").split(":");
  if (parts[0] !== "service" || parts[1] !== "applymodal") return false;
  const serviceKey = parts[2];
  const guildId = interaction.guildId;

  const characterName = interaction.fields.getTextInputValue("characterName");
  const proofLink = interaction.fields.getTextInputValue("proofLink") || null;

  const result = createApplication(db, {
    guildId, serviceKey, applicantId: interaction.user.id, characterName, proofLink
  });

  if (!result.ok) {
    await interaction.reply({ content: "You already have a pending application.", ephemeral: true });
    return true;
  }

  const serviceChannel = getServiceChannel(db, guildId, serviceKey);
  const reviewEmbed = duneEmbed({
    title: `New Application: ${serviceKey}`,
    fields: [
      { name: "Applicant", value: `<@${interaction.user.id}>` },
      { name: "Character Name", value: characterName },
      // proof_link is rendered as a plain-text/code-block field -- NEVER
      // interpolated into markdown link syntax ([label](url)) -- an
      // applicant-controlled label over an applicant-controlled URL
      // would let a malicious applicant phish staff reviewers with a
      // deceptive display label.
      { name: "Proof Link", value: proofLink ? `\`${proofLink}\`` : "(none provided)" }
    ]
  });
  const approveDenyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`service:approve:${result.application.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`service:deny:${result.application.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
  );

  const reviewChannel = await client.channels.fetch(serviceChannel.review_channel_id);
  const reviewMessage = await reviewChannel.send({ embeds: [reviewEmbed], components: [approveDenyRow] });
  setApplicationReviewMessage(db, result.application.id, reviewMessage.id);

  await interaction.reply({
    content: "Your application has been submitted. You'll be notified by DM once it's reviewed.",
    ephemeral: true
  });
  return true;
}
