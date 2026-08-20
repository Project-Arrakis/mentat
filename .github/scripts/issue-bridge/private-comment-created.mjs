#!/usr/bin/env node
// ACP Issue Bridge — private repo: comment command processor
// (spec sections 16-31/60). This is the ONLY path by which private ->
// public publication can ever happen, and every branch here defaults to
// "do nothing publicly" unless every precondition is explicitly satisfied.

import { fileURLToPath } from "node:url";
import { AuditEventType, emitAuditEvent } from "./lib/audit.mjs";
import { isBridgeActor } from "./lib/loopProtection.mjs";
import { extractSingleIssueMetadata, extractMetadataBlocks, buildBridgePublicationMetadata } from "./lib/metadata.mjs";
import { parseCommand } from "./lib/commandParser.mjs";
import { checkCommandAuthorization } from "./lib/auth.mjs";
import { scanForSensitiveContent } from "./lib/secretScan.mjs";
import { suppressMentions } from "./lib/mentions.mjs";
import {
  applySecurityClear,
  applySecurityCommand,
  applySyncPause,
  applySyncResume,
  canPublishOutbound
} from "./lib/securityState.mjs";
import {
  renderBlockedPublicationMessage,
  renderPublicUpdateMessage,
  renderResolutionMessage,
  renderStatusMessage
} from "./lib/statusTemplates.mjs";
import { correlationError, validationError } from "./lib/errors.mjs";
import {
  assertExpectedRepository,
  botLogin,
  buildClient,
  currentRepoSlug,
  loadBridgeConfig,
  readEventPayload,
  workflowRunId
} from "./runtime.mjs";

function internalAck(config, lines, { syncId, privateIssue } = {}) {
  const metadata = buildBridgePublicationMetadata({
    syncId,
    privateRepository: config.repositories.private,
    privateIssue,
    kind: "internal-ack"
  });
  return `### ACP Issue Bridge\n\n${lines.join("\n")}\n\n${metadata}`;
}

async function applyLabelDelta(client, repo, issueNumber, { add = [], remove = [] }) {
  if (add.length > 0) await client.addLabels(repo, issueNumber, add);
  for (const label of remove) await client.removeLabel(repo, issueNumber, label);
}

async function removeStatusLabels(client, repo, issueNumber, currentLabelNames, allStatusLabelValues) {
  for (const name of currentLabelNames) {
    if (allStatusLabelValues.has(name)) {
      await client.removeLabel(repo, issueNumber, name);
    }
  }
}

/**
 * Idempotency guard for outbound publication (section 43): before publishing
 * anything to the public issue, check whether a prior bridge comment already
 * recorded this exact (kind, source private comment id) pair — e.g. from a
 * redelivered webhook or a re-run workflow — and if so, skip republishing.
 */
async function alreadyPublished(client, publicRepo, publicIssueNumber, kind, sourceCommentId) {
  const comments = await client.listComments(publicRepo, publicIssueNumber);
  return (comments || []).some((c) =>
    extractMetadataBlocks(c.body || "").some(
      (meta) => meta.origin === "bridge" && meta.kind === kind && Number(meta.source_comment) === sourceCommentId
    )
  );
}

export async function handlePrivateCommentCreated({ config, client, event, expectedBotLogin, workflowRunId: runId = null, sink = console.log }) {
  const issue = event.issue;
  const comment = event.comment;
  const privateRepo = config.repositories.private;
  const publicRepo = config.repositories.public;

  if (isBridgeActor(comment.user, expectedBotLogin)) {
    return { action: "skipped", reason: "bridge-authored" };
  }

  const meta = extractSingleIssueMetadata(issue.body || "");
  if (!meta || meta.public_repository !== publicRepo) {
    return { action: "skipped", reason: "not-bridge-correlated" };
  }
  const publicIssueNumber = Number(meta.public_issue);
  const syncId = meta.sync_id;
  if (!Number.isInteger(publicIssueNumber) || publicIssueNumber <= 0) {
    throw correlationError("private issue metadata has an invalid public_issue value", { privateIssue: issue.number });
  }

  const parsed = parseCommand(comment.body, config.commands);
  const actorLogin = comment.user.login;
  const ack = (lines) => internalAck(config, lines, { syncId, privateIssue: issue.number });

  if (parsed.command === null) {
    return { action: "noop", reason: "no-command" };
  }
  if (parsed.command === "unrecognized") {
    return { action: "noop", reason: "unrecognized-command" };
  }
  if (parsed.command === "internal") {
    return { action: "noop", reason: "internal" };
  }

  const actorRole = await client.getUserRole(privateRepo, actorLogin);
  const authz = checkCommandAuthorization(config, parsed.command, actorRole);
  if (!authz.authorized) {
    emitAuditEvent(
      {
        event_type: AuditEventType.UNAUTHORIZED_COMMAND,
        result: "blocked",
        actor: actorLogin,
        source_repository: privateRepo,
        source_issue: issue.number, source_comment: comment.id,
        sync_id: syncId,
        command: parsed.command,
        reason: `requires ${authz.requiredLevel}, actor has ${actorRole}`,
        workflow_run_id: runId
      },
      sink
    );
    await client.createComment(
      privateRepo,
      issue.number,
      ack([
        `\`${comment.body.split("\n")[0]}\` requires **${authz.requiredLevel}** permission or higher.`,
        "No action was taken."
      ])
    );
    return { action: "blocked", reason: "unauthorized", requiredLevel: authz.requiredLevel };
  }

  const currentPrivateLabels = new Set((issue.labels || []).map((l) => (typeof l === "string" ? l : l.name)));

  // --- Security state mutation commands (never publish anything) ---

  if (parsed.command === "security") {
    const delta = applySecurityCommand(config);
    await applyLabelDelta(client, privateRepo, issue.number, delta);
    emitAuditEvent(
      { event_type: AuditEventType.SECURITY_MODE_ENABLED, result: "success", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, sync_id: syncId, command: "security", workflow_run_id: runId },
      sink
    );
    await client.createComment(
      privateRepo,
      issue.number,
      ack([
        "Security-sensitive mode has been enabled and outbound synchronization has been paused.",
        "Nothing was published publicly.",
        "",
        "Recovery requires two separate steps: `/security-clear` (admin) followed by `/sync-resume`."
      ])
    );
    return { action: "security-enabled" };
  }

  if (parsed.command === "security_clear") {
    const delta = applySecurityClear(config);
    await applyLabelDelta(client, privateRepo, issue.number, delta);
    emitAuditEvent(
      { event_type: AuditEventType.SECURITY_MODE_CLEARED, result: "success", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, sync_id: syncId, command: "security_clear", workflow_run_id: runId },
      sink
    );
    await client.createComment(
      privateRepo,
      issue.number,
      ack([
        `Security-sensitive state cleared by \`@${actorLogin}\`.`,
        "Synchronization remains **paused**. A separate `/sync-resume` is required to restore it."
      ])
    );
    return { action: "security-cleared" };
  }

  if (parsed.command === "pause") {
    const delta = applySyncPause(config);
    await applyLabelDelta(client, privateRepo, issue.number, delta);
    emitAuditEvent(
      { event_type: AuditEventType.SYNC_PAUSED, result: "success", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, sync_id: syncId, command: "sync_pause", workflow_run_id: runId },
      sink
    );
    await client.createComment(privateRepo, issue.number, ack(["Outbound synchronization paused."]));
    return { action: "sync-paused" };
  }

  if (parsed.command === "resume") {
    const result = applySyncResume(currentPrivateLabels, config);
    if (!result.allowed) {
      emitAuditEvent(
        { event_type: AuditEventType.SYNC_RESUMED, result: "blocked", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, sync_id: syncId, command: "sync_resume", reason: result.reason, workflow_run_id: runId },
        sink
      );
      await client.createComment(
        privateRepo,
        issue.number,
        ack(["`/sync-resume` was blocked: security-sensitive state is still set.", "Run `/security-clear` (admin) first."])
      );
      return { action: "blocked", reason: result.reason };
    }
    await applyLabelDelta(client, privateRepo, issue.number, result);
    emitAuditEvent(
      { event_type: AuditEventType.SYNC_RESUMED, result: "success", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, sync_id: syncId, command: "sync_resume", workflow_run_id: runId },
      sink
    );
    await client.createComment(privateRepo, issue.number, ack(["Synchronization resumed."]));
    return { action: "sync-resumed" };
  }

  // --- Outbound publication commands (public/public_status/resolution) ---

  emitAuditEvent(
    { event_type: AuditEventType.PRIVATE_PUBLICATION_REQUESTED, result: "pending", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: parsed.command, workflow_run_id: runId },
    sink
  );

  const gate = canPublishOutbound(currentPrivateLabels, config);
  if (!gate.allowed) {
    emitAuditEvent(
      { event_type: AuditEventType.PRIVATE_PUBLICATION_BLOCKED, result: "blocked", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: parsed.command, reason: gate.reason, workflow_run_id: runId },
      sink
    );
    await client.createComment(privateRepo, issue.number, ack([`Publication blocked: \`${gate.reason}\`.`, "No content was published."]));
    return { action: "blocked", reason: gate.reason };
  }

  if (parsed.command === "public_status") {
    if (await alreadyPublished(client, publicRepo, publicIssueNumber, `public-status:${parsed.argument}`, comment.id)) {
      emitAuditEvent(
        { event_type: AuditEventType.DUPLICATE_EVENT_IGNORED, result: "noop", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: "public_status", workflow_run_id: runId },
        sink
      );
      return { action: "noop", reason: "already-published" };
    }
    if (!parsed.argumentValid) {
      emitAuditEvent(
        { event_type: AuditEventType.PRIVATE_PUBLICATION_BLOCKED, result: "blocked", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, sync_id: syncId, command: "public_status", reason: "invalid-state", workflow_run_id: runId },
        sink
      );
      await client.createComment(
        privateRepo,
        issue.number,
        ack([`\`${parsed.argument}\` is not a supported status. Allowed: ${Object.keys(config.status_labels).join(", ")}.`])
      );
      return { action: "blocked", reason: "invalid-state" };
    }

    const publicIssue = await client.getIssue(publicRepo, publicIssueNumber);
    const publicStatusNames = new Set(Object.values(config.status_labels));
    const publicCurrentNames = (publicIssue.labels || []).map((l) => l.name).filter((n) => n.startsWith("status:"));
    for (const name of publicCurrentNames) await client.removeLabel(publicRepo, publicIssueNumber, name);
    await client.addLabels(publicRepo, publicIssueNumber, [config.status_labels[parsed.argument]]);
    const statusMetadata = buildBridgePublicationMetadata({
      syncId,
      privateRepository: privateRepo,
      privateIssue: issue.number,
      kind: `public-status:${parsed.argument}`,
      sourceComment: comment.id
    });
    await client.createComment(publicRepo, publicIssueNumber, `${renderStatusMessage(parsed.argument)}\n\n${statusMetadata}`);

    await removeStatusLabels(client, privateRepo, issue.number, currentPrivateLabels, publicStatusNames);
    await client.addLabels(privateRepo, issue.number, [config.status_labels[parsed.argument]]);

    emitAuditEvent(
      { event_type: AuditEventType.PRIVATE_STATUS_PUBLISHED, result: "success", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: `public_status:${parsed.argument}`, workflow_run_id: runId },
      sink
    );
    return { action: "status-published", state: parsed.argument };
  }

  // /public and /public-resolution both publish free-text — scan first.
  const scan = scanForSensitiveContent(parsed.body, {
    configurable: true,
    privateRepoSlugs: [config.repositories.private]
  });
  if (scan.blocked) {
    emitAuditEvent(
      { event_type: AuditEventType.SECRET_DETECTED, result: "blocked", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, sync_id: syncId, command: parsed.command, reason: scan.categories.join(","), workflow_run_id: runId },
      sink
    );
    emitAuditEvent(
      { event_type: AuditEventType.PRIVATE_PUBLICATION_BLOCKED, result: "blocked", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: parsed.command, reason: "secret-detected", workflow_run_id: runId },
      sink
    );
    await client.createComment(privateRepo, issue.number, renderBlockedPublicationMessage(scan.categories));
    return { action: "blocked", reason: "secret-detected", categories: scan.categories };
  }

  const suppressedBody = suppressMentions(parsed.body);

  if (parsed.command === "public") {
    if (await alreadyPublished(client, publicRepo, publicIssueNumber, "public", comment.id)) {
      emitAuditEvent(
        { event_type: AuditEventType.DUPLICATE_EVENT_IGNORED, result: "noop", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: "public", workflow_run_id: runId },
        sink
      );
      return { action: "noop", reason: "already-published" };
    }
    const publicMessage = renderPublicUpdateMessage(suppressedBody);
    const metadata = buildBridgePublicationMetadata({ syncId, privateRepository: privateRepo, privateIssue: issue.number, kind: "public", sourceComment: comment.id });
    await client.createComment(publicRepo, publicIssueNumber, `${publicMessage}\n\n${metadata}`);
    emitAuditEvent(
      { event_type: AuditEventType.PRIVATE_PUBLICATION_ALLOWED, result: "success", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: "public", workflow_run_id: runId },
      sink
    );
    return { action: "published" };
  }

  if (parsed.command === "resolution") {
    if (await alreadyPublished(client, publicRepo, publicIssueNumber, "resolution", comment.id)) {
      emitAuditEvent(
        { event_type: AuditEventType.DUPLICATE_EVENT_IGNORED, result: "noop", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: "resolution", workflow_run_id: runId },
        sink
      );
      return { action: "noop", reason: "already-published" };
    }
    const resolutionMessage = renderResolutionMessage(suppressedBody);
    const metadata = buildBridgePublicationMetadata({ syncId, privateRepository: privateRepo, privateIssue: issue.number, kind: "resolution", sourceComment: comment.id });
    await client.createComment(publicRepo, publicIssueNumber, `${resolutionMessage}\n\n${metadata}`);

    const publicIssue = await client.getIssue(publicRepo, publicIssueNumber);
    const publicStatusNames = new Set(Object.values(config.status_labels));
    const publicCurrentNames = (publicIssue.labels || []).map((l) => l.name).filter((n) => n.startsWith("status:"));
    for (const name of publicCurrentNames) await client.removeLabel(publicRepo, publicIssueNumber, name);
    await client.addLabels(publicRepo, publicIssueNumber, [config.status_labels.released]);
    await client.updateIssue(publicRepo, publicIssueNumber, { state: "closed", state_reason: "completed" });

    await removeStatusLabels(client, privateRepo, issue.number, currentPrivateLabels, publicStatusNames);
    await client.addLabels(privateRepo, issue.number, [config.status_labels.released]);

    emitAuditEvent(
      { event_type: AuditEventType.PRIVATE_RESOLUTION_PUBLISHED, result: "success", actor: actorLogin, source_repository: privateRepo, source_issue: issue.number, source_comment: comment.id, destination_repository: publicRepo, destination_issue: publicIssueNumber, sync_id: syncId, command: "resolution", workflow_run_id: runId },
      sink
    );
    return { action: "resolution-published" };
  }

  throw validationError(`unhandled command: ${parsed.command}`);
}

async function main() {
  const config = loadBridgeConfig();
  assertExpectedRepository(config.repositories.private, currentRepoSlug());
  const event = readEventPayload();
  const client = buildClient();
  const result = await handlePrivateCommentCreated({
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
