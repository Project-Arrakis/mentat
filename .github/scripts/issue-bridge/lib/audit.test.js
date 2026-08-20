import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditEventType, buildAuditEvent, emitAuditEvent } from "./audit.mjs";

test("builds a well-formed audit event with defaults for omitted optional fields", () => {
  const event = buildAuditEvent({
    event_type: AuditEventType.PUBLIC_ISSUE_MIRRORED,
    result: "success",
    source_repository: "yacketrj/acp-discordbot",
    source_issue: 52,
    destination_repository: "yacketrj/arrakis-control-panel",
    destination_issue: 300,
    sync_id: "ACP-PUBLIC-52"
  });
  assert.equal(event.event_type, "PUBLIC_ISSUE_MIRRORED");
  assert.equal(event.result, "success");
  assert.equal(typeof event.event_id, "string");
  assert.equal(typeof event.timestamp, "string");
  assert.equal(event.actor, null);
});

test("rejects an unknown event_type", () => {
  assert.throws(() => buildAuditEvent({ event_type: "NOT_A_REAL_TYPE", result: "success" }));
});

test("rejects a missing required field", () => {
  assert.throws(() => buildAuditEvent({ event_type: "SYNC_PAUSED" }));
});

test("rejects any field outside the documented schema (no accidental sensitive passthrough field)", () => {
  assert.throws(() =>
    buildAuditEvent({ event_type: "SYNC_PAUSED", result: "success", message: "raw comment body here" })
  );
});

test("each event gets a unique event_id", () => {
  const a = buildAuditEvent({ event_type: "SYNC_PAUSED", result: "success" });
  const b = buildAuditEvent({ event_type: "SYNC_PAUSED", result: "success" });
  assert.notEqual(a.event_id, b.event_id);
});

test("emitAuditEvent writes a single JSON line to the provided sink", () => {
  const lines = [];
  const event = emitAuditEvent(
    { event_type: "SECRET_DETECTED", result: "blocked", reason: "github-pat" },
    (line) => lines.push(line)
  );
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), event);
  assert.equal(lines[0].includes("ghp_"), false);
});

test("every AuditEventType listed in spec section 65 is present", () => {
  const required = [
    "PUBLIC_ISSUE_MIRRORED",
    "PUBLIC_ISSUE_DUPLICATE_IGNORED",
    "PUBLIC_ISSUE_UPDATED",
    "PUBLIC_COMMENT_MIRRORED",
    "PUBLIC_ISSUE_CLOSED",
    "PUBLIC_ISSUE_REOPENED",
    "PRIVATE_PUBLICATION_REQUESTED",
    "PRIVATE_PUBLICATION_ALLOWED",
    "PRIVATE_PUBLICATION_BLOCKED",
    "PRIVATE_STATUS_PUBLISHED",
    "PRIVATE_RESOLUTION_PUBLISHED",
    "SYNC_PAUSED",
    "SYNC_RESUMED",
    "SECURITY_MODE_ENABLED",
    "SECURITY_MODE_CLEARED",
    "UNAUTHORIZED_COMMAND",
    "SECRET_DETECTED",
    "DUPLICATE_EVENT_IGNORED",
    "CORRELATION_ERROR",
    "GITHUB_API_ERROR"
  ];
  for (const name of required) {
    assert.equal(AuditEventType[name], name);
  }
});
