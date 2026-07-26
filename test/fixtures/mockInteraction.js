/**
 * Mock Discord Interaction
 *
 * Simulates a Discord interaction for testing command execution.
 */

export function createMockInteraction(options = {}) {
  const {
    command = 'core:about',
    roles = ['observer-role-id'],
    options: cmdOptions = {},
    includeWriteGroup = false,
    userId = 'test-user-123',
    username = 'TestUser',
    guildId = 'test-guild-456',
    // channelId/token/id: added 2026-07-26 alongside the real fix that
    // exposed their absence -- actorFromInteraction() (src/commands.js)
    // reads interaction.channelId, and createSteamLinkSession() reads
    // interaction.token/interaction.id. Without these, every test using
    // this mock silently exercised an actor/session shape that could
    // never occur with a real Discord interaction (undefined channelId,
    // undefined interactionToken) -- exactly the gap that let the real
    // "actor.username is required" production bug go undetected by tests.
    channelId = 'test-channel-789',
    token = 'test-interaction-token',
    id = 'test-interaction-id',
    // guildRoles: the full set of roles that EXIST in the mock guild
    // (name lookups, e.g. resolveRoleLabel(), need this) -- distinct from
    // `roles` above, which is only the subset the TEST USER currently
    // holds. Defaults to the same set as `roles` plus a couple of
    // additional named roles, so tests can exercise "role exists but
    // user doesn't have it" and "role ID doesn't exist at all" cases.
    guildRoles = roles.map((roleId) => ({ id: roleId, name: roleId }))
  } = options;

  const [group, subcommand] = command.split(':');

  const interaction = {
    isChatInputCommand: () => true,
    commandName: 'dune',
    user: {
      id: userId,
      username: username,
      displayName: username
    },
    guildId: guildId,
    channelId: channelId,
    token: token,
    id: id,
    guild: {
      id: guildId,
      roles: {
        cache: new Map(guildRoles.map((role) => [role.id, role]))
      }
    },
    member: {
      roles: {
        cache: new Map(roles.map(roleId => [roleId, { id: roleId, name: roleId }]))
      }
    },
    options: {
      getSubcommandGroup: () => group || null,
      getSubcommand: () => subcommand || null,
      getString: (name) => cmdOptions[name] || null,
      getInteger: (name) => cmdOptions[name] || null,
      getBoolean: (name) => cmdOptions[name] ?? null
    },
    deferReply: async () => {},
    reply: async (content) => {
      interaction._reply = content;
      return { ok: false, error: content.content || 'Unauthorized' };
    },
    editReply: async (content) => {
      interaction._editReply = content;
    },
    followUp: async (content) => {
      interaction._followUp = content;
    },
    _reply: null,
    _editReply: null,
    _followUp: null
  };

  return interaction;
}
