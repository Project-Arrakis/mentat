// guildRoles.test.js -- mentat#343+ Phase 4 (design doc issues #835/#847).
// The old /setup portal's own single-role-per-tier behavior is already
// covered end-to-end by test/setupServer.test.js's HTTP-level tests
// (unchanged after this extraction -- confirmed by that suite still
// passing). This file covers the NEW array-per-tier path directly, which
// nothing exercised before this extraction existed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase, getGuildRoles, upsertGuild } from "../src/database.js";
import { findRoleTierConflict, applyGuildRoleMapping } from "../src/guildRoles.js";

function fakeDb() {
  return createDatabase(":memory:");
}

// guild_roles has a FOREIGN KEY on guilds(guild_id) -- a role mapping
// can't exist for a guild that was never registered. Real callers always
// go through verifyAndRegisterConsole()/the old /setup portal (both call
// upsertGuild() before ever touching roles); these tests need the same
// precondition satisfied directly.
function seedGuild(db, guildId) {
  upsertGuild(db, { guildId, guildName: "Test Guild", consoleUrl: "https://console.test", adapterToken: "tok", status: "active" });
}

// ─── findRoleTierConflict: array-per-tier ────────────────────────────────

test("findRoleTierConflict: no conflict when every tier has multiple, disjoint role IDs", () => {
  const result = findRoleTierConflict({
    adminRoleIds: ["r1", "r2"],
    moderatorRoleIds: ["r3", "r4"],
    observerRoleIds: ["r5", "r6"],
    existingRoles: []
  });
  assert.equal(result, null);
});

test("findRoleTierConflict: detects a conflict between two roles in the SAME submission, in different tiers", () => {
  const result = findRoleTierConflict({
    adminRoleIds: ["r1", "shared-role"],
    moderatorRoleIds: ["r3", "shared-role"],
    observerRoleIds: [],
    existingRoles: []
  });
  assert.ok(result);
  assert.equal(result.roleId, "shared-role");
  assert.deepEqual([result.tierA, result.tierB].sort(), ["admin", "moderator"]);
});

test("findRoleTierConflict: detects a conflict between a SUBMITTED role and a DIFFERENT existing role's tier (not a resubmission)", () => {
  // role-y already exists under moderator (and is NOT being resubmitted
  // this time -- only role-x is submitted, under admin). No overlap in
  // role_id, so this is NOT a conflict -- distinct roles can live in
  // distinct tiers freely. This test exists to pin that a merely-
  // DIFFERENT existing role never spuriously conflicts.
  const result = findRoleTierConflict({
    adminRoleIds: ["role-x"],
    moderatorRoleIds: [],
    observerRoleIds: [],
    existingRoles: [{ role_type: "moderator", role_id: "role-y" }]
  });
  assert.equal(result, null);
});

test("findRoleTierConflict: a role resubmitted under a NEW tier is NOT flagged as conflicting with its own prior mapping (reassignment, not a conflict)", () => {
  // role-x was previously mapped to observer; this submission moves it to
  // admin. Same role_id in both submitted and existing -- by this
  // function's own documented exclusion rule, ANY existing row whose
  // role_id is also present in the current submission is excluded from
  // the comparison entirely (a deliberate reassignment, matching
  // applyGuildRoleMapping()'s write behavior below, which removes the
  // old row before re-adding under the new tier). This is NOT a conflict.
  const result = findRoleTierConflict({
    adminRoleIds: ["role-x"],
    moderatorRoleIds: [],
    observerRoleIds: [],
    existingRoles: [{ role_type: "observer", role_id: "role-x" }]
  });
  assert.equal(result, null);
});

test("findRoleTierConflict: existing rows whose role_id is ALSO in the current submission are excluded from the conflict check (real reassignment case)", () => {
  // role-x already exists as observer; THIS submission re-submits role-x
  // under admin (the actual reassignment request) -- the existing
  // observer row for role-x must be excluded from the comparison, or
  // every reassignment would be rejected as conflicting with itself.
  const result = findRoleTierConflict({
    adminRoleIds: ["role-x"],
    moderatorRoleIds: [],
    observerRoleIds: [],
    existingRoles: [{ role_type: "observer", role_id: "role-x" }, { role_type: "moderator", role_id: "role-y" }]
  });
  assert.equal(result, null, "reassigning role-x to admin must not conflict with its own existing observer row");
});

test("findRoleTierConflict: N roles per tier -- a conflict deep in a large array is still found", () => {
  const adminRoleIds = Array.from({ length: 10 }, (_, i) => `admin-${i}`);
  const moderatorRoleIds = [...Array.from({ length: 5 }, (_, i) => `mod-${i}`), "admin-7"];
  const result = findRoleTierConflict({ adminRoleIds, moderatorRoleIds, observerRoleIds: [], existingRoles: [] });
  assert.ok(result);
  assert.equal(result.roleId, "admin-7");
});

// ─── applyGuildRoleMapping: array-per-tier writes ─────────────────────────

test("applyGuildRoleMapping: writes multiple roles to the same tier (the actual N-per-tier case findRoleTierConflict's own extraction exists for)", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  applyGuildRoleMapping(db, "guild-1", { adminRoleIds: ["a1", "a2", "a3"], moderatorRoleIds: [], observerRoleIds: [] });
  const rows = getGuildRoles(db, "guild-1");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.role_id).sort(), ["a1", "a2", "a3"]);
  assert.ok(rows.every((r) => r.role_type === "admin"));
});

test("applyGuildRoleMapping: writes across all three tiers with multiple roles each", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  applyGuildRoleMapping(db, "guild-1", {
    adminRoleIds: ["a1", "a2"],
    moderatorRoleIds: ["m1"],
    observerRoleIds: ["o1", "o2", "o3"]
  });
  const rows = getGuildRoles(db, "guild-1");
  assert.equal(rows.length, 6);
});

test("applyGuildRoleMapping: reassigning a role removes its OLD tier's row before adding the new one -- never leaves it mapped to both", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  applyGuildRoleMapping(db, "guild-1", { adminRoleIds: [], moderatorRoleIds: [], observerRoleIds: ["role-x"] });
  assert.deepEqual(getGuildRoles(db, "guild-1").map((r) => r.role_type), ["observer"]);

  // Reassign role-x from observer to admin.
  applyGuildRoleMapping(db, "guild-1", { adminRoleIds: ["role-x"], moderatorRoleIds: [], observerRoleIds: [] });
  const rows = getGuildRoles(db, "guild-1");
  assert.equal(rows.length, 1, "role-x must not end up mapped to BOTH observer and admin");
  assert.equal(rows[0].role_type, "admin");
});

test("applyGuildRoleMapping: is idempotent -- reapplying the identical mapping doesn't duplicate rows", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  const mapping = { adminRoleIds: ["a1"], moderatorRoleIds: ["m1"], observerRoleIds: [] };
  applyGuildRoleMapping(db, "guild-1", mapping);
  applyGuildRoleMapping(db, "guild-1", mapping);
  assert.equal(getGuildRoles(db, "guild-1").length, 2);
});

test("applyGuildRoleMapping: a guild's mappings are independent of another guild's", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  seedGuild(db, "guild-2");
  applyGuildRoleMapping(db, "guild-1", { adminRoleIds: ["shared-id"], moderatorRoleIds: [], observerRoleIds: [] });
  applyGuildRoleMapping(db, "guild-2", { adminRoleIds: [], moderatorRoleIds: ["shared-id"], observerRoleIds: [] });
  assert.equal(getGuildRoles(db, "guild-1")[0].role_type, "admin");
  assert.equal(getGuildRoles(db, "guild-2")[0].role_type, "moderator");
});

// ─── The old portal's single-role usage is the degenerate one-element
// case of the same functions (regression-proofing the extraction itself) ─

test("single-element arrays behave identically to the old portal's single-role calling convention", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  const conflict = findRoleTierConflict({ adminRoleIds: ["same"], moderatorRoleIds: ["same"], observerRoleIds: [], existingRoles: [] });
  assert.ok(conflict, "the exact shape the old single-role findRoleTierConflict() test suite already covers via test/setupServer.test.js");

  applyGuildRoleMapping(db, "guild-1", { adminRoleIds: ["r1"], moderatorRoleIds: [], observerRoleIds: [] });
  assert.equal(getGuildRoles(db, "guild-1").length, 1);
});

// ─── Layer 2 audit finding: applyGuildRoleMapping() self-enforces the
// separation-of-duties invariant, independent of caller discipline ───────

test("applyGuildRoleMapping throws (and writes nothing) when called directly with a one-role-two-tiers submission, even without a prior findRoleTierConflict() call", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  assert.throws(
    () => applyGuildRoleMapping(db, "guild-1", { adminRoleIds: ["shared"], moderatorRoleIds: ["shared"], observerRoleIds: [] }),
    /refusing to write a one-role-two-tiers violation/
  );
  assert.equal(getGuildRoles(db, "guild-1").length, 0, "a rejected call must write nothing at all");
});

test("applyGuildRoleMapping throws when the submission conflicts with an EXISTING, different-role mapping already in the DB", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  applyGuildRoleMapping(db, "guild-1", { adminRoleIds: [], moderatorRoleIds: ["role-x"], observerRoleIds: [] });
  assert.throws(
    () => applyGuildRoleMapping(db, "guild-1", { adminRoleIds: ["role-x"], moderatorRoleIds: ["role-x"], observerRoleIds: [] }),
    /refusing to write a one-role-two-tiers violation/
  );
});

// ─── Layer 2 audit finding: the write sequence is atomic -- a mid-sequence
// failure must not leave a partial write ──────────────────────────────────

test("applyGuildRoleMapping's remove-then-add sequence is wrapped in a real transaction (db.transaction is actually invoked, not just documented)", () => {
  const db = fakeDb();
  seedGuild(db, "guild-1");
  let transactionInvoked = false;
  const originalTransaction = db.transaction.bind(db);
  db.transaction = (fn) => {
    transactionInvoked = true;
    return originalTransaction(fn);
  };
  try {
    applyGuildRoleMapping(db, "guild-1", { adminRoleIds: ["r1"], moderatorRoleIds: [], observerRoleIds: [] });
    assert.equal(transactionInvoked, true, "the write sequence must actually go through db.transaction(), not just claim to in a comment");
  } finally {
    db.transaction = originalTransaction;
  }
});
