// mentat#424: every dispatchable WRITE_ACTIONS subcommand must appear in
// /dune core help (when writes are enabled), and none may leak into the
// public, unauthenticated getCommandRegistry() feed (#203).
import test from "node:test";
import assert from "node:assert/strict";
import { helpPayload, getCommandRegistry, buildDuneCommand } from "../src/commands.js";
import { formatHelpEmbed } from "../src/embedFormat.js";
import { WRITE_ACTIONS } from "../src/writeActions.js";
import { LEGACY_WRITE_STUBS } from "../src/writeHandler.js";

const EXPECTED_WRITE_ACTION_COUNT = 28;
const WRITE_GROUPS = [...new Set(WRITE_ACTIONS.map((e) => e.group))];

const config = () => ({
  multiTenant: false,
  discord: { rbac: { mode: "open", observerRoleIds: [], adminRoleIds: [], commandRoleIds: {} }, writes: { enabled: true }, defaultEphemeral: true, botOperatorUserId: "op-1" }
});
const ownerInteraction = () => ({
  member: { roles: [] }, user: { id: "op-1" }, guildId: "g1",
  guild: { ownerId: "op-1" }
});
const memberInteraction = () => ({ member: { roles: [] }, user: { id: "nobody" }, guildId: "g1", guild: { ownerId: "op-1" } });

test("WRITE_ACTIONS count is pinned (accidental drop/add must be deliberate)", () => {
  assert.equal(WRITE_ACTIONS.length, EXPECTED_WRITE_ACTION_COUNT);
});

test("helpPayload (writes enabled, owner) mentions every WRITE_ACTIONS subcommand", () => {
  const p = helpPayload(config(), ownerInteraction());
  const names = new Set([...p.available, ...p.locked]);
  for (const e of WRITE_ACTIONS) assert.ok(names.has(`${e.group}:${e.name}`), `help is missing ${e.group}:${e.name}`);
  assert.equal(names.size, p.total, "no duplicate names in help");
  assert.equal(p.available.length + p.locked.length, p.total);
});

test("help surface with writes on equals the registered Discord tree", () => {
  const registered = new Set();
  for (const g of buildDuneCommand({ includeWriteGroup: true }).toJSON().options)
    for (const s of g.options || []) registered.add(`${g.name}:${s.name}`);
  const p = helpPayload(config(), ownerInteraction());
  assert.deepEqual([...p.available, ...p.locked].sort(), [...registered].sort());
});

test("write entries are locked for a caller with no write access; host-operator-only self-update tracks the operator id", () => {
  const p = helpPayload(config(), memberInteraction());
  assert.ok(p.locked.includes("player:kick"));
  assert.ok(p.locked.includes("bot:self-update"));
  assert.ok(!p.available.includes("server:restart"));
  const o = helpPayload(config(), ownerInteraction());
  assert.ok(o.available.includes("server:restart"));
  assert.ok(o.available.includes("bot:self-update"));
});

test("write entries are absent from help when writes are disabled", () => {
  const c = config(); c.discord.writes.enabled = false;
  const saved = process.env.DUNE_DISCORD_WRITES_ENABLED; delete process.env.DUNE_DISCORD_WRITES_ENABLED;
  try {
    const p = helpPayload(c, ownerInteraction());
    assert.ok(![...p.available, ...p.locked].some((n) => n === "player:kick" || n.startsWith("write:")));
  } finally { if (saved !== undefined) process.env.DUNE_DISCORD_WRITES_ENABLED = saved; }
});

test("help embed for the worst case (writes on, owner, all available) fits Discord limits and lists everything", () => {
  const p = helpPayload(config(), ownerInteraction());
  const embed = formatHelpEmbed(p);
  const fields = embed.data.fields;
  assert.ok(fields.length <= 25);
  let total = (embed.data.title || "").length + (embed.data.description || "").length + (embed.data.footer?.text || "").length;
  for (const f of fields) { assert.ok(f.value.length <= 1024); assert.ok(f.name.length <= 256); total += f.name.length + f.value.length; }
  assert.ok(total <= 6000, `embed total ${total} > 6000`);
  const text = fields.map((f) => f.value).join(" ");
  for (const e of WRITE_ACTIONS) assert.ok(text.includes(`\`${e.name}\``), `embed omits ${e.name}`);
});

test("help embed never silently truncates an oversized group (splits into continuation fields)", () => {
  const available = Array.from({ length: 120 }, (_, i) => `big:command-number-${i}`);
  const embed = formatHelpEmbed({ available, locked: [], total: 120, availableCount: 120, rbacMode: "open" });
  const text = embed.data.fields.map((f) => f.value).join(" ");
  for (const n of available) assert.ok(text.includes(`\`${n.split(":")[1]}\``), `${n} truncated`);
  for (const f of embed.data.fields) assert.ok(f.value.length <= 1024);
});

test("PUBLIC getCommandRegistry() never contains a write group or write subcommand (#203)", () => {
  const reg = getCommandRegistry();
  assert.ok(!reg.some((g) => g.group === "write"), "write group leaked into the public registry");
  for (const e of WRITE_ACTIONS) {
    const g = reg.find((x) => x.group === e.group);
    if (!g) continue; // whole write-only group absent: fine
    assert.ok(!g.commands.some((c) => c.name.split(" ")[0] === e.name), `write action ${e.group}:${e.name} leaked into public registry`);
  }
  for (const g of WRITE_GROUPS.filter((x) => !["player", "server"].includes(x))) {
    assert.ok(!reg.some((r) => r.group === g), `write-only group ${g} leaked into public registry`);
  }
});

// ── availability must equal "may actually run it" (RBAC gate AND write tier) ──
import { isCommandAllowed } from "../src/commands.js";
import { canWrite } from "../src/writes.js";
import { createDatabase, upsertGuild, addGuildRole, updateGuildSettings } from "../src/database.js";

const mk = (id, roles, owner) => ({ member: { roles }, user: { id }, guildId: "g1", guild: { ownerId: owner || "OWN" } });
const callerSet = (adminRoles) => ({
  public: mk("pub", []), observer: mk("o", ["ro"]), moderator: mk("m", ["rm"]),
  admin: mk("a", adminRoles), owner: mk("OWN", [], "OWN"), operator: mk("OP", [])
});


function realAvailable(i, cfg, db, key, tier) {
  if (!isCommandAllowed(i, key, cfg, db, "g1")) return false;
  if (tier === "host-operator") return cfg.discord.botOperatorUserId === i.user.id;
  return canWrite(i, cfg, tier, db, "g1");
}
function assertMatrix(label, cfg, db, callers) {
  for (const [cn, i] of Object.entries(callers)) {
    const av = new Set(helpPayload(cfg, i, db, "g1").available);
    const keys = [...WRITE_ACTIONS.map((a) => [`${a.group}:${a.name}`, a.tier]), ...LEGACY_WRITE_STUBS.map((l) => [`write:${l.name}`, l.tier]), ["admin:broadcast", null]];
    for (const [key, tier] of keys) {
      const real = key === "admin:broadcast" ? null : realAvailable(i, cfg, db, key, tier);
      if (real === null) { if (!isCommandAllowed(i, key, cfg, db, "g1")) assert.ok(!av.has(key), `${label}/${cn}: ${key} available but RBAC-refused`); continue; }
      assert.equal(av.has(key), real, `${label}/${cn}: ${key} help=${av.has(key)} real=${real}`);
    }
  }
}

test("help availability equals RBAC gate AND write tier (multi-tenant, restricted and open)", () => {
  for (const mode of ["restricted", "open"]) {
    const db = createDatabase(":memory:");
    upsertGuild(db, { guildId: "g1", guildName: "x", consoleUrl: "https://e.t", adapterToken: "t", status: "active" });
    updateGuildSettings(db, "g1", { rbac_mode: mode });
    addGuildRole(db, "g1", "observer", "ro"); addGuildRole(db, "g1", "moderator", "rm"); addGuildRole(db, "g1", "admin", "ra");
    assertMatrix(`MT-${mode}`, { multiTenant: true, discord: { writes: { enabled: true }, botOperatorUserId: "OP", rbac: { mode: "restricted" } } }, db, callerSet(["ra"]));
  }
});

test("help availability equals RBAC gate AND write tier (single-tenant, write-admin role outside read lists, commandRoleIds override)", () => {
  const saved = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "wa";
  try {
    for (const mode of ["restricted", "open"]) {
      for (const overrides of [{}, { "player:kick": ["ro"], "write:cache": ["rm"] }]) {
        const cfg = { multiTenant: false, discord: { writes: { enabled: true }, botOperatorUserId: "OP", rbac: { mode, observerRoleIds: ["ro"], adminRoleIds: ["ra"], commandRoleIds: overrides } } };
        assertMatrix(`ST-${mode}-${Object.keys(overrides).length}`, cfg, null, callerSet(["wa"]));
        assertMatrix(`ST-${mode}-both`, cfg, null, callerSet(["ra", "wa"]));
      }
    }
  } finally { if (saved === undefined) delete process.env.DISCORD_WRITE_ADMIN_ROLE_IDS; else process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = saved; }
});

test("write:cache is owner-tier: locked for admin, available for owner (real tier from LEGACY_WRITE_STUBS)", () => {
  const saved = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "wa";
  try {
    const cfg = { multiTenant: false, discord: { writes: { enabled: true }, botOperatorUserId: "OP", rbac: { mode: "open", observerRoleIds: [], adminRoleIds: [], commandRoleIds: {} } } };
    const admin = helpPayload(cfg, mk("a", ["wa"]), null, "g1");
    assert.ok(admin.locked.includes("write:cache"));
    assert.ok(admin.available.includes("write:alert-channel"));
    assert.ok(helpPayload(cfg, ownerInteraction(), null, "g1").available.includes("write:cache"));
  } finally { if (saved === undefined) delete process.env.DISCORD_WRITE_ADMIN_ROLE_IDS; else process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = saved; }
});

test("drift guard: help's write:* names equal LEGACY_WRITE_STUBS exactly", () => {
  const p = helpPayload(config(), ownerInteraction());
  const helped = [...p.available, ...p.locked].filter((n) => n.startsWith("write:")).sort();
  assert.deepEqual(helped, LEGACY_WRITE_STUBS.map((l) => `write:${l.name}`).sort());
});
