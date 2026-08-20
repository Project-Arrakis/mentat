// ACP Issue Bridge — synchronization/security label state machine
// (spec sections 23/25/26/27/28/29).
//
// Sync state is modeled as exactly one of {sync:enabled, sync:paused,
// sync:error} at a time — the same one-state-at-a-time model already used
// for public status labels (section 23), and the only model consistent
// with `/sync-resume`'s explicit "remove paused+error, then add enabled"
// behavior (section 29). `visibility:security-sensitive` is an orthogonal
// flag layered on top: it independently fails closed every outbound
// publication command regardless of the sync:* state (section 26).
//
// This module only computes label deltas / gate decisions — it never calls
// the GitHub API itself (see the `*-orchestrate.mjs` scripts for that),
// so it can be exercised with pure, fast unit tests.

export function hasLabel(currentLabels, label) {
  return currentLabels instanceof Set ? currentLabels.has(label) : currentLabels.includes(label);
}

/**
 * Gate checked before ANY outbound (private -> public) content publication:
 * `/public`, `/public-status`, `/public-resolution`. Fails closed on every
 * branch — this function's `allowed` must be true before publishing
 * anything, no exceptions.
 */
export function canPublishOutbound(currentLabels, config) {
  if (hasLabel(currentLabels, config.labels.security_sensitive)) {
    return { allowed: false, reason: "security-sensitive" };
  }
  if (hasLabel(currentLabels, config.labels.sync_paused)) {
    return { allowed: false, reason: "sync-paused" };
  }
  if (hasLabel(currentLabels, config.labels.sync_error)) {
    return { allowed: false, reason: "sync-error" };
  }
  if (!hasLabel(currentLabels, config.labels.sync_enabled)) {
    return { allowed: false, reason: "sync-not-enabled" };
  }
  return { allowed: true, reason: null };
}

/** `/security` (spec section 25): immediately and unconditionally locks down outbound sync. */
export function applySecurityCommand(config) {
  return {
    add: [config.labels.security_sensitive, config.labels.sync_paused],
    remove: [config.labels.sync_enabled]
  };
}

/**
 * `/security-clear` (section 27): admin-only (enforced by auth.mjs before
 * this is called). Removes ONLY the security-sensitive flag. Synchronization
 * remains paused — a separate `/sync-resume` is required. This function
 * does not remove sync:paused; that is the point of the two-step recovery.
 */
export function applySecurityClear(config) {
  return {
    add: [],
    remove: [config.labels.security_sensitive]
  };
}

/** `/sync-pause` (section 28): stop outbound sync; inbound sync is unaffected. */
export function applySyncPause(config) {
  return {
    add: [config.labels.sync_paused],
    remove: [config.labels.sync_enabled]
  };
}

/**
 * `/sync-resume` (section 29): only valid when security-sensitive is absent.
 * Returns `{ allowed: false, reason }` without any label delta if the
 * precondition fails — callers MUST check `allowed` before applying `add`/`remove`.
 */
export function applySyncResume(currentLabels, config) {
  if (hasLabel(currentLabels, config.labels.security_sensitive)) {
    return { allowed: false, reason: "security-sensitive", add: [], remove: [] };
  }
  return {
    allowed: true,
    reason: null,
    add: [config.labels.sync_enabled],
    remove: [config.labels.sync_paused, config.labels.sync_error]
  };
}
