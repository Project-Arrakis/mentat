import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCommand } from "./commandParser.mjs";

const TOKENS = {
  internal: "/internal",
  public: "/public",
  public_status: "/public-status",
  resolution: "/public-resolution",
  security: "/security",
  security_clear: "/security-clear",
  pause: "/sync-pause",
  resume: "/sync-resume"
};

test("SEC-002: recognizes /internal and returns the remaining body", () => {
  const result = parseCommand("/internal\nRoot cause is in auth/session_manager.py.", TOKENS);
  assert.equal(result.command, "internal");
  assert.equal(result.body, "Root cause is in auth/session_manager.py.");
});

test("SEC-001/SEC-019: a plain comment with no command is null (no public action)", () => {
  const result = parseCommand("Root cause is in auth/session_manager.py.", TOKENS);
  assert.equal(result.command, null);
  assert.equal(result.body, "Root cause is in auth/session_manager.py.");
});

test("SEC-003: recognizes /public and captures the body", () => {
  const result = parseCommand(
    "/public\nWe reproduced the issue and are testing a remediation.",
    TOKENS
  );
  assert.equal(result.command, "public");
  assert.equal(result.body, "We reproduced the issue and are testing a remediation.");
});

test("recognizes /public-status with a valid state argument", () => {
  const result = parseCommand("/public-status confirmed", TOKENS);
  assert.equal(result.command, "public_status");
  assert.equal(result.argument, "confirmed");
  assert.equal(result.argumentValid, true);
});

test("does not allow arbitrary /public-status states (section 21)", () => {
  const result = parseCommand("/public-status made-up-state", TOKENS);
  assert.equal(result.command, "public_status");
  assert.equal(result.argumentValid, false);
});

test("does not confuse /public-status with bare /public (prefix collision)", () => {
  const asStatus = parseCommand("/public-status testing", TOKENS);
  assert.equal(asStatus.command, "public_status");
  const asPublic = parseCommand("/public\nsomething", TOKENS);
  assert.equal(asPublic.command, "public");
});

test("does not confuse /public-resolution with bare /public", () => {
  const result = parseCommand("/public-resolution\nFixed in v1.5.1.", TOKENS);
  assert.equal(result.command, "resolution");
});

test("/public-status body (if any) is captured separately and never becomes the public message", () => {
  const result = parseCommand("/public-status blocked\nBlocked on the vendor's API rate limit.", TOKENS);
  assert.equal(result.argument, "blocked");
  // The caller (statusTemplates) must use ONLY the fixed template for
  // "blocked", never `result.body` — this test documents that the parser
  // itself does still expose body (for internal audit/logging use), and a
  // separate integration test asserts the orchestration layer never passes
  // it to the public template.
  assert.equal(result.body, "Blocked on the vendor's API rate limit.");
});

test("recognizes bare commands: /security, /security-clear, /sync-pause, /sync-resume", () => {
  assert.equal(parseCommand("/security\nPossible leak.", TOKENS).command, "security");
  assert.equal(parseCommand("/security-clear", TOKENS).command, "security_clear");
  assert.equal(parseCommand("/sync-pause", TOKENS).command, "pause");
  assert.equal(parseCommand("/sync-resume", TOKENS).command, "resume");
});

test("allows optional leading whitespace before the command", () => {
  const result = parseCommand("   \n  /public\nHello", TOKENS);
  assert.equal(result.command, "public");
  assert.equal(result.body, "Hello");
});

test("does not execute a command quoted with '>' (section 17)", () => {
  const result = parseCommand("> /public\nquoting someone else, not my own instruction", TOKENS);
  assert.equal(result.command, null);
});

test("does not execute a command wrapped in a fenced code block (section 17)", () => {
  const result = parseCommand("```\n/public\n```", TOKENS);
  assert.equal(result.command, null);
});

test("reports an unrecognized slash-command distinctly from an ordinary comment", () => {
  const result = parseCommand("/frobnicate this", TOKENS);
  assert.equal(result.command, "unrecognized");
});

test("/public-status with a missing argument is unrecognized, not silently accepted", () => {
  const result = parseCommand("/public-status", TOKENS);
  assert.equal(result.command, "unrecognized");
});

test("handles non-string input safely", () => {
  const result = parseCommand(undefined, TOKENS);
  assert.equal(result.command, null);
});
