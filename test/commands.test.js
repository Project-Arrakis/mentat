import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  aboutPayload,
  actorFromInteraction,
  buildDuneCommand,
  executeDuneCommand,
  extractRoleIds,
  helpPayload,
  isAdminActor,
  isCommandAllowed,
  pingPayload,
  requiredRoleIdsForCommand,
  statusSummaryPayload
} from "../src/commands.js";
import { createDatabase, upsertGuild, addGuildRole, updateGuildSettings } from "../src/database.js";

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
    options: opts.options || mockOptions(group, subcommand),
    user: opts.user || { id: "user-1" },
    member: opts.member || { roles: opts.roles || ["role-a"] },
    guildId: opts.guildId || "guild-1",
    channelId: opts.channelId || "channel-1",
    deferReply: async (o) => { },
    editReply: async (r) => { },
    reply: async (r) => { }
  };
}

test("buildDuneCommand uses subcommand groups", () => {
  const cmd = buildDuneCommand().toJSON();
  const groups = cmd.options.filter(o => o.type === 2); // SUB_COMMAND_GROUP = 2
  assert.ok(groups.length >= 7, `expected 7+ groups, got ${groups.length}`);
  const names = groups.map(g => g.name).sort();
  assert.deepEqual(names, ["admin", "core", "data", "infra", "logs", "ops", "player", "server"]);
});

test("buildDuneCommand includes write group only when enabled", () => {
  const disabled = buildDuneCommand({ includeWriteGroup: false }).toJSON();
  const disabledNames = disabled.options.filter(o => o.type === 2).map(g => g.name);
  assert.equal(disabledNames.includes("write"), false, "write group must not be registered when disabled");

  const enabled = buildDuneCommand({ includeWriteGroup: true }).toJSON();
  const enabledNames = enabled.options.filter(o => o.type === 2).map(g => g.name);
  assert.equal(enabledNames.includes("write"), true, "write group must be registered when enabled");
});

// helpPayload regression guard (added 2026-08-06, RO roadmap audit): the
// function previously listed only 32 commands and silently omitted the
// ENTIRE player group (12), the ENTIRE logs group (7), and 3 server
// subcommands (readiness-detail, services-detail, maintenance) -- all
// registered and dispatchable, so `/dune help` was hiding commands from
// users. It must now mirror buildDuneCommand()'s full non-write surface.
test("helpPayload mirrors the full registered command surface (55 non-write commands)", () => {
  const registered = new Set();
  for (const group of buildDuneCommand({ includeWriteGroup: false }).toJSON().options) {
    for (const sub of group.options || []) {
      registered.add(`${group.name}:${sub.name}`);
    }
  }

  const config = {
    multiTenant: false,
    discord: { rbac: { mode: "open" }, defaultEphemeral: false }
  };
  const interaction = mockInteraction("core", "help");
  const payload = helpPayload(config, interaction);

  assert.equal(payload.total, registered.size,
    `help must list every registered non-write command (expected ${registered.size}, got ${payload.total})`);
  const helped = new Set(payload.available.concat(payload.locked));
  assert.ok(helped.has("player:inventory"), "player group must appear in help (was silently omitted)");
  assert.ok(helped.has("player:find"), "player:find must appear in help");
  assert.ok(helped.has("logs:dune-server"), "logs group must appear in help (was silently omitted)");
  assert.ok(helped.has("server:maintenance"), "server:maintenance must appear in help (was silently omitted)");
  assert.ok(helped.has("server:readiness-detail"), "server:readiness-detail must appear in help");
  assert.ok(helped.has("server:services-detail"), "server:services-detail must appear in help");
  assert.deepEqual(
    [...helped].sort(),
    [...registered].sort(),
    "help surface must be exactly the registered non-write surface - not a strict subset"
  );
});

// helpPayload must include the write group only when writes are enabled
// (matching buildDuneCommand's conditional registration) and classify
// write commands with canWrite() (write-admin/write-owner roles), not the
// normal observer/admin RBAC.
test("helpPayload lists the write group only when writes are enabled, gated by write roles", async () => {
  const originalAdminRoles = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  const originalEnabled = process.env.DUNE_DISCORD_WRITES_ENABLED;
  try {
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "write-admin-role";
    const config = () => ({
      multiTenant: false,
      discord: { rbac: { mode: "open" }, writes: { enabled: true }, defaultEphemeral: false }
    });

    const disabledWrite = buildDuneCommand({ includeWriteGroup: true }).toJSON();
    const writeGroups = disabledWrite.options.filter(o => o.type === 2).map(g => g.name);
    assert.ok(writeGroups.includes("write"), "write group is registered when enabled");

    const adminHelp = helpPayload(config(), mockInteraction("core", "help", { roles: ["write-admin-role"] }));
    assert.ok(adminHelp.total > 54, "write group adds commands to help when writes enabled");
    assert.ok(adminHelp.available.includes("write:backup"), "write-admin role can see write commands as available");
  } finally {
    if (originalAdminRoles === undefined) delete process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
    else process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = originalAdminRoles;
    if (originalEnabled === undefined) delete process.env.DUNE_DISCORD_WRITES_ENABLED;
    else process.env.DUNE_DISCORD_WRITES_ENABLED = originalEnabled;
  }
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

// ── Multi-tenant tier wiring (unified-RBAC Phase 1) ───────────────────────
// The guild_roles schema always allowed owner/moderator role_type rows,
// but isCommandAllowed()/isAdminActor() only ever checked observer/admin,
// so a guild that configured owner or moderator got constant
// "not authorized" denials. These tests pin the fixed behavior.

function multiTenantDb({ owner = [], admin = [], moderator = [], observer = [], rbacMode = null } = {}) {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "guild-1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "t", status: "active" });
  for (const id of owner) addGuildRole(db, "guild-1", "owner", id);
  for (const id of admin) addGuildRole(db, "guild-1", "admin", id);
  for (const id of moderator) addGuildRole(db, "guild-1", "moderator", id);
  for (const id of observer) addGuildRole(db, "guild-1", "observer", id);
  if (rbacMode) updateGuildSettings(db, "guild-1", { rbac_mode: rbacMode });
  return db;
}

const MT_CONFIG = { multiTenant: true, discord: { rbac: {} } };

test("isCommandAllowed (multi-tenant) allows moderator role in restricted mode", () => {
  const db = multiTenantDb({ moderator: ["mod-role"] });
  assert.equal(isCommandAllowed({ member: { roles: ["mod-role"] } }, "core:about", MT_CONFIG, db, "guild-1"), true);
});

// Issue #238: owner has no role concept any more -- a legacy guild_roles
// "owner" row (from before the unification) is inert for authorization.
// Only real Discord guild ownership grants the owner tier, matching Core's
// tier1-upstream design.
test("isCommandAllowed (multi-tenant) ignores a legacy owner-role row; real guild ownership always passes instead", () => {
  const db = multiTenantDb({ owner: ["owner-role"] });
  assert.equal(
    isCommandAllowed({ member: { roles: ["owner-role"] } }, "core:about", MT_CONFIG, db, "guild-1"),
    false,
    "a role mapped to the legacy owner tier must no longer authorize anything by itself"
  );
  assert.equal(
    isCommandAllowed(
      { user: { id: "real-owner" }, guild: { ownerId: "real-owner" }, member: { roles: [] } },
      "core:about", MT_CONFIG, db, "guild-1"
    ),
    true,
    "the real Discord guild owner passes even with zero configured roles"
  );
});

test("isCommandAllowed (multi-tenant) rejects users with no configured role", () => {
  const db = multiTenantDb({ admin: ["admin-role"] });
  assert.equal(isCommandAllowed({ member: { roles: ["some-other-role"] } }, "core:about", MT_CONFIG, db, "guild-1"), false);
  assert.equal(isCommandAllowed({ member: { roles: [] } }, "core:about", MT_CONFIG, db, "guild-1"), false);
});

test("isCommandAllowed (multi-tenant) respects open mode", () => {
  const db = multiTenantDb({ rbacMode: "open" });
  assert.equal(isCommandAllowed({ member: { roles: [] } }, "core:about", MT_CONFIG, db, "guild-1"), true);
});

test("isAdminActor (multi-tenant) requires admin tier or above -- real guild owner passes, a legacy owner-role row and moderator do not", () => {
  const db = multiTenantDb({
    owner: ["owner-role"],
    admin: ["admin-role"],
    moderator: ["mod-role"],
    observer: ["player-role"]
  });
  assert.equal(isAdminActor({ member: { roles: ["admin-role"] } }, MT_CONFIG, db, "guild-1"), true);
  assert.equal(
    isAdminActor({ member: { roles: ["owner-role"] } }, MT_CONFIG, db, "guild-1"),
    false,
    "issue #238: a legacy owner-role mapping no longer grants any tier, including admin"
  );
  assert.equal(
    isAdminActor({ user: { id: "real-owner" }, guild: { ownerId: "real-owner" }, member: { roles: [] } }, MT_CONFIG, db, "guild-1"),
    true,
    "the real Discord guild owner always passes the admin gate, with zero roles configured"
  );
  assert.equal(isAdminActor({ member: { roles: ["mod-role"] } }, MT_CONFIG, db, "guild-1"), false, "moderator is below admin and must not pass admin gates");
  assert.equal(isAdminActor({ member: { roles: ["player-role"] } }, MT_CONFIG, db, "guild-1"), false, "player must not pass admin gates");
  assert.equal(isAdminActor({ member: { roles: ["unconfigured"] } }, MT_CONFIG, db, "guild-1"), false);
});

// ── Task 12 (hosted-bot-oauth-registration plan): the removed
// handleGuildCreate DM-on-invite trigger is replaced by an explicit,
// in-guild reply here whenever a command is run in a guild with no
// `guilds` row, or one whose status isn't "active" -- instead of
// silently reaching AdapterClient with the bot's own default (non-
// guild-scoped) config. These pin: (1) no row at all, (2) a row present
// but not yet "active" (e.g. still "pending"), and (3) the unchanged,
// working path for a real "active" guild.

test("executeDuneCommand replies with the not-connected notice and never reaches AdapterClient when the guild has no `guilds` row at all", async () => {
  const db = createDatabase(":memory:");
  let replied = null;
  const interaction = mockInteraction("core", "about", { user: { id: "u1" }, roles: ["role-a"] });
  interaction.reply = async (r) => { replied = r; };
  const adapterClient = {
    health() { throw new Error("AdapterClient must not be called for an unregistered guild"); }
  };

  const handled = await executeDuneCommand(interaction, adapterClient, MT_CONFIG, db);

  assert.equal(handled, true);
  assert.match(replied?.content || "", /isn't connected to a console yet/);
  assert.match(replied?.content || "", /Connect to hosted bot/);
  assert.equal(replied?.ephemeral, true);
});

test("executeDuneCommand replies with the not-connected notice when the guild's `guilds` row exists but is not \"active\"", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "guild-1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "t", status: "pending" });
  addGuildRole(db, "guild-1", "moderator", "role-a");
  let replied = null;
  const interaction = mockInteraction("core", "about", { user: { id: "u1" }, roles: ["role-a"] });
  interaction.reply = async (r) => { replied = r; };
  const adapterClient = {
    health() { throw new Error("AdapterClient must not be called for a non-active guild"); }
  };

  const handled = await executeDuneCommand(interaction, adapterClient, MT_CONFIG, db);

  assert.equal(handled, true);
  assert.match(replied?.content || "", /isn't connected to a console yet/);
});

// Fix round 1 (reviewer finding): core:setup is the documented, real
// recovery path for a never-registered guild (docs/user-guide.md:38,
// "how to add this bot to your own Discord server") -- it must stay
// reachable through the new gate above, exactly like
// RBAC_EXEMPT_COMMANDS' admin:roles exemption already does for the
// unrelated RBAC gate. Both cases use the real guild owner (rather than
// a configured role) to reach dispatch, since a never-registered guild
// has zero guild_roles rows by definition and only real Discord guild
// ownership bypasses the separate, pre-existing #213/U4 zero-role gate.
test("executeDuneCommand still allows core:setup in a guild with no `guilds` row at all, without calling AdapterClient", async () => {
  const db = createDatabase(":memory:");
  let edited = null, replied = null;
  const interaction = mockInteraction("core", "setup", { user: { id: "owner-1" }, roles: [] });
  interaction.guild = { ownerId: "owner-1" };
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };
  interaction.reply = async (r) => { replied = r; };
  const adapterClient = {
    health() { throw new Error("AdapterClient must not be called for core:setup"); }
  };

  const handled = await executeDuneCommand(interaction, adapterClient, MT_CONFIG, db);

  assert.equal(handled, true);
  assert.equal(replied, null, "core:setup must not hit the new gate's interaction.reply() path at all");
  assert.ok(edited?.embeds?.[0]?.data?.title, "core:setup must still return its own setup embed via editReply");
  const description = edited?.embeds?.[0]?.data?.description || "";
  assert.doesNotMatch(description, /isn't connected to a console yet/, "core:setup must return its own setup reply, not the new gate's message");
});

test("executeDuneCommand still allows core:setup when the guild's `guilds` row exists but is not \"active\", without calling AdapterClient", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "guild-1", guildName: "Test Guild", consoleUrl: "https://example.test", adapterToken: "t", status: "pending" });
  let edited = null, replied = null;
  // A distinct userId from the sibling "no `guilds` row" test above --
  // both run core:setup, and src/cooldown.js's cooldownMap is a
  // module-level singleton keyed by userId:commandName shared across
  // this whole test file (same collision class already noted on the
  // "active guild" test further below).
  const interaction = mockInteraction("core", "setup", { user: { id: "owner-2" }, roles: [] });
  interaction.guild = { ownerId: "owner-2" };
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };
  interaction.reply = async (r) => { replied = r; };
  const adapterClient = {
    health() { throw new Error("AdapterClient must not be called for core:setup"); }
  };

  const handled = await executeDuneCommand(interaction, adapterClient, MT_CONFIG, db);

  assert.equal(handled, true);
  assert.equal(replied, null, "core:setup must not hit the new gate's interaction.reply() path at all");
  assert.ok(edited?.embeds?.[0]?.data?.title, "core:setup must still return its own setup embed via editReply");
  const description = edited?.embeds?.[0]?.data?.description || "";
  assert.doesNotMatch(description, /isn't connected to a console yet/, "core:setup must return its own setup reply, not the new gate's message");
});

test("executeDuneCommand proceeds normally (no regression) for a real \"active\" guild", async () => {
  const db = multiTenantDb({ moderator: ["role-a"] });
  let edited = null;
  // A distinct userId (not "u1") to avoid colliding with the per-
  // user/command cooldown another core:about test below asserts on --
  // src/cooldown.js's cooldownMap is a module-level singleton shared
  // across this whole test file.
  const interaction = mockInteraction("core", "about", { user: { id: "active-guild-user" }, roles: ["role-a"] });
  interaction.deferReply = async (o) => { };
  interaction.editReply = async (r) => { edited = r; };

  const handled = await executeDuneCommand(interaction, {}, MT_CONFIG, db);

  assert.equal(handled, true);
  assert.ok(edited?.embeds?.[0]?.data?.title, "core:about must still work unchanged for an active guild");
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

test("executeDuneCommand's core:setup generates an invite URL with permissions=128 (issue #281)", async () => {
  const originalClientId = process.env.DISCORD_CLIENT_ID;
  process.env.DISCORD_CLIENT_ID = "test-client-id";
  try {
    let edited = null;
    const interaction = mockInteraction("core", "setup", { user: { id: "u1" }, roles: ["role-a"] });
    interaction.deferReply = async (o) => { };
    interaction.editReply = async (r) => { edited = r; };

    const handled = await executeDuneCommand(interaction, {}, {
      discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "core:setup": ["role-a"] } } }
    });
    assert.equal(handled, true);
    const description = edited?.embeds?.[0]?.data?.description || "";
    assert.ok(
      description.includes("permissions=128"),
      `setup embed's invite URL must include permissions=128 (VIEW_AUDIT_LOG) so onboarding.js's findInviter() can identify the inviter -- got: ${description}`
    );
  } finally {
    if (originalClientId === undefined) delete process.env.DISCORD_CLIENT_ID;
    else process.env.DISCORD_CLIENT_ID = originalClientId;
  }
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
  assert.deepEqual(seenActor, { userId: "u1", username: "unknown", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-a"], guildOwnerId: undefined });
  assert.ok(edited?.embeds?.[0]?.data?.title, "summary embed has title");
});

test("executeDuneCommand routes player:storage scope=owned to playerStorage", async () => {
  let calledPlayerStorage = false, calledGuildStorage = false;
  const interaction = mockInteraction("player", "storage", {
    user: { id: "storage-owned-user" }, roles: ["role-a"],
    options: mockOptions("player", "storage", { getString: (name) => (name === "scope" ? "owned" : "") })
  });
  interaction.deferReply = async () => { };
  interaction.editReply = async () => { };
  const client = {
    playerStorage: async () => { calledPlayerStorage = true; return { ok: true, groups: {}, scope: "owned" }; },
    guildStorage: async () => { calledGuildStorage = true; return { ok: true, groups: {}, scope: "guild" }; }
  };

  await executeDuneCommand(interaction, client, {
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "player:storage": ["role-a"] } } }
  });
  assert.equal(calledPlayerStorage, true, "owned scope should call playerStorage");
  assert.equal(calledGuildStorage, false, "owned scope must not call guildStorage");
});

test("executeDuneCommand routes player:storage scope=guild to guildStorage, not playerStorage", async () => {
  let calledPlayerStorage = false, calledGuildStorage = false;
  const interaction = mockInteraction("player", "storage", {
    user: { id: "storage-guild-user" }, roles: ["role-a"],
    options: mockOptions("player", "storage", { getString: (name) => (name === "scope" ? "guild" : "") })
  });
  interaction.deferReply = async () => { };
  interaction.editReply = async () => { };
  const client = {
    playerStorage: async () => { calledPlayerStorage = true; return { ok: true, groups: {}, scope: "owned" }; },
    guildStorage: async () => { calledGuildStorage = true; return { ok: true, groups: {}, scope: "guild" }; }
  };

  await executeDuneCommand(interaction, client, {
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "player:storage": ["role-a"] } } }
  });
  assert.equal(calledGuildStorage, true, "guild scope should call the guild-scoped route");
  assert.equal(calledPlayerStorage, false, "guild scope must never fall back to the requester's own player storage");
});

test("executeDuneCommand routes player:find scope=guild to guildFind, not playerFind", async () => {
  let calledPlayerFind = false, calledGuildFind = false, seenQuery;
  const interaction = mockInteraction("player", "find", {
    user: { id: "find-guild-user" }, roles: ["role-a"],
    options: mockOptions("player", "find", { getString: (name) => (name === "scope" ? "guild" : name === "query" ? "spice" : "") })
  });
  interaction.deferReply = async () => { };
  interaction.editReply = async () => { };
  const client = {
    playerFind: async () => { calledPlayerFind = true; return { ok: true, matches: [] }; },
    guildFind: async (actor, query) => { calledGuildFind = true; seenQuery = query; return { ok: true, matches: [] }; }
  };

  await executeDuneCommand(interaction, client, {
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", commandRoleIds: { "player:find": ["role-a"] } } }
  });
  assert.equal(calledGuildFind, true, "guild scope should call the guild-scoped route");
  assert.equal(calledPlayerFind, false, "guild scope must never fall back to the requester's own player search");
  assert.equal(seenQuery, "spice");
});

test("actorFromInteraction emits minimal Discord context, including guildOwnerId (issue #240)", () => {
  const actor = actorFromInteraction({
    user: { id: "user-1" },
    guild: { ownerId: "owner-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    member: { roles: ["role-1"] }
  });
  assert.deepEqual(actor, { userId: "user-1", username: "unknown", guildId: "guild-1", channelId: "channel-1", roleIds: ["role-1"], guildOwnerId: "owner-1" });
});

test("actorFromInteraction: guildOwnerId is undefined when interaction.guild is absent and no client-cache fallback is available", () => {
  const actor = actorFromInteraction({
    user: { id: "user-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    member: { roles: ["role-1"] }
  });
  assert.equal(actor.guildOwnerId, undefined);
});

test("actorFromInteraction: guildOwnerId falls back to interaction.client.guilds.cache when interaction.guild is absent (code-review finding, issue #240) -- matches isInteractionGuildOwner's own fallback so the actor payload sent to Core cannot disagree with a local authorization decision made during the same gateway-reconnect window", () => {
  const actor = actorFromInteraction({
    user: { id: "user-1" },
    guildId: "guild-1",
    channelId: "channel-1",
    member: { roles: ["role-1"] },
    client: { guilds: { cache: new Map([["guild-1", { ownerId: "owner-1" }]]) } }
  });
  assert.equal(actor.guildOwnerId, "owner-1");
});

test("aboutPayload exposes safe metadata without secrets", () => {
  const payload = aboutPayload({ adapter: { baseUrl: "https://user:pass@example.com:8443/console", timeoutMs: 5000 }, discord: { defaultEphemeral: true, rbac: { mode: "restricted" } } });
  assert.equal(payload.bot.version, packageVersion);
  // aboutPayload() previously hardcoded readOnly: true even though V2
  // character-linking commands (link/verify/unlink/faction/enable/
  // disable/default, shipped in #69) write to the local database -- see
  // "fix: correct read-only state reporting..." commit. This is a
  // second, independent test asserting the correct value
  // (test/discord-bot-test-harness.js's "core:about" test asserts the
  // rendered embed field; this one asserts the raw payload directly).
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

test("admin:roles owner label uses the same interaction.client.guilds.cache fallback as the authorization decision (code-review finding, issue #238)", async () => {
  // interaction.guild is deliberately null (a gateway reconnect/guild-
  // unavailable window) while interaction.guildId and the client-wide cache
  // still carry the real owner -- isInteractionGuildOwner grants access via
  // that same cache fallback, and the displayed owner label must agree
  // instead of showing "(unknown -- no guild context)" for a request that
  // just succeeded because the code already knew who the owner was.
  const interaction = mockInteraction("admin", "roles", {
    user: { id: "owner-1" },
    roles: []
  });
  interaction.guild = null;
  interaction.client = { guilds: { cache: new Map([["guild-1", { ownerId: "owner-1" }]]) } };
  let edited;
  interaction.editReply = async (r) => { edited = r; };

  const handled = await executeDuneCommand(interaction, {}, {
    adapter: { baseUrl: "http://console-api:3000", timeoutMs: 8000 },
    discord: { defaultEphemeral: true, rbac: { mode: "restricted", observerRoleIds: [], adminRoleIds: [] } }
  });
  assert.equal(handled, true);
  const ownerField = edited?.embeds?.[0]?.data?.fields?.find((f) => f.name.includes("Owner"));
  assert.ok(ownerField, "roles embed should include an Owner field");
  assert.ok(
    ownerField.value.includes("owner-1"),
    `owner label should resolve owner-1 via the cache fallback, got: ${ownerField.value}`
  );
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
