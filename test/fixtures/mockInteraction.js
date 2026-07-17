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
    guildId = 'test-guild-456'
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
