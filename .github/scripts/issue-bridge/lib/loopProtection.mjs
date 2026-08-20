// ACP Issue Bridge — loop protection (spec section 41/42).
//
// The AUTHORITATIVE signal that a comment/issue event was created BY the
// bridge itself (and must therefore be ignored as a synchronization source,
// never re-processed) is the GitHub Actor identity of whoever/whatever
// created it — specifically, that the event's actor is the ACP Issue
// Bridge GitHub App's bot user. An embedded `<!-- ACP-ISSUE-BRIDGE -->`
// HTML comment is at best corroborating evidence and MUST NOT be trusted
// alone (section 42) — a public user can type that text themselves.

function normalizeLogin(login) {
  return typeof login === "string" ? login.trim().toLowerCase() : "";
}

/**
 * @param {object} actor
 * @param {string} actor.login - e.g. "acp-issue-bridge[bot]"
 * @param {string} [actor.type] - GitHub's `user.type`, e.g. "Bot" or "User"
 * @param {string} expectedBotLogin - configured bot login this bridge runs as
 */
export function isBridgeActor(actor, expectedBotLogin) {
  if (!actor || !expectedBotLogin) return false;
  if (actor.type && actor.type !== "Bot") return false;
  return normalizeLogin(actor.login) === normalizeLogin(expectedBotLogin);
}

/**
 * Decide whether an inbound event should be ignored as a bridge-generated
 * synchronization artifact. Requires the authoritative actor-identity check
 * to pass; the metadata block is only consulted for logging/diagnostics,
 * never as a substitute for the identity check.
 */
export function shouldIgnoreAsBridgeGenerated({ actor, expectedBotLogin }) {
  return isBridgeActor(actor, expectedBotLogin);
}
