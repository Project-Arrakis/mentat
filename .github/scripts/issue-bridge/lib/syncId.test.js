import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSyncId, isValidSyncId, parseSyncId } from "./syncId.mjs";

test("computes the canonical sync id", () => {
  assert.equal(computeSyncId(52), "ACP-PUBLIC-52");
  assert.equal(computeSyncId("7"), "ACP-PUBLIC-7");
});

test("rejects non-positive or non-integer issue numbers", () => {
  assert.throws(() => computeSyncId(0));
  assert.throws(() => computeSyncId(-3));
  assert.throws(() => computeSyncId(1.5));
  assert.throws(() => computeSyncId("abc"));
  assert.throws(() => computeSyncId(undefined));
});

test("parses a well-formed sync id back to its issue number", () => {
  assert.equal(parseSyncId("ACP-PUBLIC-52"), 52);
  assert.equal(parseSyncId("  ACP-PUBLIC-7  "), 7);
});

test("returns null for malformed sync ids instead of throwing", () => {
  assert.equal(parseSyncId("ACP-PUBLIC-"), null);
  assert.equal(parseSyncId("acp-public-52"), null);
  assert.equal(parseSyncId("ACP-PUBLIC-52-extra"), null);
  assert.equal(parseSyncId("ACP-PUBLIC--1"), null);
  assert.equal(parseSyncId(52), null);
  assert.equal(parseSyncId(null), null);
  assert.equal(parseSyncId(""), null);
});

test("isValidSyncId reflects parseability", () => {
  assert.equal(isValidSyncId("ACP-PUBLIC-52"), true);
  assert.equal(isValidSyncId("ACP-PUBLIC-0"), false);
  assert.equal(isValidSyncId("random text"), false);
});
