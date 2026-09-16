// serviceComponent.js (mentat#372): the generalized On Duty/Off Duty/
// Apply button component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md and
// the Layer 1 audit findings register (mentat#372 issue comments) for
// why each piece of this file is shaped the way it is.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { duneEmbed } from "./embedFormat.js";
import { listOnDuty } from "./serviceChannels.js";

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
