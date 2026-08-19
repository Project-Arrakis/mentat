// ACP Issue Bridge — structured audit log (spec sections 64/65/66).
//
// Deliberately a strict allowlist of fields — there is no generic
// "message"/"details" passthrough field, specifically so a caller cannot
// accidentally audit-log a raw comment body (which could contain the very
// secret the bridge just blocked). If you need to log *why* something was
// blocked, log the `reason` (a short enum-like string) or `category` list
// from the secret scanner — never the content itself.

import { randomUUID } from "node:crypto";
import { validationError } from "./errors.mjs";

export const AuditEventType = Object.freeze({
  PUBLIC_ISSUE_MIRRORED: "PUBLIC_ISSUE_MIRRORED",
  PUBLIC_ISSUE_DUPLICATE_IGNORED: "PUBLIC_ISSUE_DUPLICATE_IGNORED",
  PUBLIC_ISSUE_UPDATED: "PUBLIC_ISSUE_UPDATED",
  PUBLIC_COMMENT_MIRRORED: "PUBLIC_COMMENT_MIRRORED",
  PUBLIC_ISSUE_CLOSED: "PUBLIC_ISSUE_CLOSED",
  PUBLIC_ISSUE_REOPENED: "PUBLIC_ISSUE_REOPENED",

  PRIVATE_PUBLICATION_REQUESTED: "PRIVATE_PUBLICATION_REQUESTED",
  PRIVATE_PUBLICATION_ALLOWED: "PRIVATE_PUBLICATION_ALLOWED",
  PRIVATE_PUBLICATION_BLOCKED: "PRIVATE_PUBLICATION_BLOCKED",
  PRIVATE_STATUS_PUBLISHED: "PRIVATE_STATUS_PUBLISHED",
  PRIVATE_RESOLUTION_PUBLISHED: "PRIVATE_RESOLUTION_PUBLISHED",

  SYNC_PAUSED: "SYNC_PAUSED",
  SYNC_RESUMED: "SYNC_RESUMED",
  SECURITY_MODE_ENABLED: "SECURITY_MODE_ENABLED",
  SECURITY_MODE_CLEARED: "SECURITY_MODE_CLEARED",

  UNAUTHORIZED_COMMAND: "UNAUTHORIZED_COMMAND",
  SECRET_DETECTED: "SECRET_DETECTED",
  DUPLICATE_EVENT_IGNORED: "DUPLICATE_EVENT_IGNORED",
  CORRELATION_ERROR: "CORRELATION_ERROR",
  GITHUB_API_ERROR: "GITHUB_API_ERROR"
});

const REQUIRED_FIELDS = ["event_type", "result"];
const ALLOWED_FIELDS = new Set([
  "timestamp",
  "event_id",
  "event_type",
  "actor",
  "source_repository",
  "source_issue",
  "source_comment",
  "destination_repository",
  "destination_issue",
  "sync_id",
  "command",
  "result",
  "reason",
  "workflow_run_id"
]);

/** Build one structured audit event. Throws VALIDATION error for an unknown event_type or missing required field. */
export function buildAuditEvent(fields) {
  if (!Object.values(AuditEventType).includes(fields.event_type)) {
    throw validationError(`unknown audit event_type: ${JSON.stringify(fields.event_type)}`);
  }
  for (const required of REQUIRED_FIELDS) {
    if (fields[required] === undefined || fields[required] === null) {
      throw validationError(`audit event missing required field "${required}"`);
    }
  }
  for (const key of Object.keys(fields)) {
    if (!ALLOWED_FIELDS.has(key)) {
      throw validationError(`audit event has a field outside the allowed schema: "${key}"`);
    }
  }

  return {
    timestamp: new Date().toISOString(),
    event_id: randomUUID(),
    actor: null,
    source_repository: null,
    source_issue: null,
    source_comment: null,
    destination_repository: null,
    destination_issue: null,
    sync_id: null,
    command: null,
    reason: null,
    workflow_run_id: process.env.GITHUB_RUN_ID || null,
    ...fields
  };
}

/** Emit an audit event as a single JSON line (structured GitHub Actions log, section 66). */
export function emitAuditEvent(fields, sink = console.log) {
  const event = buildAuditEvent(fields);
  sink(JSON.stringify(event));
  return event;
}
