#!/usr/bin/env node
// ACP Issue Bridge — public repo: comment created -> private comment mirror
// (spec sections 32/33/34/57). Public -> private is automatic.

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

function blockquote(text) {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

export function renderMirroredCommentBody({ comment, syncId, config }) {
  const metadata = buildCommentMetadata({
    syncId,
    sourceRepository: config.repositories.public,
    sourceIssue: comment.issueNumber,
    sourceComment: comment.id,
    direction: "public-to-private"
  });
  return [
    "### Public Comment",
    "",
    `**Author:** \`@${comment.user.login}\`  `,
    `**Created:** \`${comment.created_at}\`  `,
    `**Public Comment:** ${comment.html_url}`,
    "",
    blockquote(comment.sanitizedBody),
    "",
    metadata
  ].join("\n");
}

export async function handlePublicCommentCreated({ config, client, event, expectedBotLogin, workflowRunId: runId = null, sink = console.log }) {
  const issue = event.issue;
  const comment = event.comment;
  const publicRepo = config.repositories.public;
  const privateRepo = config.repositories.private;

  if (issue.pull_request) return { action: "skipped", reason: "is-pull-request" };
  if (isBridgeActor(comment.user, expectedBotLogin)) {
    return { action: "skipped", reason: "bridge-authored" };
  }
  if (!config.sync.public_comment_create) {
    return { action: "skipped", reason: "sync-disabled-in-config" };
  }

  const syncId = computeSyncId(issue.number);
  const searchResults = await client.searchIssues(syncIdSearchQuery(privateRepo, syncId));
  const candidates = [];
  for (const item of searchResults.items || []) {
    const comments = await client.listComments(privateRepo, item.number);
    candidates.push({ number: item.number, body: item.body || "", comments: (comments || []).map((c) => c.body || "") });
  }
  const resolution = resolvePrivateMirror(candidates, syncId);

  if (resolution.status === "none") {
    emitAuditEvent(
      {
        event_type: AuditEventType.CORRELATION_ERROR,
        result: "blocked",
        reason: "no-private-mirror-found",
        source_repository: publicRepo,
        source_issue: issue.number,
        source_comment: comment.id,
        sync_id: syncId,
        workflow_run_id: runId
      },
      sink
    );
    return { action: "blocked", reason: "no-private-mirror-found" };
  }
  if (resolution.status === "ambiguous") {
    for (const num of resolution.matches) await client.addLabels(privateRepo, num, [config.labels.sync_error]);
    emitAuditEvent(
      {
        event_type: AuditEventType.CORRELATION_ERROR,
        result: "blocked",
        reason: "duplicate-private-mirror",
        source_repository: publicRepo,
        source_issue: issue.number,
        source_comment: comment.id,
        sync_id: syncId,
        workflow_run_id: runId
      },
      sink
    );
    return { action: "blocked", reason: "ambiguous-correlation", matches: resolution.matches };
  }

  const privateIssueNumber = resolution.matches[0];

  // Idempotency: has this exact public comment already been mirrored?
  const existingComments = candidates.find((c) => c.number === privateIssueNumber)?.comments || [];
  const alreadyMirrored = existingComments.some((body) => {
    const blocks = body.match(/source_comment: (\d+)/);
    return blocks && Number(blocks[1]) === comment.id;
  });
  if (alreadyMirrored) {
    emitAuditEvent(
      {
        event_type: AuditEventType.DUPLICATE_EVENT_IGNORED,
        result: "noop",
        source_repository: publicRepo,
        source_issue: issue.number,
        source_comment: comment.id,
        sync_id: syncId,
        destination_repository: privateRepo,
        destination_issue: privateIssueNumber,
        workflow_run_id: runId
      },
      sink
    );
    return { action: "noop", reason: "already-mirrored", privateIssue: privateIssueNumber };
  }

  const sanitizedBody = suppressMentions(
    sanitizeInboundContent(comment.body || "", { maxBytes: config.security.max_comment_bytes })
  );
  const body = renderMirroredCommentBody({
    config,
    syncId,
    comment: {
      id: comment.id,
      user: comment.user,
      created_at: comment.created_at,
      html_url: comment.html_url,
      issueNumber: issue.number,
      sanitizedBody
    }
  });

  await client.createComment(privateRepo, privateIssueNumber, body);

  emitAuditEvent(
    {
      event_type: AuditEventType.PUBLIC_COMMENT_MIRRORED,
      result: "success",
      source_repository: publicRepo,
      source_issue: issue.number,
      source_comment: comment.id,
      sync_id: syncId,
      destination_repository: privateRepo,
      destination_issue: privateIssueNumber,
      workflow_run_id: runId
    },
    sink
  );

  return { action: "mirrored", privateIssue: privateIssueNumber };
}

async function main() {
  const config = loadBridgeConfig();
  assertExpectedRepository(config.repositories.public, currentRepoSlug());
  const event = readEventPayload();
  const client = buildClient();
  const result = await handlePublicCommentCreated({
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
