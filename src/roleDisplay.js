// roleDisplay.js — resolves a raw Discord role ID into a human-readable
// "RoleName (RoleID)" label, for admin-facing displays (the /dune admin
// roles command, and the setup wizard's role-configuration step).
//
// Added 2026-07-26 after a real, live incident: this bot's guild_roles
// table held two role IDs (observer/admin) that no longer matched the
// actual roles in the target Discord server -- because every existing
// display/config surface only ever showed the raw numeric ID, an operator
// had no way to notice the mismatch until a real command was rejected
// with "You are not authorized." Showing the role's live name alongside
// its ID is a cheap, direct mitigation for exactly this class of drift.
//
// Deliberately does NOT cache resolved names across calls -- role names
// can change at any time in Discord, and this is only ever called for a
// handful of roles in low-frequency admin commands/setup flows, so a
// fresh lookup every time is simpler and correct rather than risking a
// stale cached name in an admin-facing display whose whole point is
// catching drift.

// resolveRoleLabel: given a Discord guild object (interaction.guild, or
// client.guilds.cache.get(guildId)) and a raw role ID, returns
// "RoleName (RoleID)" if the role currently exists in that guild, or
// "Unknown Role (RoleID)" if it doesn't (the exact signal an operator
// needs to notice a stale/wrong ID, per the incident this module exists
// to prevent recurring).
export function resolveRoleLabel(guild, roleId) {
  const id = String(roleId || "").trim();
  if (!id) return "(none)";
  const role = guild?.roles?.cache?.get(id);
  if (!role) return `Unknown Role (${id})`;
  return `${role.name} (${id})`;
}

// resolveRoleLabels: batch form of resolveRoleLabel for a list of
// { role_type, role_id } rows (the shape database.js's getGuildRoles()
// returns), preserving role_type as a label prefix.
export function resolveRoleLabels(guild, roles) {
  return (Array.isArray(roles) ? roles : []).map((row) => ({
    roleType: row.role_type,
    roleId: row.role_id,
    label: resolveRoleLabel(guild, row.role_id)
  }));
}
