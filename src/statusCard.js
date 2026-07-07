import { generateStatusCard } from "../scripts/generate-status-card.js";
import { AttachmentBuilder } from "discord.js";

const QUOTES = [
  "The spice must flow.",
  "Fear is the mind-killer.",
  "Bless the Maker and His water.",
  "Walk without rhythm.",
  "He who controls the spice controls the universe.",
];

export async function sendStatusCard({ interaction, statusData, title, quote } = {}) {
  const r = statusData?.result || statusData || {};
  const maps = (Array.isArray(r.maps) ? r.maps : []).map(m => ({
    name: m.name || "?",
    state: m.state || m.status || "UNKNOWN",
    uptime: m.uptime || ""
  }));

  const canvas = await generateStatusCard({
    title: title || r.title || "Server",
    overall: r.overall || "UNKNOWN",
    region: r.region || "",
    mode: r.mode || "",
    population: r.population || "—",
    maps,
    services: Array.isArray(r.services) ? r.services.length : 0,
    latency: 0,
    quote: quote || QUOTES[Math.floor(Math.random() * QUOTES.length)]
  });

  const buffer = canvas.toBuffer("image/png");
  const attachment = new AttachmentBuilder(buffer, { name: "status-card.png" });

  await interaction.editReply({ files: [attachment], embeds: [] });
}
