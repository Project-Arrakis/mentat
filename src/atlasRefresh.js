import { formatAtlasEmbed } from "./embedFormat.js";
import { postOrEditLiveMessage } from "./liveMessage.js";

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
function schedulerActor() {
  return { userId: "scheduler", username: "Mentat", guildId: "scheduler", channelId: "scheduler", roleIds: [] };
}

export function atlasRefresher({ adapterClient, client, db, channelId, messageKey = "atlas", onError = () => {} }) {
  async function refresh() {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.() || !channel.guildId) {
        throw new Error(`Channel ${channelId} is not a guild text channel.`);
      }
      const payload = await adapterClient.atlas(schedulerActor());
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
