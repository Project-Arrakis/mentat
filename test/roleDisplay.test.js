import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRoleLabel, resolveRoleLabels } from "../src/roleDisplay.js";

function mockGuild(roles = []) {
  return {
    roles: {
      cache: new Map(roles.map((r) => [r.id, r]))
    }
  };
}

test("resolveRoleLabel returns 'RoleName (RoleID)' for a role that exists in the guild", () => {
  const guild = mockGuild([{ id: "111", name: "Moderators" }]);
  assert.equal(resolveRoleLabel(guild, "111"), "Moderators (111)");
});

test("resolveRoleLabel returns 'Unknown Role (RoleID)' for a role ID not in the guild (the stale/wrong-ID case)", () => {
  const guild = mockGuild([{ id: "111", name: "Moderators" }]);
  assert.equal(resolveRoleLabel(guild, "999"), "Unknown Role (999)");
});

test("resolveRoleLabel returns '(none)' for an empty/missing role ID", () => {
  const guild = mockGuild([{ id: "111", name: "Moderators" }]);
  assert.equal(resolveRoleLabel(guild, ""), "(none)");
  assert.equal(resolveRoleLabel(guild, null), "(none)");
  assert.equal(resolveRoleLabel(guild, undefined), "(none)");
});

test("resolveRoleLabel returns 'Unknown Role (RoleID)' (not a crash) when guild is missing entirely", () => {
  assert.equal(resolveRoleLabel(null, "111"), "Unknown Role (111)");
  assert.equal(resolveRoleLabel(undefined, "111"), "Unknown Role (111)");
});

test("resolveRoleLabels resolves a batch of { role_type, role_id } rows, preserving role_type", () => {
  const guild = mockGuild([
    { id: "111", name: "Moderators" },
    { id: "222", name: "Officers" }
  ]);
  const rows = [
    { role_type: "admin", role_id: "111" },
    { role_type: "observer", role_id: "222" },
    { role_type: "observer", role_id: "999" } // stale ID, not in guild
  ];
  const result = resolveRoleLabels(guild, rows);
  assert.deepEqual(result, [
    { roleType: "admin", roleId: "111", label: "Moderators (111)" },
    { roleType: "observer", roleId: "222", label: "Officers (222)" },
    { roleType: "observer", roleId: "999", label: "Unknown Role (999)" }
  ]);
});

test("resolveRoleLabels returns an empty array for empty/non-array input", () => {
  const guild = mockGuild([]);
  assert.deepEqual(resolveRoleLabels(guild, []), []);
  assert.deepEqual(resolveRoleLabels(guild, null), []);
  assert.deepEqual(resolveRoleLabels(guild, undefined), []);
});
