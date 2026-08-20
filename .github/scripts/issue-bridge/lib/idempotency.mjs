// ACP Issue Bridge — idempotency keys (spec section 43).
//
// Every event handler must be idempotent: repeated delivery (GitHub webhook
// redelivery, a re-run workflow) must produce no duplicate side effects.
// This module only computes the deterministic key string used in audit
// logs/log correlation; the actual de-duplication mechanism is a
// search-before-write check against the destination repo (see
// correlation.mjs `resolvePrivateMirror` for issues, and the
// "already mirrored?" comment search in the comment-mirroring
// orchestration script) — GitHub Actions runs are stateless between
// invocations, so the destination itself is the only reliable source of
// truth for "has this already happened", not a separately-persisted ledger.

import { validationError } from "./errors.mjs";

/**
 * @param {string} sourceRepo - "owner/repo"
 * @param {string} eventType - e.g. "issue-opened", "comment-created"
 * @param {number|string} issueNumber
 * @param {string|number} discriminator - comment id or delivery id
 */
export function computeIdempotencyKey(sourceRepo, eventType, issueNumber, discriminator) {
  for (const [name, value] of Object.entries({ sourceRepo, eventType, issueNumber, discriminator })) {
    if (value === undefined || value === null || value === "") {
      throw validationError(`computeIdempotencyKey: missing required field "${name}"`);
    }
  }
  return `${sourceRepo}:${eventType}:${issueNumber}:${discriminator}`;
}
