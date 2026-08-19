import assert from "node:assert/strict";
import { test } from "node:test";
import { computeIdempotencyKey } from "./idempotency.mjs";

test("matches the exact spec section 43 examples", () => {
  assert.equal(
    computeIdempotencyKey("yacketrj/acp-discordbot", "issue-opened", 52, "delivery-abc"),
    "yacketrj/acp-discordbot:issue-opened:52:delivery-abc"
  );
  assert.equal(
    computeIdempotencyKey("yacketrj/acp-discordbot", "comment-created", 52, 23891827),
    "yacketrj/acp-discordbot:comment-created:52:23891827"
  );
});

test("throws rather than silently producing an incomplete key", () => {
  assert.throws(() => computeIdempotencyKey(undefined, "issue-opened", 52, "x"));
  assert.throws(() => computeIdempotencyKey("a/b", "", 52, "x"));
  assert.throws(() => computeIdempotencyKey("a/b", "issue-opened", null, "x"));
  assert.throws(() => computeIdempotencyKey("a/b", "issue-opened", 52, ""));
});
