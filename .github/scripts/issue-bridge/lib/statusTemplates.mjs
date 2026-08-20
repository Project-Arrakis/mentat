// ACP Issue Bridge — standardized public-facing message templates
// (spec sections 20/22/24).
//
// `/public-status` messages are FIXED templates keyed only by state — they
// never include free-text from the triggering comment. This is a
// deliberate security property (section 22, "Blocked": "Do not expose the
// internal blocker.") — whatever internal detail a maintainer wrote after
// `/public-status blocked` must never reach the public template.
//
// NOTE on section 24's worked example: the spec's sample input
// ("Fixed in v1.5.1.") and sample output ("Fixed in `v1.5.1`.") differ only
// in backtick-wrapping the version string. We treat that as illustrative
// formatting in the prompt, not a literal requirement — auto-detecting and
// backtick-wrapping "version-shaped" substrings inside arbitrary
// maintainer-authored text is a fragile heuristic that could mangle
// unrelated text, and no other section describes such a transform. The
// resolution template here reproduces the sanitized body verbatim under a
// fixed header, exactly like the `/public` template. Documented as a
// deliberate interpretation in docs/issue-bridge/commands.md.

import { validationError } from "./errors.mjs";
import { VALID_STATUS_STATES } from "./commandParser.mjs";

const STATUS_MESSAGES = Object.freeze({
  confirmed:
    "### ACP Status Update\n\n**Status:** Confirmed\n\nThe issue has been reproduced or otherwise confirmed by the ACP team.",
  planned:
    "### ACP Status Update\n\n**Status:** Planned\n\nThe issue has been accepted and is planned for engineering work.",
  "in-progress":
    "### ACP Status Update\n\n**Status:** In Progress\n\nEngineering work is currently in progress.",
  blocked:
    "### ACP Status Update\n\n**Status:** Blocked\n\nWork is currently blocked by an outstanding dependency or prerequisite.",
  testing:
    "### ACP Status Update\n\n**Status:** Testing\n\nA remediation has been implemented and is currently undergoing validation.",
  "ready-for-release":
    "### ACP Status Update\n\n**Status:** Ready for Release\n\nThe remediation has passed validation and is awaiting release.",
  released:
    "### ACP Status Update\n\n**Status:** Released\n\nThe remediation has been released."
});

/** Render the fixed public status message for a validated state. Never accepts a body. */
export function renderStatusMessage(state) {
  if (!VALID_STATUS_STATES.has(state)) {
    throw validationError(`unsupported public-status state: ${JSON.stringify(state)}`);
  }
  return STATUS_MESSAGES[state];
}

/** Render a `/public` engineering-update comment from an already sanitized/scanned body. */
export function renderPublicUpdateMessage(sanitizedBody) {
  return `### ACP Engineering Update\n\n${sanitizedBody}`;
}

/** Render a `/public-resolution` comment from an already sanitized/scanned body. */
export function renderResolutionMessage(sanitizedBody) {
  return `### ACP Resolution\n\n${sanitizedBody}`;
}

/** Render the internal-only "publication blocked" acknowledgement (section 46). Never echoes the secret. */
export function renderBlockedPublicationMessage(categories) {
  const categoryList = categories.length > 0 ? categories.join(", ") : "unknown";
  return [
    "### ACP Issue Bridge",
    "",
    "Publication was blocked because the comment appears to contain sensitive information.",
    "",
    "Review and submit a sanitized `/public` comment.",
    "",
    `Detection category: \`${categoryList}\``,
    "",
    "No content was published."
  ].join("\n");
}

export { STATUS_MESSAGES };
