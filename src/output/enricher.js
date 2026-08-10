// Shared enrichment applied to ALL bot output (embeds and text).
// Single edit site for global properties like footer, timestamp, and
// version metadata. Previously these were scattered across 4 output paths.

const SAND_EMOJI = "\u{1F3DC}\uFE0F";

export function enrichEmbed(embed, context = {}) {
  if (!embed.data.footer) {
    embed.setFooter({ text: buildFooter(context) });
  }
  embed.setTimestamp(new Date().toISOString());
  return embed;
}

export function enrichContent(content, context = {}) {
  return `${content}\n\n${SAND_EMOJI} ${buildFooter(context)}`;
}

function buildFooter(context = {}) {
  const parts = []; let pkgVersion;
  try {
    // Dynamic import to avoid crash if package.json is unreadable
    pkgVersion = require("../../package.json").version;
  } catch {
    pkgVersion = "unknown";
  }
  if (context.coreVersion) parts.push(`Core v${context.coreVersion}`);
  parts.push(`v${pkgVersion}`);
  const now = new Date();
  return `${SAND_EMOJI} Arrakis Control Panel · ${parts.join(" · ")} · ${now.toISOString().slice(0, 16).replace("T", " ")}`;
}
