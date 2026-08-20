import assert from "node:assert/strict";
import { test } from "node:test";
import { containsMention, suppressMentions } from "./mentions.mjs";

test("suppresses a plain mention with a zero-width space after @", () => {
  const result = suppressMentions("@maintainer please check");
  assert.equal(result, "@\u200Bmaintainer please check");
  assert.notEqual(result, "@maintainer please check");
});

test("SEC-015: suppresses a mention-injection attempt in a public comment", () => {
  const result = suppressMentions("@ACP-Admins please check.");
  assert.equal(result.startsWith("@\u200BACP-Admins"), true);
});

test("suppresses an org/team mention, preserving the team suffix", () => {
  const result = suppressMentions("cc @yacketrj/maintainers for review");
  assert.equal(result, "cc @\u200Byacketrj/maintainers for review");
});

test("suppresses a mention at the very start of the string", () => {
  const result = suppressMentions("@everyone look at this");
  assert.equal(result.startsWith("@\u200Beveryone"), true);
});

test("does not touch an email address", () => {
  const text = "contact me at foo@bar.com for details";
  assert.equal(suppressMentions(text), text);
});

test("does not modify mentions inside a fenced code block", () => {
  const text = "Example:\n```\n@everyone hi\n```\nDone.";
  const result = suppressMentions(text);
  assert.equal(result, text);
});

test("does not modify mentions inside inline code", () => {
  const text = "Use `@here` as a literal example.";
  assert.equal(suppressMentions(text), text);
});

test("suppresses a real mention outside code while leaving a code span's mention untouched", () => {
  const text = "@maintainer see `@here` in the docs.";
  const result = suppressMentions(text);
  assert.equal(result, "@\u200Bmaintainer see `@here` in the docs.");
});

test("handles multiple mentions in one string", () => {
  const result = suppressMentions("@alice and @bob should both look");
  assert.equal(result, "@\u200Balice and @\u200Bbob should both look");
});

test("containsMention reports presence without mutating", () => {
  assert.equal(containsMention("@maintainer hi"), true);
  assert.equal(containsMention("no mentions here"), false);
  assert.equal(containsMention("foo@bar.com"), false);
});

test("handles empty/non-string input safely", () => {
  assert.equal(suppressMentions(""), "");
  assert.equal(suppressMentions(null), "");
  assert.equal(containsMention(""), false);
  assert.equal(containsMention(null), false);
});
