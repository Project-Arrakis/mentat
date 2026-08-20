import assert from "node:assert/strict";
import { test } from "node:test";
import { parseChecksumIssueBody, renderChecksumIssueBody, sha256Hex } from "./configChecksum.mjs";

test("sha256Hex is deterministic", () => {
  assert.equal(sha256Hex("hello"), sha256Hex("hello"));
  assert.notEqual(sha256Hex("hello"), sha256Hex("hello world"));
  assert.match(sha256Hex("hello"), /^[0-9a-f]{64}$/);
});

test("renderChecksumIssueBody round-trips through parseChecksumIssueBody", () => {
  const hash = sha256Hex("version: 1\n");
  const body = renderChecksumIssueBody(hash, "2026-08-19T00:00:00Z");
  assert.equal(parseChecksumIssueBody(body), hash);
});

test("parseChecksumIssueBody returns null for malformed content", () => {
  assert.equal(parseChecksumIssueBody("nothing relevant here"), null);
  assert.equal(parseChecksumIssueBody(""), null);
  assert.equal(parseChecksumIssueBody(null), null);
});
