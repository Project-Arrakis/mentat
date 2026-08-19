// ACP Issue Bridge — private-mirror correlation (spec sections 11/44).
//
// Correlation must use at least two independent mechanisms (section 11):
// (1) trusted issue-body metadata (schema_version/sync_id/public_repository/
// public_issue — see metadata.mjs), and (2) here, cross-checking that
// exactly one candidate issue actually carries a well-formed match for the
// expected Sync ID before treating it as "the" mirror. Ambiguity (zero is
// fine — that means "create one"; more than one is not) fails closed.

import { extractSingleIssueMetadata } from "./metadata.mjs";
import { correlationError } from "./errors.mjs";

/**
 * @param {Array<{number:number, body:string, comments?:string[]}>} candidateIssues
 *   - private issues returned by a search for the Sync ID (untrusted at this
 *   point — GitHub's search can return false-positive text matches).
 *   `comments`, if provided, implements the second correlation mechanism
 *   (section 11): a bridge-generated sync comment can confirm correlation
 *   even if the issue body's metadata block was later edited away.
 * @param {string} expectedSyncId
 * @returns {{ status: "none"|"single"|"ambiguous", matches: number[] }}
 */
export function resolvePrivateMirror(candidateIssues, expectedSyncId) {
  const confirmed = [];
  for (const issue of candidateIssues || []) {
    const bodyMeta = extractSingleIssueMetadata(issue.body || "");
    if (bodyMeta && bodyMeta.sync_id === expectedSyncId) {
      confirmed.push(issue.number);
      continue;
    }
    const commentMatch = (issue.comments || []).some((commentBody) => {
      const meta = extractSingleIssueMetadata(commentBody || "");
      return meta && meta.sync_id === expectedSyncId;
    });
    if (commentMatch) confirmed.push(issue.number);
  }

  if (confirmed.length === 0) return { status: "none", matches: [] };
  if (confirmed.length === 1) return { status: "single", matches: confirmed };
  return { status: "ambiguous", matches: confirmed.sort((a, b) => a - b) };
}

/**
 * Convenience wrapper that throws a CORRELATION-class BridgeError for the
 * ambiguous case, for call sites that want to short-circuit with a single
 * try/catch rather than branching on `status` themselves.
 */
export function requireSinglePrivateMirror(candidateIssues, expectedSyncId) {
  const result = resolvePrivateMirror(candidateIssues, expectedSyncId);
  if (result.status === "ambiguous") {
    throw correlationError(`multiple private mirrors claim ${expectedSyncId} — refusing to guess`, {
      syncId: expectedSyncId,
      matches: result.matches
    });
  }
  return result;
}
