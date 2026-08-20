#!/usr/bin/env node
// ACP Issue Bridge — public repo: label added/removed -> private label sync
// (spec sections 15/59). Only allowlisted labels are processed; everything
// else is silently ignored (not an error — most labels a maintainer applies
// on the public repo, e.g. GitHub's default `bug`/`enhancement`, simply
// aren't part of the bridge's cross-repo taxonomy).

import { fileURLToPath } from "node:url";
import { AuditEventType, emitAuditEvent } from "./lib/audit.mjs";
import { computeSyncId } from "./lib/syncId.mjs";
import { mapPublicLabelToPrivate, isForbiddenPublicLabel } from "./lib/labelMap.mjs";
import { resolvePrivateMirror } from "./lib/correlation.mjs";
import { syncIdSearchQuery } from "./lib/queries.mjs";
import {
  assertExpectedRepository,
  buildClient,
  currentRepoSlug,
  loadBridgeConfig,
  readEventPayload,
  workflowRunId
} from "./runtime.mjs";

export async function handlePublicLabelSync({ config, client, event, workflowRunId: runId = null, sink = console.log }) {
  const issue = event.issue;
  const label = event.label;
  const action = event.action; // "labeled" | "unlabeled"
  const publicRepo = config.repositories.public;
  const privateRepo = config.repositories.private;

  if (issue.pull_request) return { action: "skipped", reason: "is-pull-request" };
  if (!config.sync.public_labels) return { action: "skipped", reason: "sync-disabled-in-config" };

  const mapped = mapPublicLabelToPrivate(config, label.name);
  if (!mapped || isForbiddenPublicLabel(config, mapped)) {
    return { action: "ignored", reason: "not-allowlisted", label: label.name };
  }

  const syncId = computeSyncId(issue.number);
  const searchResults = await client.searchIssues(syncIdSearchQuery(privateRepo, syncId));
  const candidates = [];
  for (const item of searchResults.items || []) {
    const comments = await client.listComments(privateRepo, item.number);
    candidates.push({ number: item.number, body: item.body || "", comments: (comments || []).map((c) => c.body || "") });
  }
  const resolution = resolvePrivateMirror(candidates, syncId);

  if (resolution.status !== "single") {
    emitAuditEvent(
      {
        event_type: AuditEventType.CORRELATION_ERROR,
        result: "blocked",
        reason: resolution.status === "none" ? "no-private-mirror-found" : "duplicate-private-mirror",
        source_repository: publicRepo,
        source_issue: issue.number,
        sync_id: syncId,
        command: `label:${action}`,
        workflow_run_id: runId
      },
      sink
    );
    return { action: "blocked", reason: resolution.status === "none" ? "no-private-mirror-found" : "ambiguous-correlation" };
  }

  const privateIssueNumber = resolution.matches[0];
  if (action === "labeled") {
    await client.addLabels(privateRepo, privateIssueNumber, [mapped]);
  } else {
    await client.removeLabel(privateRepo, privateIssueNumber, mapped);
  }

  return { action: "synced", privateIssue: privateIssueNumber, label: mapped, labelAction: action };
}

async function main() {
  const config = loadBridgeConfig();
  assertExpectedRepository(config.repositories.public, currentRepoSlug());
  const event = readEventPayload();
  const client = buildClient();
  const result = await handlePublicLabelSync({ config, client, event, workflowRunId: workflowRunId() });
  console.log(JSON.stringify(result));
  if (result.action === "blocked") process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.name === "BridgeError" ? `${err.errorClass}: ${err.message}` : err);
    process.exit(1);
  });
}
