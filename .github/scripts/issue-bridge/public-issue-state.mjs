#!/usr/bin/env node
// ACP Issue Bridge — public repo: issue edited/closed/reopened
// (spec sections 36/37/38/58). Public -> private is automatic. Never
// rewrites the private issue body (would risk overwriting engineering
// notes) — always appends a synchronization comment instead.

import { fileURLToPath } from "node:url";
import { AuditEventType, emitAuditEvent } from "./lib/audit.mjs";
import { isBridgeActor } from "./lib/loopProtection.mjs";
import { computeSyncId } from "./lib/syncId.mjs";
import { buildCommentMetadata } from "./lib/metadata.mjs";
import { sanitizeInboundContent } from "./lib/sanitize.mjs";
import { suppressMentions } from "./lib/mentions.mjs";
import { resolvePrivateMirror } from "./lib/correlation.mjs";
import { syncIdSearchQuery } from "./lib/queries.mjs";
import {
  assertExpectedRepository,
  botLogin,
  buildClient,
  currentRepoSlug,
  loadBridgeConfig,
  readEventPayload,
  workflowRunId
} from "./runtime.mjs";

const SYNC_GATE_BY_ACTION = {
  edited: "public_issue_edit",
  closed: "public_close",
  reopened: "public_reopen"
};

async function resolveMirror({ client, config, issueNumber, sink, runId, action }) {
  const privateRepo = config.repositories.private;
  const publicRepo = config.repositories.public;
  const syncId = computeSyncId(issueNumber);
  const searchResults = await client.searchIssues(syncIdSearchQuery(privateRepo, syncId));
  const candidates = [];
  for (const item of searchResults.items || []) {
    const comments = await client.listComments(privateRepo, item.number);
    candidates.push({ number: item.number, body: item.body || "", comments: (comments || []).map((c) => c.body || "") });
  }
  const resolution = resolvePrivateMirror(candidates, syncId);

  if (resolution.status === "none") {
    emitAuditEvent(
      { event_type: AuditEventType.CORRELATION_ERROR, result: "blocked", reason: "no-private-mirror-found", source_repository: publicRepo, source_issue: issueNumber, sync_id: syncId, command: action, workflow_run_id: runId },
      sink
    );
    return { blocked: true, reason: "no-private-mirror-found" };
  }
  if (resolution.status === "ambiguous") {
    for (const num of resolution.matches) await client.addLabels(privateRepo, num, [config.labels.sync_error]);
    emitAuditEvent(
      { event_type: AuditEventType.CORRELATION_ERROR, result: "blocked", reason: "duplicate-private-mirror", source_repository: publicRepo, source_issue: issueNumber, sync_id: syncId, command: action, workflow_run_id: runId },
      sink
    );
    return { blocked: true, reason: "ambiguous-correlation", matches: resolution.matches };
  }
  return { blocked: false, privateIssue: resolution.matches[0], syncId };
}

export async function handlePublicIssueState({ config, client, event, expectedBotLogin, workflowRunId: runId = null, sink = console.log }) {
  const issue = event.issue;
  const action = event.action; // "edited" | "closed" | "reopened"
  const publicRepo = config.repositories.public;
  const privateRepo = config.repositories.private;

  if (issue.pull_request) return { action: "skipped", reason: "is-pull-request" };
  if (isBridgeActor(event.sender, expectedBotLogin)) return { action: "skipped", reason: "bridge-authored" };

  const gateKey = SYNC_GATE_BY_ACTION[action];
  if (!gateKey) return { action: "skipped", reason: `unsupported-action:${action}` };
  if (!config.sync[gateKey]) return { action: "skipped", reason: "sync-disabled-in-config" };

  const resolved = await resolveMirror({ client, config, issueNumber: issue.number, sink, runId, action });
  if (resolved.blocked) return { action: "blocked", reason: resolved.reason, matches: resolved.matches };

  const privateIssueNumber = resolved.privateIssue;
  const actorLogin = event.sender && event.sender.login;
  const metadata = buildCommentMetadata({
    syncId: resolved.syncId,
    sourceRepository: publicRepo,
    sourceIssue: issue.number,
    sourceComment: null,
    direction: "public-to-private"
  });

  let commentBody;
  let auditType;

  if (action === "edited") {
    const sanitizedBody = suppressMentions(
      sanitizeInboundContent(issue.body || "", { maxBytes: config.security.max_body_bytes })
    );
    commentBody = [
      "### Public Issue Updated",
      "",
      `The public issue description was edited by \`@${actorLogin}\`.`,
      "",
      sanitizedBody,
      "",
      metadata
    ].join("\n");
    auditType = AuditEventType.PUBLIC_ISSUE_UPDATED;
  } else if (action === "closed") {
    await client.addLabels(privateRepo, privateIssueNumber, [config.labels.public_closed]);
    commentBody = [
      "### Public Issue Closed",
      "",
      `The public issue was closed by \`@${actorLogin}\`.`,
      "",
      "Engineering work has not been automatically closed.",
      "",
      metadata
    ].join("\n");
    auditType = AuditEventType.PUBLIC_ISSUE_CLOSED;
  } else {
    await client.removeLabel(privateRepo, privateIssueNumber, config.labels.public_closed);
    commentBody = [
      "### Public Issue Reopened",
      "",
      `The public issue was reopened by \`@${actorLogin}\`.`,
      "",
      metadata
    ].join("\n");
    auditType = AuditEventType.PUBLIC_ISSUE_REOPENED;
  }

  await client.createComment(privateRepo, privateIssueNumber, commentBody);

  emitAuditEvent(
    {
      event_type: auditType,
      result: "success",
      source_repository: publicRepo,
      source_issue: issue.number,
      sync_id: resolved.syncId,
      destination_repository: privateRepo,
      destination_issue: privateIssueNumber,
      command: action,
      workflow_run_id: runId
    },
    sink
  );

  return { action: "synced", privateIssue: privateIssueNumber, event: action };
}

async function main() {
  const config = loadBridgeConfig();
  assertExpectedRepository(config.repositories.public, currentRepoSlug());
  const event = readEventPayload();
  const client = buildClient();
  const result = await handlePublicIssueState({
    config,
    client,
    event,
    expectedBotLogin: botLogin(),
    workflowRunId: workflowRunId()
  });
  console.log(JSON.stringify(result));
  if (result.action === "blocked") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.name === "BridgeError" ? `${err.errorClass}: ${err.message}` : err);
    process.exit(1);
  });
}
