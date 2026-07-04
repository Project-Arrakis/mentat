import assert from "node:assert/strict";
import { test } from "node:test";
import { writesEnabled, canWrite, generateIdempotencyKey, requireConfirmation, isConfirmationResponse, writeRoleIds, parseCsv } from "../src/writes.js";

test("writesEnabled returns false by default", () => {
  assert.equal(writesEnabled({}), false);
});

test("writesEnabled respects env flag", () => {
  const old = process.env.DUNE_DISCORD_WRITES_ENABLED;
  process.env.DUNE_DISCORD_WRITES_ENABLED = "true";
  try {
    assert.equal(writesEnabled({}), true);
  } finally {
    process.env.DUNE_DISCORD_WRITES_ENABLED = old;
  }
});

test("writesEnabled respects config flag", () => {
  assert.equal(writesEnabled({ discord: { writes: { enabled: true } } }), true);
});

test("canWrite returns false when writes disabled", () => {
  assert.equal(canWrite({ member: { roles: { cache: new Map([["admin", {}]]) } } }, {}), false);
});

test("writeRoleIds parses env vars", () => {
  const oldAdmin = process.env.DISCORD_WRITE_ADMIN_ROLE_IDS;
  const oldOwner = process.env.DISCORD_WRITE_OWNER_ROLE_IDS;
  process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = "a,b";
  process.env.DISCORD_WRITE_OWNER_ROLE_IDS = "c";
  try {
    const ids = writeRoleIds();
    assert.deepEqual(ids.admin, ["a", "b"]);
    assert.deepEqual(ids.owner, ["c"]);
  } finally {
    process.env.DISCORD_WRITE_ADMIN_ROLE_IDS = oldAdmin;
    process.env.DISCORD_WRITE_OWNER_ROLE_IDS = oldOwner;
  }
});

test("generateIdempotencyKey produces unique keys", () => {
  const k1 = generateIdempotencyKey();
  const k2 = generateIdempotencyKey();
  assert.ok(k1.startsWith("dune-idem-"));
  assert.notEqual(k1, k2);
});

test("requireConfirmation returns confirmation message", () => {
  const result = requireConfirmation({ action: "set-maintenance-note", target: "server", risk: "low" });
  assert.equal(result.needsConfirmation, true);
  assert.ok(result.message.includes("set-maintenance-note"));
  assert.ok(result.message.includes("server"));
});

test("isConfirmationResponse recognizes confirm", () => {
  assert.equal(isConfirmationResponse("confirm"), true);
  assert.equal(isConfirmationResponse(" Confirm "), true);
  assert.equal(isConfirmationResponse("cancel"), false);
  assert.equal(isConfirmationResponse("no"), false);
});

test("parseCsv splits and trims", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("a, b ,c"), ["a", "b", "c"]);
});
