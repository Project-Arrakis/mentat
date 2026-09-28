import { duneEmbed } from "./embedFormat.js";

// arrivalGreeting.js: a real, live discoverability gap found 2026-09-27 --
// YAGPDB's human-verification gate (the role a new member needs to unlock
// the rest of the server) runs entirely over DM, with no in-server
// fallback. A member whose DMs are closed to server members (a common
// default), or who reasonably distrusts an unsolicited DM with an external
// link, gets zero visible signal that anything else is required -- they
// finish Discord's own onboarding, believe they're done, and are silently
// kicked hours later for never completing a step they never saw.
//
// This posts a short, immediate, in-server nudge on every real join,
// complementing (not replacing) the pinned static explanation in the same
// channel -- a per-join ping is what actually reaches someone who wouldn't
// have gone looking for a pinned message on their own.
export function postArrivalGreeting({ member, channelFetcher }) {
  return channelFetcher().then(async (channel) => {
    if (!channel?.isTextBased?.()) return;
    const embed = duneEmbed({
      title: "🏜️ Check Your DMs",
      color: "warning",
      description: "YAGPDB just sent you a private message with a verification link -- complete it to receive 🔪 Crysknife-Bearer and unlock the rest of Chronicles of Kanly.\n\nDon't see it? See the pinned message above for how to fix your DM settings."
    });
    await channel.send({ content: `<@${member.id}>`, embeds: [embed] });
  });
}

export function startArrivalGreeter({ client, channelId, onError = () => {} }) {
  if (!channelId) return { active: false, reason: "no channel configured" };

  const handler = async (member) => {
    try {
      await postArrivalGreeting({
        member,
        channelFetcher: () => client.channels.fetch(channelId)
      });
    } catch (error) {
      onError(error);
    }
  };

  client.on("guildMemberAdd", handler);

  return {
    active: true,
    stop() { client.off("guildMemberAdd", handler); }
  };
}
