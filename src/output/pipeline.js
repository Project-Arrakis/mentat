// Unified output pipeline — single call site for all bot responses.
// Replaces the 4 previously-independent output paths:
//   1. duneEmbed() styled embeds
//   2. sendStatusCard() PNG image cards
//   3. formatError() raw text
//   4. Raw text + button (Steam link)
//
// Every command calls: pipeline.send(interaction, { type, ...context })

import { EmbedBuilder } from "discord.js";
import { enrichEmbed, enrichContent } from "./enricher.js";

export async function sendEmbed(interaction, { embed, context = {} } = {}) {
  const enriched = enrichEmbed(embed, context);
  return interaction.editReply({ embeds: [enriched] });
}

export async function sendCard(interaction, { attachment, embed, context = {} } = {}) {
  const reply = { files: [attachment] };
  if (embed) {
    const enriched = enrichEmbed(embed, context);
    reply.embeds = [enriched];
  }
  return interaction.editReply(reply);
}

export async function sendError(interaction, { error, context = {} } = {}) {
  const embed = new EmbedBuilder()
    .setTitle("\u274C Error")
    .setColor(0xdc3545)
    .setDescription(String(error).slice(0, 2048));
  const enriched = enrichEmbed(embed, context);
  return interaction.editReply({ embeds: [enriched] });
}

export async function sendText(interaction, { content, context = {} } = {}) {
  const enriched = enrichContent(content, context);
  return interaction.editReply({ content: enriched });
}

export async function sendEphemeral(interaction, { title, description, color = 0xdc3545 } = {}) {
  const embed = { title, description, color };
  return interaction.reply({ embeds: [embed], ephemeral: true });
}
