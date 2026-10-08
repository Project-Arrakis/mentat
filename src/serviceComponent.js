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
import { logError } from "./logger.js";

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
  try {
    if (grant) {
      await interaction.member.roles.add(settings.on_duty_role_id);
    } else {
      await interaction.member.roles.remove(settings.on_duty_role_id);
    }
  } catch {
    // /code-review high finding: the caller's service_duty_status write
    // already committed by the time this runs -- a role mutation failure
    // (missing permission, role positioned above the bot's own) must not
    // throw out of handleServiceButtonInteraction and skip the pinned-
    // embed refresh and the user's confirmation reply. This is
    // best-effort infra (same posture as the "not configured" no-op
    // above), not the source of truth for on-duty state.
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
        content: `You need the <@&${serviceChannel?.role_id}> role first — click Apply below.`,
        ephemeral: true
      });
      return true;
    }
    // /code-review high finding: role mutation + a channel fetch + a
    // message fetch/edit (inside refreshServiceStatusMessage) all happen
    // before any reply -- under real Discord API latency this can
    // exceed the ~3s interaction-ack deadline, making the final reply()
    // throw "Unknown interaction" even though the toggle itself already
    // succeeded. Deferring immediately removes that deadline; editReply()
    // below isn't time-bound the same way.
    await interaction.deferReply({ ephemeral: true });
    if (action === "onduty") {
      setDutyStatus(db, guildId, serviceKey, interaction.user.id);
      await toggleGenericOnDutyRole(interaction, db, guildId, true);
    } else {
      clearDutyStatus(db, guildId, serviceKey, interaction.user.id);
      await toggleGenericOnDutyRole(interaction, db, guildId, false);
    }
    await refreshServiceStatusMessage({ client, db, guildId, serviceChannel, serviceKey });
    await interaction.editReply({ content: action === "onduty" ? "You're now on duty." : "You're now off duty." });
    return true;
  }

  if (action === "apply") {
    const serviceKey = identifier;
    const serviceChannel = getServiceChannel(db, guildId, serviceKey);
    const hasRole = extractRoleIds(interaction).includes(serviceChannel?.role_id);
    if (hasRole) {
      await interaction.reply({ content: `You're already <@&${serviceChannel?.role_id}>.`, ephemeral: true });
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
    if (resolved.alreadyResolved) {
      // A double-click or a race with another admin -- the row is
      // already in a final state; never re-run role-grant/DM/message-edit
      // side effects a second time.
      await interaction.reply({ content: `This application was already ${resolved.status}.`, ephemeral: true });
      return true;
    }

    // /code-review high finding: this branch's success path never
    // acknowledged the interaction at all (no reply/update/deferUpdate),
    // so Discord showed "This interaction failed" on every single
    // Approve/Deny click even though the action fully succeeded.
    // deferUpdate() acknowledges without producing new visible content --
    // the actual message update still happens via the plain REST
    // reviewMessage.edit() call below, which isn't bound by the
    // interaction-response deadline once deferred. Placed here, after
    // the not-found/already-resolved early returns above (which use a
    // real interaction.reply() instead -- calling deferUpdate() first
    // would make those reply() calls throw "already acknowledged").
    await interaction.deferUpdate();

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
          ? `Approved by <@${interaction.user.id}> — role grant FAILED, add <@&${serviceChannel.role_id}> manually`
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

  // /code-review high finding: unlike the apply-button handler's
  // serviceChannel?.role_id optional chaining, this dereferenced
  // serviceChannel.review_channel_id unguarded -- a stale/inconsistent
  // DB state (e.g. a restored backup) would throw here AFTER
  // createApplication() already committed the row, leaving the
  // applicant with no "submitted" confirmation and staff with no review
  // post to act on. The application already exists either way; tell the
  // applicant it was received and log the inconsistency for staff to
  // investigate, rather than letting a TypeError propagate.
  const serviceChannel = getServiceChannel(db, guildId, serviceKey);
  if (!serviceChannel) {
    logError("service_component.modal_submit_no_service_channel", new Error("no service_channels row"), { guildId, serviceKey, applicationId: result.application.id });
    await interaction.reply({
      content: "Your application was recorded, but this service isn't fully configured right now -- please contact staff directly.",
      ephemeral: true
    });
    return true;
  }
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
      // /code-review high finding: a raw backtick in proofLink could break
      // out of the code span and re-enable the exact masked-link phishing
      // vector this field exists to prevent -- strip backticks (a
      // legitimate proof link/text never needs one) rather than trust the
      // wrapping alone.
      { name: "Proof Link", value: proofLink ? `\`${String(proofLink).replace(/`/g, "'")}\`` : "(none provided)" }
    ]
  });
  const approveDenyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`service:approve:${result.application.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`service:deny:${result.application.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
  );

  // /code-review high finding: an unguarded fetch/send here (channel
  // deleted, bot lacks permission, non-text channel) would throw after
  // createApplication() already committed -- the applicant would never
  // see the "submitted" reply even though their application exists.
  // The DB row is the source of truth regardless; log the failure for
  // staff to notice a review post never went out, same posture as the
  // approve/deny handler's own guarded review-message fetch/edit.
  try {
    const reviewChannel = await client.channels.fetch(serviceChannel.review_channel_id);
    const reviewMessage = await reviewChannel.send({ embeds: [reviewEmbed], components: [approveDenyRow] });
    setApplicationReviewMessage(db, result.application.id, reviewMessage.id);
  } catch (error) {
    logError("service_component.modal_submit_review_post_failed", error, { guildId, serviceKey, applicationId: result.application.id, reviewChannelId: serviceChannel.review_channel_id });
  }

  await interaction.reply({
    content: "Your application has been submitted. You'll be notified by DM once it's reviewed.",
    ephemeral: true
  });
  return true;
}
