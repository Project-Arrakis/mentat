import { getLiveMessage, setLiveMessage } from "./database.js";

// liveMessage.js (mentat#370): shared "bot edits its own message in place"
// infrastructure. Nothing in this bot did this before -- confirmed by
// direct exploration (no messages.edit/stored-message-ID pattern anywhere
// in src/*.js) -- so this is new shared code, not an extension of an
// existing pattern. Built here (the Coriolis countdown, the simplest real
// consumer) so mentat#369 (Landsraad tracker) and mentat#372 (duty status
// embeds) can reuse it instead of each inventing their own copy.
//
// Looks up a previously-posted message by a stable (guildId, messageKey)
// pair and edits it in place; falls back to posting a fresh message (and
// recording its ID) if none exists yet, or if the recorded message/channel
// is gone (deleted by a moderator, channel removed, etc.) -- a live status
// display should never hard-fail just because its last post disappeared.
export async function postOrEditLiveMessage({ client, db, guildId, channelId, messageKey, content }) {
  const existing = getLiveMessage(db, guildId, messageKey);
  if (existing) {
    try {
      const channel = await client.channels.fetch(existing.channel_id);
      if (channel?.isTextBased?.()) {
        const message = await channel.messages.fetch(existing.message_id);
        await message.edit(content);
        return { edited: true, channelId: existing.channel_id, messageId: existing.message_id };
      }
    } catch {
      // Stored message/channel no longer resolves (deleted, permissions
      // changed, etc.) -- fall through and post a fresh one below rather
      // than throwing, since a stale pointer must not break the feature.
    }
  }

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased?.()) {
    throw new Error(`Channel ${channelId} is not text-based or could not be found.`);
  }
  const message = await channel.send(content);
  setLiveMessage(db, guildId, messageKey, channelId, message.id);
  return { edited: false, channelId, messageId: message.id };
}
