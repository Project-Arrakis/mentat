import assert from "node:assert/strict";
import { test } from "node:test";
import { formatError, formatPayload, redactSecrets } from "../src/format.js";

test("redactSecrets removes nested credential-like keys", () => {
  const redacted = redactSecrets({
    ok: true,
    token: "abc",
    nested: {
      apiKey: "def",
      status: "running"
    }
  });

  assert.deepEqual(redacted, {
    ok: true,
    token: "[REDACTED]",
    nested: {
      apiKey: "[REDACTED]",
      status: "running"
    }
  });
});

test("redactSecrets removes PII and game identity keys", () => {
  const redacted = redactSecrets({
    contactEmail: "operator@example.com",
    playerSteamId: "76561198000000000",
    funcomAccountId: "funcom-abc-123",
    profile: {
      firstName: "Jane",
      last_name: "Doe",
      fullName: "Jane Doe",
      realName: "Jane Q. Doe",
      serviceName: "server-gateway"
    }
  });

  assert.deepEqual(redacted, {
    contactEmail: "[REDACTED]",
    playerSteamId: "[REDACTED]",
    funcomAccountId: "[REDACTED]",
    profile: {
      firstName: "[REDACTED]",
      last_name: "[REDACTED]",
      fullName: "[REDACTED]",
      realName: "[REDACTED]",
      serviceName: "server-gateway"
    }
  });
});

test("redactSecrets removes sensitive values from free-text strings", () => {
  const redacted = redactSecrets({
    message: "owner=operator@example.com steam=76561198000000000 steamId=custom123 STEAM_1:0:12345 [U:1:12345] FuncomID=fc-123 token=shh",
    note: "serviceName=server-gateway"
  });

  assert.match(redacted.message, /\[REDACTED\]/);
  assert.doesNotMatch(redacted.message, /operator@example\.com/);
  assert.doesNotMatch(redacted.message, /76561198000000000/);
  assert.doesNotMatch(redacted.message, /custom123/);
  assert.doesNotMatch(redacted.message, /STEAM_1:0:12345/);
  assert.doesNotMatch(redacted.message, /\[U:1:12345\]/);
  assert.doesNotMatch(redacted.message, /fc-123/);
  assert.doesNotMatch(redacted.message, /shh/);
  assert.equal(redacted.note, "serviceName=server-gateway");
});

test("formatPayload keeps Discord output bounded and redacted", () => {
  const formatted = formatPayload("Dune status", {
    token: "secret",
    email: "operator@example.com",
    value: "x".repeat(3000)
  });

  assert.match(formatted, /\[REDACTED\]/);
  assert.doesNotMatch(formatted, /operator@example\.com/);
  assert.ok(formatted.length <= 2000);
  assert.match(formatted, /truncated/);
});

test("formatError includes status without leaking sensitive response fields", () => {
  const formatted = formatError({
    status: 401,
    message: "Unauthorized",
    body: { authorization: "Bearer secret", code: "unauthorized", steamId: "76561198000000000" }
  });

  assert.match(formatted, /HTTP 401/);
  assert.match(formatted, /\[REDACTED\]/);
  assert.doesNotMatch(formatted, /Bearer secret/);
  assert.doesNotMatch(formatted, /76561198000000000/);
});
