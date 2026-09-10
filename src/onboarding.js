import { getGuild, upsertGuild } from "./database.js";

export async function handleGuildDelete(bot, guild, db) {
  const existing = getGuild(db, guild.id);
  if (!existing) return;

  upsertGuild(db, {
    guildId: guild.id,
    guildName: guild.name,
    consoleUrl: existing.console_url,
    adapterToken: existing.adapter_token,
    status: "suspended"
  });
}
