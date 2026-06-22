import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aboutPayload,
  actorFromInteraction,
  buildDuneCommand,
  executeDuneCommand,
  extractRoleIds,
  isCommandAllowed,
  requiredRoleIdsForCommand
} from "../src/commands.js";

test("buildDuneCommand exposes read-only subcommands only", () => {
  const command = buildDuneCommand().toJSON();
  const subcommands = command.options.map((option) => option.name).sort();
  assert.deepEqual(subcommands, ["about", "health", "readiness", "services", "status"]);
});

test("extractRoleIds supports discord.js role cache shape", () => {
  const interaction = {
    member: {
      roles: {
        cache: new Map([["role-a", {}], ["role-b", {}]])
      }
    }
  };

  assert.deepEqual(extractRoleIds(interaction), ["role-a", "role-b"]);
});

test("isCommandAllowed permits all users only in explicit open mode", () => {
  const rbac = {
    mode: "open",
    commandRoleIds: {
      status: []
    }
  };

  assert.equal(isCommandAllowed({}, "status", rbac), true);
  assert.equal(isCommandAllowed({}, "restart", rbac), false);
});

test("isCommandAllowed enforces command-specific role IDs", () => {
  const interaction = { member: { roles: ["role-a"] } };
  const rbac = {
    mode: "restricted",
    allowedUserIds: [],
    commandRoleIds: {
      status: ["role-a"],
      services: ["role-b"]
    }
  };

  assert.equal(isCommandAllowed(interaction, "status", rbac), true);
  assert.equal(isCommandAllowed(interaction, "services", rbac), false);
});

test("isCommandAllowed supports explicit user allow-list", () => {
  const interaction = { user: { id: "user-a" }, member: { roles: [] } };
  const rbac = {
    mode: "restricted",
    allowedUserIds: ["user-a"],
    commandRoleIds: {
      status: ["role-a"]
    }
  };

  assert.equal(isCommandAllowed(interaction, "status", rbac), true);
});

test("requiredRoleIdsForCommand returns an empty list for unsupported commands", () => {
  const rbac = {
    commandRoleIds: {
      status: ["role-a"]
    }
  };

  assert.deepEqual(requiredRoleIdsForCommand("status", rbac), ["role-a"]);
  assert.deepEqual(requiredRoleIdsForCommand("restart", rbac), []);
});

test("actorFromInteraction emits minimal Discord context", () => {
  const actor = actorFromInteraction({
    user: { id: "user-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    member: { roles: ["role-1"] }
  });

  assert.deepEqual(actor, {
    userId: "user-1",
    guildId: "guild-1",
    channelId: "channel-1",
    roleIds: ["role-1"]
  });
});

test("aboutPayload exposes safe metadata without secrets", () => {
  const payload = aboutPayload({
    adapter: {
      baseUrl: "https://user:pass@example.com:8443/console",
      timeoutMs: 5000
    },
    discord: {
      defaultEphemeral: true,
      rbac: { mode: "restricted" }
    }
  });

  assert.equal(payload.bot.version, "0.1.0");
  assert.equal(payload.bot.readOnly, true);
  assert.equal(payload.bot.writesEnabled, false);
  assert.equal(payload.adapter.origin, "https://example.com:8443");
  assert.equal(payload.discord.rbacMode, "restricted");
  assert.equal(payload.boundary.dockerSocket, false);
  assert.deepEqual(JSON.stringify(payload).match(/pass|token|secret|authorization/i), null);
});

test("executeDuneCommand handles about without calling the adapter", async () => {
  let deferred = null;
  let edited = "";
  const interaction = {
    isChatInputCommand: () => true,
    commandName: "dune",
    options: { getSubcommand: () => "about" },
    user: { id: "user-1" },
    member: { roles: ["role-a"] },
    deferReply: async (options) => {
      deferred = options;
    },
    editReply: async (content) => {
      edited = content;
    }
  };
  const adapterClient = {
    about: () => {
      throw new Error("about must not call the adapter");
    }
  };

  const handled = await executeDuneCommand(interaction, adapterClient, {
    adapter: {
      baseUrl: "http://console-api:3000",
      timeoutMs: 8000
    },
    discord: {
      defaultEphemeral: true,
      rbac: {
        mode: "restricted",
        allowedUserIds: [],
        commandRoleIds: {
          about: ["role-a"]
        }
      }
    }
  });

  assert.equal(handled, true);
  assert.deepEqual(deferred, { ephemeral: true });
  assert.match(edited, /Dune about/);
  assert.doesNotMatch(edited, /adapter-token|discord-token|secret/i);
});
