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
    message: "owner=operator@example.com Authorization: Bearer abc.def steam=76561198000000000 steamId=custom123 STEAM_1:0:12345 [U:1:12345] FuncomID=fc-123 token=shh",
    note: "serviceName=server-gateway"
  });

  assert.match(redacted.message, /\[REDACTED\]/);
  assert.doesNotMatch(redacted.message, /operator@example\.com/);
  assert.doesNotMatch(redacted.message, /abc\.def/);
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

// data:calculator (mentat Task 7) regression: the crafting calculator's
// shortfall structure is a real Map (craftingCalculator.js's own
// prototype-pollution-prevention citation, finding S-2). Before this fix,
// redactSecrets() silently turned any Map into `{}` (Object.entries() on a
// Map returns no own enumerable properties), destroying the whole structure
// before /dune data calculator's embed formatter ever saw it -- a real,
// reproduced production bug (see src/commands.js's executeCalculator()),
// not a hypothetical one.
test("redactSecrets preserves Map instances (and still redacts within them)", () => {
  const shortfall = new Map([["water", 33750], ["titanium_ore", 0]]);
  const redacted = redactSecrets({ plan: { shortfall } });

  assert.ok(redacted.plan.shortfall instanceof Map, "a Map value must stay a Map, not collapse to {}");
  assert.equal(redacted.plan.shortfall.get("water"), 33750);
  assert.equal(redacted.plan.shortfall.get("titanium_ore"), 0);
  assert.equal(redacted.plan.shortfall.size, 2);
});

test("redactSecrets redacts a credential-like key inside a Map", () => {
  const m = new Map([["token", "shh"], ["status", "ok"]]);
  const redacted = redactSecrets(m);

  assert.ok(redacted instanceof Map);
  assert.equal(redacted.get("token"), "[REDACTED]");
  assert.equal(redacted.get("status"), "ok");
});
