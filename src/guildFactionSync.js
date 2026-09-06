// Auto-syncs a Discord server's cosmetic themed-embed faction
// (guild_settings.faction, statusCard.js) from real in-game guild
// membership, closing the gap tracked in mentat#251: setGuildFaction()
// existed but had no caller anywhere, so this feature was permanently
// unreachable since it shipped.
//
// Real signal, not a manual setting: tallies each bot-active Discord
// member's real IN-GAME GUILD's faction (dune-awakening-selfhost-
// docker#699/#700's guilds/faction-summary route) -- a genuinely
// different game concept from an individual player's own personal
// faction (see that route's own comment for the distinction: a faction
// can have thousands of members, an in-game guild is a much smaller,
// max-32-member player organization). Member list comes from
// guild_member_activity (database.js), not a real Discord member fetch
// -- this bot only holds the Guilds gateway intent, not the privileged
// GuildMembers intent needed for guild.members.fetch() to return
// anything real.
//
// Deliberately conservative about WHEN to update the stored value:
// - An empty tally (no data at all) leaves the existing setting alone --
//   never resets a real value to blank on a fluke empty result.
// - A tie for the top count leaves the existing setting alone too,
//   rather than flapping unpredictably between two equally-likely
//   factions on repeated syncs.
// - A tallied faction name that doesn't loosely match one of the three
//   known houses (factionKeyFromName() returning undefined) is treated
//   the same as an untallied one -- never written as a raw, arbitrary
//   string into guild_settings.faction's fixed CHECK constraint.
import { factionKeyFromName } from "./embedFormat.js";
import { getGuildMemberActivityIds, setGuildFaction } from "./database.js";

function pickMajorityFactionKey(tally) {
  let bestKey;
  let bestCount = 0;
  let tied = false;
  for (const [name, count] of Object.entries(tally || {})) {
    const key = factionKeyFromName(name);
    if (!key) continue;
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
      tied = false;
    } else if (count === bestCount && key !== bestKey) {
      tied = true;
    }
  }
  return tied ? undefined : bestKey;
}

// Best-effort, fire-and-forget from the caller's perspective -- this is a
// side effect of /dune player faction, never allowed to fail or slow down
// that command's own primary response to the user.
export async function syncGuildFactionTheme(db, adapterClient, actor, guildId) {
  if (!db || !guildId) return;
  try {
    const discordUserIds = getGuildMemberActivityIds(db, guildId);
    if (!discordUserIds.length) return;
    const summary = await adapterClient.guildFactionSummary(actor, discordUserIds, guildId);
    if (!summary?.ok) return;
    const factionKey = pickMajorityFactionKey(summary.tally);
    if (!factionKey) return;
    setGuildFaction(db, guildId, factionKey);
  } catch {
    // Best-effort -- never break /dune player faction's own response.
  }
}
