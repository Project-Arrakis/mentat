import assert from "node:assert/strict";
import { test } from "node:test";
import { sanitizeInboundContent } from "./sanitize.mjs";

test("preserves ordinary markdown, code blocks, and URLs", () => {
  const text = "# Bug\n\nSee https://example.com\n\n```js\nconsole.log('hi')\n```\n\n> quoted note";
  assert.equal(sanitizeInboundContent(text), text);
});

test("strips C0 control characters except tab/newline", () => {
  const text = "hello\x00\x07world\tok\n";
  assert.equal(sanitizeInboundContent(text), "helloworld\tok\n");
});

test("strips bidi override/isolate characters", () => {
  const text = "normal \u202Ereversed\u2069 text";
  const result = sanitizeInboundContent(text);
  assert.equal(/[\u202A-\u202E\u2066-\u2069]/.test(result), false);
  assert.equal(result, "normal reversed text");
});

test("normalizes CRLF and lone CR to LF", () => {
  assert.equal(sanitizeInboundContent("a\r\nb\rc"), "a\nb\nc");
});

test("truncates oversized content and appends a visible notice", () => {
  const big = "x".repeat(100);
  const result = sanitizeInboundContent(big, { maxBytes: 50 });
  assert.equal(result.startsWith("x".repeat(50)), true);
  assert.match(result, /truncated/);
});

test("truncation never splits a multi-byte UTF-8 character", () => {
  const emoji = "\u{1F600}"; // 4-byte UTF-8 grinning face
  const text = "a".repeat(10) + emoji.repeat(10);
  const result = sanitizeInboundContent(text, { maxBytes: 13 });
  // The truncated prefix (before the notice) must be valid UTF-8 — re-encoding
  // and decoding should not produce the replacement character U+FFFD.
  const prefix = result.split("\n\n_[ACP")[0];
  assert.equal(prefix.includes("\uFFFD"), false);
});

test("handles empty/non-string input safely", () => {
  assert.equal(sanitizeInboundContent(""), "");
  assert.equal(sanitizeInboundContent(null), "");
  assert.equal(sanitizeInboundContent(undefined), "");
});
