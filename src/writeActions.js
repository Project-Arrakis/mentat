// Single source of truth for mentat's real write commands -- both Discord
// command registration (commands.js) and dispatch (writeHandler.js) read
// from this table, so the two can never drift the way the old WRITE_COMMANDS
// array and its separate, hand-duplicated commands.js builder already have.
export const WRITE_ACTIONS = Object.freeze([
  // --- player (merged into the EXISTING "player" subcommand group --
  // verified no name collision with its read subcommands, see test above) ---
  { group: "player", name: "kick", action: "player.kick", tier: "admin", confirmPhrase: null,
    desc: "Kick a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID (Funcom-style, e.g. Server#4242)", required: true },
      { name: "reason", type: "string", desc: "Reason for the kick", required: false, maxLength: 200 }] },
  { group: "player", name: "ban", action: "player.ban", tier: "admin", confirmPhrase: "BAN PLAYER",
    desc: "Ban a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "reason", type: "string", desc: "Reason for the ban", required: false, maxLength: 200 }] },
  { group: "player", name: "unban", action: "player.unban", tier: "admin", confirmPhrase: null,
    desc: "Unban a player.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },
  { group: "player", name: "warn", action: "player.warn", tier: "moderator", confirmPhrase: null,
    desc: "Broadcast a warning message to everyone on a map (not a DM).", params: [
      { name: "message", type: "string", desc: "Message text", required: true, maxLength: 500 },
      { name: "mapName", type: "string", desc: "Map name", required: false },
      { name: "dimension", type: "integer", desc: "Dimension", required: false }] },
  { group: "player", name: "give-item", action: "player.give-item", tier: "owner", confirmPhrase: null,
    desc: "Give an item to a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "itemName", type: "string", desc: "Item name (catalog lookup)", required: true },
      { name: "quantity", type: "integer", desc: "Quantity", required: false, minValue: 1 }] },
  { group: "player", name: "clear-backpack", action: "player.clear-backpack", tier: "owner", confirmPhrase: "CLEAN INVENTORY",
    desc: "Clear a player's backpack.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },
  { group: "player", name: "fill-water", action: "player.fill-water", tier: "admin", confirmPhrase: null,
    desc: "Refill a player's water.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },

  // --- base (genuinely new group) ---
  { group: "base", name: "refill-generators", action: "base.refill-generators", tier: "admin", confirmPhrase: null,
    desc: "Refill a base's generators.", params: [{ name: "baseId", type: "integer", desc: "Base ID", required: true }] },
  { group: "base", name: "refill-water", action: "base.refill-water", tier: "admin", confirmPhrase: null,
    desc: "Refill a base's water.", params: [{ name: "baseId", type: "integer", desc: "Base ID", required: true }] },

  // --- server (merged into the EXISTING "server" subcommand group --
  // verified no name collision with its read subcommands, see test above) ---
  { group: "server", name: "restart", action: "server.restart", tier: "owner", confirmPhrase: null,
    desc: "Restart the game server.", params: [] },
  { group: "server", name: "stop", action: "server.stop", tier: "owner", confirmPhrase: null, requiresDualConfirmation: true,
    desc: "Stop the game server. Requires a second, different owner-tier admin to confirm.", params: [] },
  { group: "server", name: "start", action: "server.start", tier: "admin", confirmPhrase: null,
    desc: "Start the game server.", params: [] },
  { group: "server", name: "restart-service", action: "server.restart-service", tier: "admin", confirmPhrase: null,
    desc: "Restart a specific game service.", params: [
      { name: "service", type: "string", desc: "Service name (gateway/survival-1/overmap)", required: true }] },

  // --- map (genuinely new group) ---
  { group: "map", name: "spawn", action: "map.spawn", tier: "admin", confirmPhrase: "SPAWN MAP",
    desc: "Spawn a map.", params: [
      { name: "mapName", type: "string", desc: "Map name", required: true },
      { name: "preset", type: "string", desc: "Preset name", required: false }] },
  { group: "map", name: "despawn", action: "map.despawn", tier: "admin", confirmPhrase: "DESPAWN MAP",
    desc: "Despawn a map.", params: [{ name: "mapName", type: "string", desc: "Map name", required: true }] },
  { group: "map", name: "respawn", action: "map.respawn", tier: "admin", confirmPhrase: "RESTART MAP",
    desc: "Respawn (restart) a map.", params: [{ name: "mapName", type: "string", desc: "Map name", required: true }] },
  { group: "map", name: "teleport", action: "map.teleport", tier: "admin", confirmPhrase: null,
    desc: "Teleport a player.", params: [
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "x", type: "number", desc: "X coordinate", required: true },
      { name: "y", type: "number", desc: "Y coordinate", required: true },
      { name: "z", type: "number", desc: "Z coordinate", required: false },
      { name: "yaw", type: "number", desc: "Yaw", required: false }] },

  // --- carepackage (genuinely new group) ---
  { group: "carepackage", name: "grant", action: "carepackage.grant", tier: "admin", confirmPhrase: "GRANT CARE PACKAGE",
    desc: "Grant a care package to a player.", params: [{ name: "playerId", type: "string", desc: "Player ID", required: true }] },
  { group: "carepackage", name: "grant-all", action: "carepackage.grant-all", tier: "owner", confirmPhrase: "GRANT CARE PACKAGE TO ELIGIBLE PLAYERS",
    desc: "Grant care packages to every eligible player.", params: [] },
  { group: "carepackage", name: "enable", action: "carepackage.enable", tier: "admin", confirmPhrase: "ENABLE CARE PACKAGE",
    desc: "Enable the care package system.", params: [] },
  { group: "carepackage", name: "disable", action: "carepackage.disable", tier: "admin", confirmPhrase: "DISABLE CARE PACKAGE",
    desc: "Disable the care package system.", params: [] },
  { group: "carepackage", name: "scan", action: "carepackage.scan", tier: "admin", confirmPhrase: "RUN CARE PACKAGE SCAN",
    desc: "Run a care package eligibility scan.", params: [] },
  { group: "carepackage", name: "history-clear", action: "carepackage.history-clear", tier: "owner", confirmPhrase: "CLEAR GRANT HISTORY",
    desc: "Clear care package grant history.", params: [] },

  // --- guild (genuinely new group) ---
  { group: "guild", name: "add", action: "guild.add", tier: "admin", confirmPhrase: null,
    desc: "Add a player to a guild.", params: [
      { name: "guildId", type: "string", desc: "Guild ID", required: true },
      { name: "playerId", type: "string", desc: "Player ID", required: true },
      { name: "roleId", type: "string", desc: "Guild role ID", required: false }] },
  { group: "guild", name: "remove", action: "guild.remove", tier: "admin", confirmPhrase: null,
    desc: "Remove a player from a guild.", params: [
      { name: "guildId", type: "string", desc: "Guild ID", required: true },
      { name: "playerId", type: "string", desc: "Player ID", required: true }] },

  // --- operations (genuinely new group, backed by Task 1's new Core actions) ---
  { group: "operations", name: "create-backup", action: "backup.create", tier: "owner", confirmPhrase: null,
    desc: "Create a database backup.", params: [] },
  { group: "operations", name: "trigger-update", action: null, tier: "owner", confirmPhrase: null,
    desc: "Trigger a game or SteamCMD update.", params: [
      { name: "type", type: "string", desc: "Update type: game or steamcmd", required: true, choices: ["game", "steamcmd"] }],
    resolveAction: (params) => (params.type === "steamcmd" ? "updates.fix-steamcmd" : "updates.apply-game") },

  // --- bot (genuinely new group; self-update never calls Core -- see writeSelfUpdate.js) ---
  { group: "bot", name: "self-update", action: "bot.self-update", tier: "host-operator", confirmPhrase: null,
    desc: "Restart the bot on the latest deployed code (replays the deploy pipeline's test-gated safety checks). Restricted to the configured bot host operator.", params: [] }
]);

export function findWriteAction(group, name) {
  return WRITE_ACTIONS.find((e) => e.group === group && e.name === name) || null;
}
