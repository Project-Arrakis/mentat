import assert from "node:assert/strict";
import { test } from "node:test";
import {
  renderBlockedPublicationMessage,
  renderPublicUpdateMessage,
  renderResolutionMessage,
  renderStatusMessage
} from "./statusTemplates.mjs";

test("renders the exact spec text for every status state", () => {
  assert.equal(
    renderStatusMessage("confirmed"),
    "### ACP Status Update\n\n**Status:** Confirmed\n\nThe issue has been reproduced or otherwise confirmed by the ACP team."
  );
  assert.equal(
    renderStatusMessage("planned"),
    "### ACP Status Update\n\n**Status:** Planned\n\nThe issue has been accepted and is planned for engineering work."
  );
  assert.equal(
    renderStatusMessage("in-progress"),
    "### ACP Status Update\n\n**Status:** In Progress\n\nEngineering work is currently in progress."
  );
  assert.equal(
    renderStatusMessage("blocked"),
    "### ACP Status Update\n\n**Status:** Blocked\n\nWork is currently blocked by an outstanding dependency or prerequisite."
  );
  assert.equal(
    renderStatusMessage("testing"),
    "### ACP Status Update\n\n**Status:** Testing\n\nA remediation has been implemented and is currently undergoing validation."
  );
  assert.equal(
    renderStatusMessage("ready-for-release"),
    "### ACP Status Update\n\n**Status:** Ready for Release\n\nThe remediation has passed validation and is awaiting release."
  );
  assert.equal(
    renderStatusMessage("released"),
    "### ACP Status Update\n\n**Status:** Released\n\nThe remediation has been released."
  );
});

test("the 'blocked' template never includes any explanatory text (no internal blocker exposure)", () => {
  const message = renderStatusMessage("blocked");
  assert.equal(message.includes("dependency or prerequisite"), true);
  // The template is a pure constant — it cannot possibly reflect whatever a
  // maintainer wrote after `/public-status blocked`, by construction (it
  // takes no body/context argument at all).
  assert.equal(renderStatusMessage.length, 1);
});

test("rejects an unsupported state rather than guessing", () => {
  assert.throws(() => renderStatusMessage("made-up-state"));
  assert.throws(() => renderStatusMessage(undefined));
});

test("renders the /public engineering update template", () => {
  const message = renderPublicUpdateMessage(
    "We reproduced the issue and identified the affected readiness path.\nA fix is currently being tested."
  );
  assert.equal(
    message,
    "### ACP Engineering Update\n\nWe reproduced the issue and identified the affected readiness path.\nA fix is currently being tested."
  );
});

test("renders the /public-resolution template", () => {
  const message = renderResolutionMessage(
    "Fixed in v1.5.1.\n\nThe readiness command now handles unavailable instances correctly."
  );
  assert.equal(
    message,
    "### ACP Resolution\n\nFixed in v1.5.1.\n\nThe readiness command now handles unavailable instances correctly."
  );
});

test("renders the blocked-publication acknowledgement without echoing any secret", () => {
  const message = renderBlockedPublicationMessage(["github-pat"]);
  assert.match(message, /Detection category: `github-pat`/);
  assert.equal(message.includes("ghp_"), false);
  assert.match(message, /No content was published\.$/);
});

test("blocked-publication message handles multiple categories deterministically", () => {
  const message = renderBlockedPublicationMessage(["jwt", "bearer-token"]);
  assert.match(message, /Detection category: `jwt, bearer-token`/);
});

test("blocked-publication message handles an empty category list safely", () => {
  const message = renderBlockedPublicationMessage([]);
  assert.match(message, /Detection category: `unknown`/);
});
