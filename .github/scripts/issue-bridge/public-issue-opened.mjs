#!/usr/bin/env node
// ACP Issue Bridge — public repo: issue opened -> private mirror
// (spec sections 8/9/56). Public -> private is automatic.

import { fileURLToPath } from "node:url";
import { AuditEventType, emitAuditEvent } from "./lib/audit.mjs";
import { isBridgeActor } from "./lib/loopProtection.mjs";
import { computeSyncId } from "./lib/syncId.mjs";
import { buildCommentMetadata, buildIssueMetadata } from "./lib/metadata.mjs";
import { sanitizeInboundContent } from "./lib/sanitize.mjs";
import { suppressMentions } from "./lib/mentions.mjs";
import { defaultPrivateMirrorLabels, translateAllowlistedLabels } from "./lib/labelMap.mjs";
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

export function renderPrivateMirrorBody({ config, issue, syncId, sanitizedBody, createdFromEvent }) {
  const metadata = buildIssueMetadata({
    syncId,
    publicRepository: config.repositories.public,
    publicIssue: issue.number,
    createdFromEvent
  });

  return [
    `# [PUBLIC #${issue.number}] ${issue.title}`,
    "",
    "## Public Issue",
    "",
    `**Repository:** \`${config.repositories.public}\`  `,
    `**Issue:** \`#${issue.number}\`  `,
    `**Reporter:** \`@${issue.user.login}\`  `,
    `**Created:** \`${issue.created_at}\`  `,
    `**Sync ID:** \`${syncId}\``,
    "",
    `**Public Issue:** ${issue.html_url}`,
    "",
    "---",
    "",
    "## Original Report",
    "",
    sanitizedBody,
    "",
    "---",
    "",
    "## Engineering Notes",
    "",
    "Internal engineering information belongs below this section or in comments.",
    "",
    "---",
    "",
    "## ACP Issue Bridge Metadata",
    "",
    metadata
  ].join("\n");
}

/**
 * @param {object} deps
 * @param {object} deps.config - loaded bridge config
 * @param {object} deps.client - GitHubClient (or compatible fake)
 * @param {object} deps.event - the `issues` webhook payload
 * @param {string} deps.expectedBotLogin
 * @param {string|null} [deps.workflowRunId]
 * @param {(line:string)=>void} [deps.sink]
 */
export async function handlePublicIssueOpened({ config, client, event, expectedBotLogin, workflowRunId: runId = null, sink = console.log }) {
  const issue = event.issue;
  const publicRepo = config.repositories.public;
  const privateRepo = config.repositories.private;

  if (issue.pull_request) {
    return { action: "skipped", reason: "is-pull-request" };
  }
  if (isBridgeActor(issue.user, expectedBotLogin)) {
    return { action: "skipped", reason: "bridge-authored" };
  }
  if (!config.sync.public_issue_create) {
    return { action: "skipped", reason: "sync-disabled-in-config" };
  }

  const syncId = computeSyncId(issue.number);

  const searchResults = await client.searchIssues(syncIdSearchQuery(privateRepo, syncId));
  const candidates = [];
  for (const item of searchResults.items || []) {
    const comments = await client.listComments(privateRepo, item.number);
    candidates.push({
      number: item.number,
      body: item.body || "",
      comments: (comments || []).map((c) => c.body || "")
    });
  }
  const resolution = resolvePrivateMirror(candidates, syncId);

  if (resolution.status === "ambiguous") {
    for (const num of resolution.matches) {
      await client.addLabels(privateRepo, num, [config.labels.sync_error]);
    }
    emitAuditEvent(
      {
        event_type: AuditEventType.CORRELATION_ERROR,
        result: "blocked",
        reason: "duplicate-private-mirror",
        source_repository: publicRepo,
        source_issue: issue.number,
        sync_id: syncId,
        destination_repository: privateRepo,
        workflow_run_id: runId
      },
      sink
    );
    return { action: "blocked", reason: "ambiguous-correlation", matches: resolution.matches };
  }

  if (resolution.status === "single") {
    emitAuditEvent(
      {
        event_type: AuditEventType.PUBLIC_ISSUE_DUPLICATE_IGNORED,
        result: "noop",
        source_repository: publicRepo,
        source_issue: issue.number,
        sync_id: syncId,
        destination_repository: privateRepo,
        destination_issue: resolution.matches[0],
        workflow_run_id: runId
      },
      sink
    );
    return { action: "noop", reason: "mirror-already-exists", privateIssue: resolution.matches[0] };
  }

  const sanitizedBody = suppressMentions(
    sanitizeInboundContent(issue.body || "", { maxBytes: config.security.max_body_bytes })
  );
  const createdFromEvent = `issues.opened:${runId || "local"}`;
  const body = renderPrivateMirrorBody({ config, issue, syncId, sanitizedBody, createdFromEvent });

  const publicLabelNames = (issue.labels || []).map((l) => (typeof l === "string" ? l : l.name));
  const labels = [...defaultPrivateMirrorLabels(config), ...translateAllowlistedLabels(config, publicLabelNames)];

  const created = await client.createIssue(privateRepo, {
    title: `[PUBLIC #${issue.number}] ${issue.title}`,
    body,
    labels
  });

  const commentMetadata = buildCommentMetadata({
    syncId,
    sourceRepository: publicRepo,
    sourceIssue: issue.number,
    sourceComment: null,
    direction: "public-to-private"
  });
  await client.createComment(
    privateRepo,
    created.number,
    `### Synchronization Established\n\nSync ID: \`${syncId}\`\n\n${commentMetadata}`
  );

  emitAuditEvent(
    {
      event_type: AuditEventType.PUBLIC_ISSUE_MIRRORED,
      result: "success",
      source_repository: publicRepo,
      source_issue: issue.number,
      sync_id: syncId,
      destination_repository: privateRepo,
      destination_issue: created.number,
      workflow_run_id: runId
    },
    sink
  );

  return { action: "created", privateIssue: created.number, syncId };
}

async function main() {
  const config = loadBridgeConfig();
  assertExpectedRepository(config.repositories.public, currentRepoSlug());
  const event = readEventPayload();
  const client = buildClient();
  const result = await handlePublicIssueOpened({
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
