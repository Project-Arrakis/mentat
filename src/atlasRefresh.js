import { formatAtlasEmbed } from "./embedFormat.js";
import { postOrEditLiveMessage } from "./liveMessage.js";
import { parseCsv } from "./scheduler.js";

// atlasRefresh.js (mentat#376, dune-awakening-selfhost-docker#938): the
// first real caller of liveMessage.js's postOrEditLiveMessage() -- #370
// shipped that utility unused (its Coriolis countdown needs no server-side
// refresh loop, per liveMessage.js's own comment), so this is genuinely new
// wiring, not an extension of an existing consumer.
//
// guildId is resolved from the channel itself (client.channels.fetch(...).
// guildId), not from a second env var -- one fewer thing an operator can
// misconfigure, and it's always correct for whichever guild the configured
// channel actually belongs to.
//
// That resolved guildId MUST also be passed as AdapterClient.atlas()'s own
// second argument, not just embedded in the actor object -- request()
// resolves each guild's own Core base URL from ITS OWN guildId parameter
// (_resolveConfig(guildId)), falling back to the placeholder base URL
// ("http://placeholder" in multi-tenant mode with no top-level
// DUNE_CONSOLE_API_URL) when it's missing or unresolvable. A first live
// deploy of this refresher (2026-09-18) omitted this and failed every
// refresh with a generic "fetch failed" TypeError against that literal
// placeholder host -- caught immediately from the bot's own logs, not
// discovered in code review.
// roleIds is not empty here on purpose (2026-09-27, real finding from
// Core's own automated PR review, dune-awakening-selfhost-docker#1075):
// Core only includes the real sietch login password in its response when
// the CALLING actor's own roleIds intersect its DUNE_ATLAS_PASSWORD_ROLE_IDS
// allowlist -- a Discord channel's permission lock has no bearing on that
// check at all. Without this, the scheduled refresh (an empty-roleIds
// "scheduler" identity) would silently never receive the password, even
// though #the-atlas is locked down specifically so it can be shown there.
// The operator must configure this env var identically to Core's own
// DUNE_ATLAS_PASSWORD_ROLE_IDS for the two sides to agree.
function schedulerActor(guildId) {
  return { userId: "scheduler", username: "Mentat", guildId, channelId: "scheduler", roleIds: parseCsv(process.env.DUNE_ATLAS_PASSWORD_ROLE_IDS) };
}

export function atlasRefresher({ adapterClient, client, db, channelId, messageKey = "atlas", onError = () => {} }) {
  async function refresh() {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.() || !channel.guildId) {
        throw new Error(`Channel ${channelId} is not a guild text channel.`);
      }
      const payload = await adapterClient.atlas(schedulerActor(channel.guildId), channel.guildId);
      const embed = formatAtlasEmbed(payload);
      await postOrEditLiveMessage({
        client,
        db,
        guildId: channel.guildId,
        channelId,
        messageKey,
        content: { embeds: [embed] }
      });
    } catch (error) {
      onError(error);
    }
  }

  return { refresh };
}
