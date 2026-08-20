// Shared enrichment applied to ALL bot output (embeds and text).
// Single edit site for global properties like footer, timestamp, and
// version metadata. Previously these were scattered across 4 output paths.

import { createRequire } from "node:module";

const SAND_EMOJI = "\u{1F3DC}\uFE0F";

// #215/A3: this module is ESM ("type": "module"), so a bare require()
// ALWAYS threw and every error embed's footer permanently read
// "vunknown" — the one place version info would help debugging.
// createRequire() is the supported way to read JSON from ESM.
let pkgVersion = "unknown";
try {
  pkgVersion = createRequire(import.meta.url)("../../package.json").version;
} catch {
  // leave "unknown" — a missing/corrupt package.json must not crash output
}

export function enrichEmbed(embed, context = {}) {
  if (!embed.data.footer) {
    embed.setFooter({ text: buildFooter(context) });
  }
  embed.setTimestamp(new Date());
  return embed;
}

export function enrichContent(content, context = {}) {
  // #221/F8: buildFooter() already leads with the emoji — no double 🏜️.
  return `${content}\n\n${buildFooter(context)}`;
}

function buildFooter(context = {}) {
  const parts = [];
  if (context.coreVersion) parts.push(`Core v${context.coreVersion}`);
  parts.push(`v${pkgVersion}`);
  // #217/C2: no text-format time here — enrichEmbed()'s setTimestamp()
  // already renders the time localized to each viewer, and the old UTC
  // ISO string both duplicated it and diverged from duneEmbed's footer.
  return `${SAND_EMOJI} Dune: Awakening Docker — Sentinel · ${parts.join(" · ")}`;
}
