import assert from "node:assert/strict";
import { test } from "node:test";
import { logError, logInfo } from "../src/logger.js";

test("logInfo emits structured redacted JSON", () => {
  const lines = [];
  logInfo("security.test", {
    token: "secret-token",
    contactEmail: "operator@example.com",
    nested: {
      authorization: "Bearer secret"
    }
  }, (line) => lines.push(line));

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, "info");
  assert.equal(entry.event, "security.test");
  assert.equal(entry.fields.token, "[REDACTED]");
  assert.equal(entry.fields.contactEmail, "[REDACTED]");
  assert.equal(entry.fields.nested.authorization, "[REDACTED]");
  assert.doesNotMatch(lines[0], /secret-token|operator@example\.com|Bearer secret/);
});

test("logError emits bounded error details without bodies", () => {
  const lines = [];
  const error = new Error("Authorization: Bearer abc.def");
  error.status = 503;
  error.route = "status";
  error.body = { token: "response-token" };

  logError("discord.interaction_failed", error, {
    discordToken: "discord-secret"
  }, (line) => lines.push(line));

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.level, "error");
  assert.equal(entry.event, "discord.interaction_failed");
  assert.equal(entry.fields.discordToken, "[REDACTED]");
  assert.equal(entry.fields.error.name, "Error");
  assert.equal(entry.fields.error.status, 503);
  assert.equal(entry.fields.error.route, "status");
  assert.match(entry.fields.error.message, /\[REDACTED\]/);
  assert.equal("body" in entry.fields.error, false);
  assert.doesNotMatch(lines[0], /abc\.def|response-token|discord-secret/);
});
