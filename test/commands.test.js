import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  aboutPayload,
  actorFromInteraction,
  buildDuneCommand,
  executeDuneCommand,
  extractRoleIds,
  isCommandAllowed,
  pingPayload,
  requiredRoleIdsForCommand,
  statusSummaryPayload
} from "../src/commands.js";

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

function mockOptions(group, subcommand, overrides = {}) {
  return {
    getSubcommandGroup: () => group || "",
    getSubcommand: () => subcommand,
    getBoolean: () => false,
    getString: () => "",
    ...overrides
  };
}

function mockInteraction(group, subcommand, opts = {}) {
  return {
    isChatInputCommand: () => true,
    commandName: "dune",
    options: mockOptions(group, subcommand),
    user: opts.user || { id: "user-1" },
    member: opts.member || { roles: opts.roles || ["role-a"] },
    guildId: opts.guildId || "guild-1",
    channelId: opts.channelId || "channel-1",
    deferReply: async (o) => { },
    editReply: async (r) => { }
  };
}

test("buildDuneCommand uses subcommand groups", () => {
  const cmd = buildDuneCommand().toJSON();
  const groups = cmd.options.filter(o => o.type === 2); // SUB_COMMAND_GROUP = 2
  assert.ok(groups.length >= 6, `expected 6+ groups, got ${groups.length}`);
  const names = groups.map(g => g.name).sort();
  assert.deepEqual(names, ["admin", "core", "data", "infra", "logs", "ops", "server"]);
});

test("buildDuneCommand includes write group only when enabled", () => {
  const disabled = buildDuneCommand({ includeWriteGroup: false }).toJSON();
  const disabledNames = disabled.options.filter(o => o.type === 2).map(g => g.name);
  assert.equal(disabledNames.includes("write"), false, "write group must not be registered when disabled");

  const enabled = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  const enabledNames = enabled.options.filter(o => o.type === 2).map(g => g.name);
  assert.equal(enabledNames.includes("write"), true, "write group must be registered when enabled");
  assert.ok(enabledNames.length >= 7, `expected 7+ groups, got ${enabledNames.length}`);
});

test("extractRoleIds supports discord.js role cache shape", () => {
  const roles = extractRoleIds({ member: { roles: { cache: new Map([["role-a", {}], ["role-b", {}]]) } } });
  assert.deepEqual(roles, ["role-a", "role-b"]);
});

test("isCommandAllowed allows group:subcommand format", () => {
  const config = { multiTenant: false, discord: { rbac: { mode: "restricted", commandRoleIds: { "core:about": ["role-a"] } } } };
  assert.equal(isCommandAllowed({ member: { roles: ["role-a"] } }, "core:about", config), true);
  assert.equal(isCommandAllowed({ member: { roles: ["role-b"] } }, "core:about", config), false);
});

test("isCommandAllowed falls back to observer/admin for unknown commands", () => {
  const config = { multiTenant: false, discord: { rbac: { mode: "restricted", observerRoleIds: ["role-a"], adminRoleIds: ["role-b"] } } };
  assert.equal(isCommandAllowed({ member: { roles: ["role-a"] } }, "ops:dashboard", config), true);
  assert.equal(isCommandAllowed({ member: { roles: [] } }, "ops:dashboard", config), false);
});

test("isCommandAllowed permits all in open mode", () => {
  const config = { multiTenant: false, discord: { rbac: { mode: "open" } } };
  assert.equal(isCommandAllowed({}, "core:about", config), true);
  assert.equal(isCommandAllowed({}, "unknown:cmd", config), true);
});

test("executeDuneCommand handles core:about without calling the adapter", async () => {
  let edited = null;
  const interaction = mockInteraction("core", "about", { user: { id: "u1" }, roles: ["role-a"] });
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };

  const handled = await executeDuneCommand(interaction, {}, {
    adapter: { baseUrl: "http://console-api:3000", timeoutMs: 8000 },
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "core:about": ["role-a"] } } }
  });
  assert.equal(handled, true);
  assert.ok(edited?.embeds?.[0]?.data?.title, "about embed has title");
});

test("executeDuneCommand handles core:ping through the health route", async () => {
  let seenActor, edited;
  const interaction = mockInteraction("core", "ping", { user: { id: "u1" }, roles: ["role-a"] });
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };
  const client = { health: async (actor) => { seenActor = actor; return { ok: true, enabled: true, readOnly: true, writesEnabled: false }; } };

  await executeDuneCommand(interaction, client, {
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "core:ping": ["role-a"] } } }
  });
  assert.equal(seenActor.userId, "u1");
  assert.equal(seenActor.username, "unknown");
  assert.ok(edited?.embeds?.[0]?.data?.title, "ping embed has title");
});

test("executeDuneCommand handles server:summary through the status route", async () => {
  let seenActor, edited;
  const interaction = mockInteraction("server", "summary", { user: { id: "u1" }, roles: ["role-a"] });
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };
  const client = { status: async (actor) => { seenActor = actor; return { ok: true, result: { summary: { overall: "READY", region: "NA", mode: "public", population: "2/60" } } }; } };

  await executeDuneCommand(interaction, client, {
    discord: { defaultEphemeral: false, rbac: { mode: "restricted", commandRoleIds: { "server:summary": ["role-a"] } } }
  });
  assert.deepEqual(seenActor, { userId: "u1", username: "unknown", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-a"] });
  assert.ok(edited?.embeds?.[0]?.data?.title, "summary embed has title");
});

test("actorFromInteraction emits minimal Discord context", () => {
  const actor = actorFromInteraction({
    user: { id: "user-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    member: { roles: ["role-1"] }
  });
  assert.deepEqual(actor, { userId: "user-1", username: "unknown", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-1"] });
});

test("aboutPayload exposes safe metadata without secrets", () => {
  const payload = aboutPayload({ adapter: { baseUrl: "https://user:pass@example.com:8443/console", timeoutMs: 5000 }, discord: { defaultEphemeral: true, rbac: { mode: "restricted" } } });
  assert.equal(payload.bot.version, packageVersion);
  assert.equal(payload.bot.readOnly, false);
  assert.equal(payload.bot.writesEnabled, false);
  assert.equal(payload.adapter.origin, "https://example.com:8443");
  assert.ok(payload.adapter.timeoutMs > 0);
  assert.equal(payload.boundary.dockerSocket, false);
  assert.deepEqual(JSON.stringify(payload).match(/pass|token|secret|authorization/i), null);
});

test("pingPayload summarizes adapter health and latency", async () => {
  let seenActor;
  const payload = await pingPayload({
    health: async (actor) => { seenActor = actor; return { ok: true, enabled: true, readOnly: true, writesEnabled: false, token: "must-not-be-forwarded" }; }
  }, { userId: "user-1" }, 7);
  assert.deepEqual(seenActor, { userId: "user-1" });
  assert.equal(payload.ok, true);
  assert.equal(payload.adapter.route, "health");
  assert.equal(payload.adapter.ok, true);
  assert.deepEqual(JSON.stringify(payload).match(/must-not-be-forwarded|token/i), null);
});

test("statusSummaryPayload returns compact aggregate status", () => {
  const payload = statusSummaryPayload({
    ok: true,
    result: {
      summary: {
        overall: "READY",
        title: "Private Jane Server",
        region: "NA",
        mode: "public",
        population: "2/60",
        battlegroup: "private-battlegroup",
        automation: { autoscaler: "RUNNING", autoUpdates: "DISABLED" }
      }
    }
  });
  assert.deepEqual(JSON.stringify(payload).match(/Jane|battlegroup|Private/i), null);
});

test("requiredRoleIdsForCommand looks up configured roles", () => {
  const rbac = { commandRoleIds: { "server:status": ["role-a", "role-b"] } };
  assert.deepEqual(requiredRoleIdsForCommand("server:status", rbac), ["role-a", "role-b"]);
  assert.deepEqual(requiredRoleIdsForCommand("unknown", rbac), []);
});

test("admin:broadcast returns disabled when writes are off", async () => {
  let edited;
  const interaction = mockInteraction("admin", "broadcast", {
    user: { id: "u1" },
    roles: ["role-a"]
  });
  interaction.options.getString = () => "Server restart in 5m";
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };

  const handled = await executeDuneCommand(interaction, {}, {
    adapter: { baseUrl: "http://console-api:3000", timeoutMs: 8000 },
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "admin:broadcast": ["role-a"] } } }
  });
  assert.equal(handled, true);
  assert.ok(edited?.embeds?.[0]?.data?.title, "broadcast embed has title");
});

test("admin:broadcast is blocked by RBAC when user has no role", async () => {
  const interaction = mockInteraction("admin", "broadcast", {
    user: { id: "not-allowed" },
    roles: []
  });
  interaction.options.getString = () => "msg";
  let immediateReply;
  interaction.reply = async (r) => { immediateReply = r; };
  interaction.deferReply = async () => { throw new Error("should not defer"); };
  interaction.editReply = async () => { throw new Error("should not edit"); };

  const handled = await executeDuneCommand(interaction, {}, {
    adapter: { baseUrl: "http://console-api:3000", timeoutMs: 8000 },
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "admin:broadcast": ["role-a"] } } }
  });
  assert.equal(handled, true);
  assert.equal(immediateReply?.content?.includes("not authorized"), true, "RBAC blocks unauthorized broadcast");
});

test("infra commands are RBAC-gated through fallback observer/admin", async () => {
  let edited;
  const interaction = mockInteraction("infra", "version", {
    user: { id: "u1" },
    roles: ["observer-role"]
  });
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };

  let seenActor;
  const client = { version: async (actor) => { seenActor = actor; return { ok: true, version: "1.3.41" }; } };

  await executeDuneCommand(interaction, client, {
    adapter: { baseUrl: "http://console-api:3000", timeoutMs: 8000 },
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", observerRoleIds: ["observer-role"], adminRoleIds: ["admin-role"] } }
  });
  assert.ok(edited?.embeds?.[0]?.data?.title, "infra:version embed has title");
  assert.equal(seenActor.userId, "u1", "actor context sent to adapter");
});
