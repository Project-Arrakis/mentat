import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

const schemaDir = join(process.cwd(), "docs", "schemas", "upstream-write-adapter");
const fixtureDir = join(process.cwd(), "test", "fixtures", "write-adapter");
const sensitivePattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|steam(?:id)?[:\s_-]*[0-9]{12,}|funcom[:\s_-]*[A-Za-z0-9-]{6,}|token|password|authorization|secret)/i;

test("write adapter RFC schemas are valid JSON Schema documents", async () => {
  const schemas = await readJsonFiles(schemaDir);

  assert.deepEqual(Object.keys(schemas).sort(), [
    "write-capabilities.schema.json",
    "write-request.schema.json",
    "write-response.schema.json"
  ]);

  for (const [name, schema] of Object.entries(schemas)) {
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", name);
    assert.ok(schema.$id?.startsWith("https://"), name);
    assert.equal(schema.type, "object", name);
    assert.ok(Array.isArray(schema.required), name);
    assert.equal(schema.additionalProperties, false, name);
  }
});

test("write adapter RFC capabilities fixture advertises only separate write routes", async () => {
  const capabilities = await readJson(join(fixtureDir, "capabilities.json"));

  assert.equal(capabilities.contractVersion, "discord-write-adapter-v1");
  assert.equal(capabilities.service, "dune-console-discord-write-adapter");
  assert.equal(capabilities.readOnly, false);
  assert.equal(capabilities.writesEnabled, true);
  assert.deepEqual(capabilities.requiredActorFields, ["userId", "guildId", "channelId", "roleIds"]);
  assert.ok(capabilities.maxRequestBytes <= 8192);
  assert.ok(capabilities.rateLimit.maxRequests <= 5);
  assert.ok(capabilities.writeRoutes.every((route) => route.startsWith("/api/integrations/discord/write/")));

  const actions = new Map(capabilities.supportedActions.map((action) => [action.action, action]));
  assert.equal(actions.get("maintenance.note.set").risk, "low");
  assert.equal(actions.get("maintenance.note.set").tier, "write-admin");
  assert.equal(actions.get("maintenance.note.set").dryRunSupported, true);
  assert.equal(actions.get("maintenance.note.set").confirmationRequired, true);
  assert.equal(actions.get("maintenance.note.set").idempotencyRequired, true);
  assert.equal(actions.get("service.restart").risk, "high");
  assert.equal(actions.get("service.restart").disabledReason.length > 0, true);
});

test("write adapter RFC request fixtures use supported actions and minimal actor context", async () => {
  const capabilities = await readJson(join(fixtureDir, "capabilities.json"));
  const supportedActions = new Set(capabilities.supportedActions.map((action) => action.action));
  const requests = await readJsonFiles(join(fixtureDir, "requests"));

  assert.deepEqual(Object.keys(requests).sort(), [
    "execute-maintenance-note.json",
    "preview-maintenance-note.json"
  ]);

  for (const [name, request] of Object.entries(requests)) {
    assert.equal(request.contractVersion, capabilities.contractVersion, name);
    assert.equal(supportedActions.has(request.action), true, name);
    assert.match(request.clientRequestId, /^[a-zA-Z0-9._:-]{8,128}$/);
    assert.match(request.idempotencyKey, /^[a-zA-Z0-9._:-]{16,160}$/);
    assert.deepEqual(Object.keys(request.actor).sort(), ["channelId", "guildId", "roleIds", "userId"]);
    assert.equal(Array.isArray(request.actor.roleIds), true);
    assert.equal(Object.hasOwn(request.actor, "messageContent"), false);
    assert.equal(Object.hasOwn(request.actor, "token"), false);

    if (request.dryRun === false) {
      assert.ok(request.confirmation, `${name} execute request must include confirmation`);
      assert.match(request.confirmation.displayTextHash, /^sha256:[a-f0-9]{64}$/);
    }
  }
});

test("write adapter RFC response fixtures are bounded, redacted, and internally consistent", async () => {
  const capabilities = await readJson(join(fixtureDir, "capabilities.json"));
  const supportedActions = new Set(capabilities.supportedActions.map((action) => action.action));
  const responses = await readJsonFiles(join(fixtureDir, "responses"));

  assert.deepEqual(Object.keys(responses).sort(), [
    "confirmed-success.json",
    "denied.json",
    "dry-run-success.json",
    "redacted-failure.json",
    "timeout.json"
  ]);

  for (const [name, response] of Object.entries(responses)) {
    assert.equal(response.contractVersion, capabilities.contractVersion, name);
    assert.equal(supportedActions.has(response.action), true, name);
    assert.match(response.correlationId, /^corr-/);
    assert.match(response.auditId, /^audit-/);
    assert.equal(Array.isArray(response.sideEffectSummary), true, name);
    assert.equal(JSON.stringify(response).length < 5000, true, name);
    assert.equal(hasUnredactedSensitiveValue(response), false, name);

    if (response.ok) {
      assert.ok(response.result, `${name} success response should include result`);
      assert.ok(response.rollbackHint, `${name} success response should include rollback hint`);
      assert.equal(Object.hasOwn(response, "error"), false, name);
    } else {
      assert.ok(response.error, `${name} error response should include error`);
      assert.match(response.error.code, /^[a-z][a-z0-9_]*$/);
      assert.equal(typeof response.error.retryable, "boolean");
    }
  }
});

async function readJsonFiles(dir) {
  const entries = await readdir(dir);
  const files = {};
  for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
    files[entry] = await readJson(join(dir, entry));
  }
  return files;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function hasUnredactedSensitiveValue(value) {
  const text = JSON.stringify(value);
  const withoutAllowedRedactionLabels = text.replace(/\[REDACTED_[A-Z_]+\]/g, "");
  return sensitivePattern.test(withoutAllowedRedactionLabels);
}
