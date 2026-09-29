import assert from "node:assert/strict";
import { test } from "node:test";
import { handleGoalAutocomplete } from "../src/commands.js";
import { createDatabase, upsertGuild } from "../src/database.js";
import { createGoal } from "../src/database.js";

// NOTE: no `scope` param here (deliberately). None of the 3 real
// subcommands with an `id` autocomplete field (on-hand, progress, delete)
// has a `scope` option at all -- only create/list have `scope`, and
// neither of those has `id` -- so handleGoalAutocomplete's `id` branch
// never reads one; it mirrors the real commands' own personal-then-guild
// probe instead. See src/commands.js's `id` branch comment for the full
// story (this was a bug in the original task-10 design, corrected the same
// session it was found).
function mockGoalAutocompleteInteraction({ focusedName, focusedValue = "", userId = "u1", guildId = "guild-1", guildOwnerId = "someone-else", memberRoles = [] }) {
  const responded = [];
  return {
    isAutocomplete: () => true,
    commandName: "dune",
    guildId,
    guild: { ownerId: guildOwnerId },
    member: { roles: memberRoles },
    user: { id: userId },
    options: {
      getSubcommandGroup: () => "goal",
      getSubcommand: () => "on-hand", // overridden per-test where relevant via focusedName logic in the handler
      getFocused: (full) => (full ? { name: focusedName, value: focusedValue } : focusedValue),
      getString: () => null,
      getInteger: () => null
    },
    respond: async (choices) => { responded.push(...choices); },
    _responded: responded
  };
}

test("item autocomplete: case-insensitive substring match against the full vendored catalog", async () => {
  const db = createDatabase(":memory:");
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "item", focusedValue: "Silicone" });
  await handleGoalAutocomplete(interaction, db);
  assert.ok(interaction._responded.some((c) => c.value === "Silicone"));
});

test("item autocomplete never exceeds Discord's 25-choice cap against the much larger catalog", async () => {
  const db = createDatabase(":memory:");
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "item", focusedValue: "" });
  await handleGoalAutocomplete(interaction, db);
  assert.ok(interaction._responded.length <= 25);
});

test("id autocomplete always includes the caller's own personal goals, never another player's", async () => {
  const db = createDatabase(":memory:");
  createGoal(db, { ownerType: "player", ownerId: "u1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u1" });
  createGoal(db, { ownerType: "player", ownerId: "u2-someone-else", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u2-someone-else" });
  // u1 is not the guild owner and the guild has no admin roles configured,
  // so the guild-goal half of the merge contributes nothing here -- this
  // also exercises the "no guild goals to add" path, not just personal
  // scoping in isolation.
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "id", focusedValue: "", userId: "u1" });
  await handleGoalAutocomplete(interaction, db);
  assert.equal(interaction._responded.length, 1, "must only see u1's own goal, not u2's");
  assert.equal(interaction._responded[0].name.startsWith("Guild:"), false, "a personal-only result must not carry the guild label");
});

test("id autocomplete never includes guild goals for a non-admin, even though it always checks for them", async () => {
  const db = multiTenantDbHelper();
  createGoal(db, { ownerType: "guild", ownerId: "guild-1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "someone" });
  const nonAdminInteraction = mockGoalAutocompleteInteraction({ focusedName: "id", focusedValue: "", userId: "regular-member", guildId: "guild-1", guildOwnerId: "the-real-owner", memberRoles: [] });
  await handleGoalAutocomplete(nonAdminInteraction, db);
  assert.equal(nonAdminInteraction._responded.length, 0, "a non-admin must see zero guild goal suggestions, not a leaked list -- and has no personal goals of their own here either");

  function multiTenantDbHelper() {
    const d = createDatabase(":memory:");
    upsertGuild(d, { guildId: "guild-1", guildName: "Test", consoleUrl: "https://example.test", adapterToken: "t", status: "active" });
    return d;
  }
});

test("id autocomplete DOES include guild goals for the real guild owner, alongside their own (absent) personal goals", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "guild-1", guildName: "Test", consoleUrl: "https://example.test", adapterToken: "t", status: "active" });
  createGoal(db, { ownerType: "guild", ownerId: "guild-1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "the-real-owner" });
  const ownerInteraction = mockGoalAutocompleteInteraction({ focusedName: "id", focusedValue: "", userId: "the-real-owner", guildId: "guild-1", guildOwnerId: "the-real-owner", memberRoles: [] });
  await handleGoalAutocomplete(ownerInteraction, db);
  assert.equal(ownerInteraction._responded.length, 1);
  assert.match(ownerInteraction._responded[0].name, /^Guild:/, "the guild owner's only suggestion here is a guild goal and must be labeled as one");
});

test("id autocomplete merges an admin's own personal goals with the guild's goals in one list, labeled to disambiguate", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "guild-1", guildName: "Test", consoleUrl: "https://example.test", adapterToken: "t", status: "active" });
  createGoal(db, { ownerType: "player", ownerId: "the-real-owner", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "the-real-owner" });
  createGoal(db, { ownerType: "guild", ownerId: "guild-1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "the-real-owner" });
  const ownerInteraction = mockGoalAutocompleteInteraction({ focusedName: "id", focusedValue: "", userId: "the-real-owner", guildId: "guild-1", guildOwnerId: "the-real-owner", memberRoles: [] });
  await handleGoalAutocomplete(ownerInteraction, db);
  assert.equal(ownerInteraction._responded.length, 2, "an admin/owner must see BOTH their personal goal and the guild's goal");
  const [first, second] = ownerInteraction._responded;
  assert.equal(first.name.startsWith("Guild:"), false, "personal goals are listed first and unlabeled");
  assert.match(second.name, /^Guild:/, "the guild goal must be clearly labeled so it's not mistaken for a personal one");
});

test("node autocomplete for a simple goal only ever offers the goal's own item, never a recipe-tree node", async () => {
  const db = createDatabase(":memory:");
  const goalId = createGoal(db, { ownerType: "player", ownerId: "u1", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u1" });
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "node", focusedValue: "", userId: "u1" });
  interaction.options.getInteger = (name) => (name === "id" ? goalId : null);
  await handleGoalAutocomplete(interaction, db);
  assert.deepEqual(interaction._responded.map((c) => c.value), ["Silicone"]);
});

test("node autocomplete with no goal id selected yet returns a single non-selectable placeholder, not an empty list", async () => {
  const db = createDatabase(":memory:");
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "node", focusedValue: "", userId: "u1" });
  await handleGoalAutocomplete(interaction, db);
  assert.equal(interaction._responded.length, 1);
  assert.match(interaction._responded[0].name, /select a goal id first/i);
});

test("node autocomplete for a craftable goal never suggests water (or any other node with no real bridge mapping)", async () => {
  const db = createDatabase(":memory:");
  // small_fuel_cell's recipe tree includes `water` (LEAF_RESOURCES.water),
  // which has no real game-item id -- see gameItemIdBridge.js's documented
  // exception. Bridge id for small_fuel_cell is "FuelCanister".
  const goalId = createGoal(db, { ownerType: "player", ownerId: "u1", itemId: "FuelCanister", itemKind: "craftable", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u1" });
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "node", focusedValue: "", userId: "u1" });
  interaction.options.getInteger = (name) => (name === "id" ? goalId : null);
  await handleGoalAutocomplete(interaction, db);
  assert.ok(interaction._responded.length > 0, "sanity check: the craftable goal's own recipe tree produced real suggestions");
  assert.ok(!interaction._responded.some((c) => c.value === "water"), "must never suggest the raw internal recipe key as a fallback value");
  assert.ok(interaction._responded.every((c) => c.value !== undefined), "must never suggest a choice with an undefined value");
});

test("node autocomplete never leaks another owner's goal", async () => {
  const db = createDatabase(":memory:");
  const goalId = createGoal(db, { ownerType: "player", ownerId: "u2-someone-else", itemId: "Silicone", itemKind: "simple", targetQuantity: 10, stationTier: null, craftingContract: false, dueAt: null, createdBy: "u2-someone-else" });
  const interaction = mockGoalAutocompleteInteraction({ focusedName: "node", focusedValue: "", userId: "u1", guildId: null });
  interaction.options.getInteger = (name) => (name === "id" ? goalId : null);
  await handleGoalAutocomplete(interaction, db);
  assert.equal(interaction._responded.length, 0);
});
