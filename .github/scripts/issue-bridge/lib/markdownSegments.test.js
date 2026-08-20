import assert from "node:assert/strict";
import { test } from "node:test";
import { splitMarkdownSegments, transformTextSegments } from "./markdownSegments.mjs";

test("splits fenced code blocks from surrounding text", () => {
  const segments = splitMarkdownSegments("before\n```\ncode here\n```\nafter");
  assert.deepEqual(segments.map((s) => s.type), ["text", "code", "text"]);
  assert.equal(segments[1].value, "```\ncode here\n```");
});

test("splits inline code spans from surrounding text", () => {
  const segments = splitMarkdownSegments("run `npm test` now");
  assert.deepEqual(segments.map((s) => s.type), ["text", "code", "text"]);
  assert.equal(segments[1].value, "`npm test`");
});

test("returns a single text segment when there is no code", () => {
  const segments = splitMarkdownSegments("just plain text");
  assert.deepEqual(segments, [{ type: "text", value: "just plain text" }]);
});

test("transformTextSegments only rewrites text, not code", () => {
  assert.equal(transformTextSegments("hello `code` world", (t) => t.toUpperCase()), "HELLO `code` WORLD");
  assert.equal(
    transformTextSegments("a\n```\nkeep me\n```\nb", (t) => t.toUpperCase()),
    "A\n```\nkeep me\n```\nB"
  );
});

test("handles empty/non-string input safely", () => {
  assert.deepEqual(splitMarkdownSegments(""), [{ type: "text", value: "" }]);
  assert.deepEqual(splitMarkdownSegments(null), [{ type: "text", value: "" }]);
});
