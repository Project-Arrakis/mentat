import { getGuild, upsertGuild } from "./database.js";

const SETUP_URL = process.env.ACP_SETUP_URL || "https://acp.example.com/setup";

export async function handleGuildCreate(bot, guild, db) {
  const existing = getGuild(db, guild.id);
  if (existing && existing.status === "active") return;

  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) return;

  try {
    const dm = await owner.createDM();
    const setupLink = `${SETUP_URL}?guildId=${guild.id}`;

    await dm.send({
      content: [
        `🐛 **Welcome to ACP!**`,
        ``,
        `I've been added to **${guild.name}**. To get started, you need to connect this server to your Dune Awakening console.`,
        ``,
        `**Setup takes 2 minutes:**`,
        `1. Click the setup link below`,
        `2. Sign in with Discord`,
        `3. Enter your console URL and adapter token`,
        `4. Configure your roles`,
        ``,
        `🔗 **Setup Link:** ${setupLink}`,
        ``,
        `Once configured, commands like \`/dune server status\` and \`/dune player inventory\` will work immediately.`
      ].join("\n")
    });
  } catch {
    console.warn(`Could not send setup DM to owner of ${guild.name} (${guild.id})`);
  }
}

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
