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
  const msg = String(error);
  // Split adapter errors into user-friendly message + technical details
  let friendly = msg;
  let detail = "";
  const jsonIdx = msg.indexOf("{");
  if (jsonIdx > 0) {
    friendly = msg.slice(0, jsonIdx).trim();
    detail = msg.slice(jsonIdx);
  }
  const embed = new EmbedBuilder()
    .setTitle("\u274C Error")
    // #217/C3: one error red everywhere (matches embedFormat.js's
    // DUNE_COLORS.error) instead of two competing shades.
    .setColor(0xE74C3C)
    .setDescription(friendly.slice(0, 2048));
  if (detail) {
    try {
      const parsed = JSON.parse(detail);
      const errorMsg = parsed.error || parsed.message || "";
      if (errorMsg && errorMsg !== friendly) {
        embed.addFields({ name: "Details", value: String(errorMsg).slice(0, 1024), inline: false });
      }
    } catch {
      // Not valid JSON — show truncated detail
      if (detail.length > 5) {
        embed.addFields({ name: "Details", value: String(detail).slice(0, 256), inline: false });
      }
    }
  }
  const enriched = enrichEmbed(embed, context);
  return interaction.editReply({ embeds: [enriched] });
}

export async function sendText(interaction, { content, context = {} } = {}) {
  const enriched = enrichContent(content, context);
  return interaction.editReply({ content: enriched });
}

export async function sendEphemeral(interaction, { title, description, color = 0xE74C3C } = {}) {
  const embed = { title, description, color };
  return interaction.reply({ embeds: [embed], ephemeral: true });
}
