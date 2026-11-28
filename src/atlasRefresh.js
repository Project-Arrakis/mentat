import { formatAtlasEmbed, formatAtlasWithdrawnEmbed } from "./embedFormat.js";
import { postOrEditLiveMessage } from "./liveMessage.js";
import { getLiveMessage } from "./database.js";
import {
  countUnmatchedPasswords,
  hasAtlasPasswords,
  isHiddenFromEveryone,
  readAtlasPasswords,
  withAtlasPasswords,
  withoutAtlasPasswords
} from "./atlasPasswords.js";
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

export function atlasRefresher({ adapterClient, client, db, channelId, messageKey = "atlas", passwordsFile = null, onError = () => {} }) {
  // The file is read on every refresh, so a changed password needs no restart.
  // A problem is reported and the message still updates, without the file's
  // passwords.
  async function addPasswords(channel, payload) {
    // No password, from the file or from the source, goes into a channel that
    // @everyone can see.
    if (!isHiddenFromEveryone(channel)) {
      if (passwordsFile || hasAtlasPasswords(payload)) {
        onError(new Error("Sietch passwords left out: @everyone can see the atlas channel, or that could not be checked."));
      }
      return withoutAtlasPasswords(payload);
    }
    if (!passwordsFile) return payload;
    try {
      const passwords = await readAtlasPasswords(passwordsFile);
      // Only the number is reported: a mistyped name could be a password.
      const unmatched = countUnmatchedPasswords(payload, passwords);
      if (unmatched) onError(new Error(`DUNE_ATLAS_PASSWORDS_FILE: entries matching no sietch: ${unmatched}.`));
      return withAtlasPasswords(payload, passwords);
    } catch (error) {
      onError(error);
      return payload;
    }
  }

  function publish(guildId, embed) {
    return postOrEditLiveMessage({
      client,
      db,
      guildId,
      channelId,
      messageKey,
      content: { embeds: [embed] },
      // The message can hold passwords: it must follow the configured channel
      // (not stay in an earlier one), a passing Discord error must not leave a
      // second copy behind, and a copy that cannot be removed must be known.
      strictChannel: true,
      rethrowTransient: true,
      onStaleCopy: (oldChannelId) => onError(new Error(`The earlier atlas message in channel ${oldChannelId} could not be removed; delete it by hand.`))
    });
  }

  // The source failed. A message posted while the channel was restricted may
  // hold passwords, so if the channel is no longer restricted it is replaced
  // rather than left standing until the source answers again.
  async function fetchAtlas(channel) {
    const actor = schedulerActor(channel.guildId);
    try {
      return await adapterClient.atlas(actor, channel.guildId);
    } catch (error) {
      // Passwords come from the file, or from a source asked for them by role.
      const mayHoldPasswords = Boolean(passwordsFile) || actor.roleIds.length > 0;
      if (mayHoldPasswords && !isHiddenFromEveryone(channel) && getLiveMessage(db, channel.guildId, messageKey)) {
        await publish(channel.guildId, formatAtlasWithdrawnEmbed()).catch(onError);
      }
      throw error;
    }
  }

  async function refresh() {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased?.() || !channel.guildId) {
        throw new Error(`Channel ${channelId} is not a guild text channel.`);
      }
      const payload = await fetchAtlas(channel);
      await publish(channel.guildId, formatAtlasEmbed(await addPasswords(channel, payload)));
    } catch (error) {
      onError(error);
    }
  }

  return { refresh };
}
