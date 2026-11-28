import { getLiveMessage, setLiveMessage } from "./database.js";

// liveMessage.js (mentat#370): shared "bot edits its own message in place"
// infrastructure. Nothing in this bot did this before -- confirmed by
// direct exploration (no messages.edit/stored-message-ID pattern anywhere
// in src/*.js) -- so this is new shared code, not an extension of an
// existing pattern. Built here so mentat#369 (Landsraad tracker) and
// mentat#372 (duty status embeds) can reuse it instead of each inventing
// their own copy. NOT wired to any live caller yet as of this commit --
// see this repo's CHANGELOG.md entry for #370; /dune server coriolis
// itself uses a plain one-shot reply, not this utility, since its
// countdown is fully client-side-rendered via Discord's own <t:UNIX:R>
// and needs no server-side refresh loop at all.
//
// Looks up a previously-posted message by a stable (guildId, messageKey)
// pair and edits it in place; falls back to posting a fresh message (and
// recording its ID) if none exists yet, or if the recorded message/channel
// is gone (deleted by a moderator, channel removed, etc.) -- a live status
// display should never hard-fail just because its last post disappeared.
//
// Layer 3 Security-hat finding (2026-09-16): `messageKey` becomes a SQLite
// primary-key component (parameterized, no injection risk) but is trusted
// entirely by this function -- callers MUST pass a fixed, code-defined key
// (e.g. "coriolis", "landsraad"), never anything derived from user or
// channel input, or two different guilds'/channels' features could
// collide on the same row (one feature's message pointer silently
// overwriting another's). Whoever wires mentat#369/#372 into this
// function must keep messageKey an enum of hardcoded feature names.
// strictChannel (mentat#469, opt-in, default off so existing callers are unchanged): when true, a recorded
// message in a DIFFERENT channel than the one requested is treated as stale and a fresh message is posted
// in the requested channel. Without it, changing a feature's channel setting keeps editing the old channel's message.
// rethrowTransient (mentat#469, opt-in): only fall through to a fresh post when the old message or channel is
// definitely gone (Unknown Message/Channel) or not accessible; any other failure (a 5xx, a rate limit, a network
// blip) is rethrown so the caller can retry, instead of leaving the old message behind next to a duplicate.
const GONE_CODES = new Set([10003, 10008, 50001, 50013]);
export async function postOrEditLiveMessage({ client, db, guildId, channelId, messageKey, content, strictChannel = false, rethrowTransient = false, onStaleCopy = () => {} }) {
  const existing = getLiveMessage(db, guildId, messageKey);
  if (existing && (!strictChannel || existing.channel_id === channelId)) {
    try {
      const channel = await client.channels.fetch(existing.channel_id);
      if (channel?.isTextBased?.()) {
        const message = await channel.messages.fetch(existing.message_id);
        await message.edit(content);
        return { edited: true, channelId: existing.channel_id, messageId: existing.message_id };
      }
    } catch (error) {
      // Stored message/channel no longer resolves (deleted, permissions
      // changed, etc.) -- fall through and post a fresh one below rather
      // than throwing, since a stale pointer must not break the feature.
      // With rethrowTransient, anything that is not a definite "gone" is the caller's to retry.
      if (rethrowTransient && !GONE_CODES.has(error?.code)) throw error;
    }
  } else if (existing && strictChannel) {
    // The setting moved to another channel: best-effort remove the old message so a stale copy is not left behind.
    try {
      const oldChannel = await client.channels.fetch(existing.channel_id);
      const oldMessage = await oldChannel?.messages?.fetch?.(existing.message_id);
      await oldMessage?.delete?.();
    } catch (error) {
      // The new message is posted either way. Unless the old one (10008) or its channel (10003) is gone, the
      // caller is told that a copy remains.
      if (error?.code !== 10003 && error?.code !== 10008) onStaleCopy(existing.channel_id);
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
