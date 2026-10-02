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
// /code-review high finding, mentat#372 (this function's first real,
// non-test caller): if a `live_messages` row exists but its stored
// channel_id differs from the caller's channelId argument -- e.g. an
// operator relocated a service channel via a second /dune admin
// service-setup call with a different `channel` -- this used to
// unconditionally edit the OLD channel's message and return its
// channelId, silently ignoring the caller's request to move it. The
// DB registry (service_channels.channel_id) would then say the new
// channel while the real pinned message stayed in the old one forever.
// A channelId mismatch is now treated the same as a stale/deleted
// pointer: fall through and post fresh in the requested channel.
export async function postOrEditLiveMessage({ client, db, guildId, channelId, messageKey, content }) {
  const existing = getLiveMessage(db, guildId, messageKey);
  if (existing && existing.channel_id === channelId) {
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
