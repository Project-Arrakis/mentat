import assert from "node:assert/strict";
import { test } from "node:test";
import { isBridgeActor, shouldIgnoreAsBridgeGenerated } from "./loopProtection.mjs";

test("recognizes the configured bridge bot identity", () => {
  assert.equal(
    isBridgeActor({ login: "acp-issue-bridge[bot]", type: "Bot" }, "acp-issue-bridge[bot]"),
    true
  );
});

test("is case-insensitive on login but still requires Bot type when provided", () => {
  assert.equal(
    isBridgeActor({ login: "ACP-Issue-Bridge[bot]", type: "Bot" }, "acp-issue-bridge[bot]"),
    true
  );
  assert.equal(
    isBridgeActor({ login: "acp-issue-bridge[bot]", type: "User" }, "acp-issue-bridge[bot]"),
    false
  );
});

test("rejects a human actor even if their login string matches", () => {
  assert.equal(
    isBridgeActor({ login: "acp-issue-bridge[bot]" }, "acp-issue-bridge[bot]"),
    true // no `type` field provided at all (e.g. some payloads) — login match still required
  );
  assert.equal(isBridgeActor({ login: "some-maintainer" }, "acp-issue-bridge[bot]"), false);
});

test("SEC-013: a bridge-created public comment is recognized so the resulting webhook event is ignored", () => {
  const actor = { login: "acp-issue-bridge[bot]", type: "Bot" };
  assert.equal(shouldIgnoreAsBridgeGenerated({ actor, expectedBotLogin: "acp-issue-bridge[bot]" }), true);
});

test("SEC-011: a forged metadata block from a public user is NOT sufficient on its own", () => {
  // The public user's comment author is a real human/user account, not the
  // bridge bot — isBridgeActor must return false regardless of any HTML
  // comment content the caller might also inspect.
  const actor = { login: "some-public-user", type: "User" };
  assert.equal(shouldIgnoreAsBridgeGenerated({ actor, expectedBotLogin: "acp-issue-bridge[bot]" }), false);
});

test("fails closed (false) when actor or expected login is missing", () => {
  assert.equal(isBridgeActor(null, "acp-issue-bridge[bot]"), false);
  assert.equal(isBridgeActor({ login: "x" }, ""), false);
  assert.equal(isBridgeActor({ login: "x" }, undefined), false);
});
