#!/usr/bin/env node
// ACP Issue Bridge — config drift detection (spec sections 61/75).
//
// Two modes:
//   `publish` — run in EITHER repo with its own native GITHUB_TOKEN. Hashes
//               the local config file and upserts the checksum bookkeeping
//               issue in the CURRENT repo. No cross-repo access.
//   `check`   — run ONLY in the private repo with the App token. Reads the
//               public repo's bookkeeping issue (issues:read, already
//               justified) and compares against the private repo's own
//               local hash. Exits non-zero (visible in the Actions run) on
//               drift or on any inability to verify — never silently
//               assumes the files match.

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import {
  CHECKSUM_ISSUE_TITLE,
  parseChecksumIssueBody,
  renderChecksumIssueBody,
  sha256Hex
} from "./lib/configChecksum.mjs";
import { validationError, configurationError } from "./lib/errors.mjs";
import { buildClient, currentRepoSlug, loadBridgeConfig, workflowRunId } from "./runtime.mjs";
import { AuditEventType, emitAuditEvent } from "./lib/audit.mjs";

export async function publishChecksum({ client, repoSlug, configText, sink = console.log }) {
  const hash = sha256Hex(configText);
  const body = renderChecksumIssueBody(hash, new Date().toISOString());

  const search = await client.searchIssues(`repo:${repoSlug} in:title "${CHECKSUM_ISSUE_TITLE}" is:issue`);
  const existing = (search.items || [])[0];
  if (existing) {
    await client.updateIssue(repoSlug, existing.number, { body });
  } else {
    await client.createIssue(repoSlug, { title: CHECKSUM_ISSUE_TITLE, body, labels: [] });
  }
  sink(JSON.stringify({ action: "published", repo: repoSlug, sha256: hash }));
  return { hash };
}

export async function checkDrift({ client, publicRepo, localConfigText, sink = console.log, runId = null }) {
  const localHash = sha256Hex(localConfigText);
  const search = await client.searchIssues(`repo:${publicRepo} in:title "${CHECKSUM_ISSUE_TITLE}" is:issue`);
  const existing = (search.items || [])[0];
  if (!existing) {
    emitAuditEvent(
      { event_type: AuditEventType.CORRELATION_ERROR, result: "blocked", reason: "public-checksum-not-found", workflow_run_id: runId },
      sink
    );
    throw configurationError("public repo has not published a config checksum yet — run publishChecksum there first");
  }
  const publicHash = parseChecksumIssueBody(existing.body || "");
  if (!publicHash) {
    throw configurationError("public repo's checksum issue body is malformed");
  }
  if (publicHash !== localHash) {
    emitAuditEvent(
      { event_type: AuditEventType.CORRELATION_ERROR, result: "blocked", reason: "config-drift-detected", workflow_run_id: runId },
      sink
    );
    return { drift: true, localHash, publicHash };
  }
  return { drift: false, localHash, publicHash };
}

async function main() {
  const mode = process.argv[2];
  const config = loadBridgeConfig();
  const actualRepo = currentRepoSlug();

  if (mode === "publish") {
    const configText = readFileSync(".github/acp-issue-bridge.yml", "utf8");
    const client = buildClient({ tokenEnvVar: "GITHUB_TOKEN" });
    await publishChecksum({ client, repoSlug: actualRepo, configText });
    return;
  }

  if (mode === "check") {
    if (actualRepo !== config.repositories.private) {
      throw validationError('"check" mode must run in the private repository');
    }
    const localConfigText = readFileSync(".github/acp-issue-bridge.yml", "utf8");
    const client = buildClient({ tokenEnvVar: "ACP_BRIDGE_TOKEN" });
    const result = await checkDrift({ client, publicRepo: config.repositories.public, localConfigText, runId: workflowRunId() });
    console.log(JSON.stringify(result));
    if (result.drift) process.exitCode = 1;
    return;
  }

  throw validationError('usage: maintenance-config-drift.mjs <publish|check>');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.name === "BridgeError" ? `${err.errorClass}: ${err.message}` : err);
    process.exit(1);
  });
}
