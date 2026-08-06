import assert from "node:assert/strict";
import { test } from "node:test";
import { tierAtLeast, dbActorTier, ROLE_TYPE_LABELS, TIER_RANK } from "../src/rbac.js";

test("TIER_RANK orders player-as-observer < moderator < admin < owner", () => {
  assert.deepEqual(TIER_RANK, { observer: 0, moderator: 1, admin: 2, owner: 3 });
});

test("ROLE_TYPE_LABELS maps the DB observer tier to the user-facing player label", () => {
  assert.equal(ROLE_TYPE_LABELS.observer, "player");
  assert.equal(ROLE_TYPE_LABELS.moderator, "moderator");
  assert.equal(ROLE_TYPE_LABELS.admin, "admin");
  assert.equal(ROLE_TYPE_LABELS.owner, "owner");
});

test("tierAtLeast honors the ordering and fails closed on unknown/missing tiers", () => {
  assert.equal(tierAtLeast("observer", "observer"), true);
  assert.equal(tierAtLeast("observer", "moderator"), false);
  assert.equal(tierAtLeast("owner", "admin"), true);
  assert.equal(tierAtLeast("admin", "owner"), false);
  assert.equal(tierAtLeast(null, "admin"), false);
  assert.equal(tierAtLeast(undefined, "admin"), false);
  assert.equal(tierAtLeast("super-admin", "admin"), false);
  assert.equal(tierAtLeast("admin", "super-admin"), false);
  assert.equal(tierAtLeast("owner", "bogus"), false);
});

test("dbActorTier returns the highest tier whose role_id the actor holds", () => {
  const roles = [
    { role_type: "observer", role_id: "player-role" },
    { role_type: "moderator", role_id: "mod-role" },
    { role_type: "admin", role_id: "admin-role" },
    { role_type: "owner", role_id: "owner-role" }
  ];
  assert.equal(dbActorTier(["player-role"], roles), "observer");
  assert.equal(dbActorTier(["mod-role"], roles), "moderator");
  assert.equal(dbActorTier(["admin-role"], roles), "admin");
  assert.equal(dbActorTier(["owner-role"], roles), "owner");
  assert.equal(dbActorTier(["admin-role", "owner-role"], roles), "owner");
  // highest tier wins even when the actor holds the whole ladder
  assert.equal(dbActorTier(["player-role", "mod-role", "admin-role", "owner-role"], roles), "owner");
});

test("dbActorTier returns null when no configured role matches", () => {
  const roles = [{ role_type: "admin", role_id: "admin-role" }];
  assert.equal(dbActorTier(["unrelated-role"], roles), null);
  assert.equal(dbActorTier([], roles), null);
  assert.equal(dbActorTier(["admin-role"], null), null);
  assert.equal(dbActorTier(["admin-role"], []), null);
});

test("dbActorTier ignores unknown role_type values (future-proof fail-closed)", () => {
  const roles = [
    { role_type: "bogus", role_id: "x" },
    { role_type: "admin", role_id: "admin-role" }
  ];
  assert.equal(dbActorTier(["x"], roles), null);
  assert.equal(dbActorTier(["admin-role"], roles), "admin");
});
