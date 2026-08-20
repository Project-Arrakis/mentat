// ACP Issue Bridge — canonical synchronization ID (spec section 7).
//
// Correlation is derived ONLY from the public issue number, never from
// title, reporter, or timestamp (section 11).

import { validationError } from "./errors.mjs";

const SYNC_ID_PATTERN = /^ACP-PUBLIC-(\d+)$/;

/** Compute the canonical Sync ID for a public issue number. */
export function computeSyncId(publicIssueNumber) {
  const n = Number(publicIssueNumber);
  if (!Number.isInteger(n) || n <= 0) {
    throw validationError(`publicIssueNumber must be a positive integer, got: ${JSON.stringify(publicIssueNumber)}`);
  }
  return `ACP-PUBLIC-${n}`;
}

/** Parse a Sync ID string back into its public issue number, or null if malformed. */
export function parseSyncId(syncId) {
  if (typeof syncId !== "string") return null;
  const match = SYNC_ID_PATTERN.exec(syncId.trim());
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** True only for a syntactically well-formed Sync ID. */
export function isValidSyncId(syncId) {
  return parseSyncId(syncId) !== null;
}
