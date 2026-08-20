import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { buildIssueMetadata } from "./lib/metadata.mjs";
import { handlePrivateCommentCreated } from "./private-comment-created.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);
const PUBLIC_REPO = config.repositories.public;
const PRIVATE_REPO = config.repositories.private;
const BOT_LOGIN = "acp-issue-bridge[bot]";

function correlatedIssueBody(publicIssue = 52) {
  return `# [PUBLIC #${publicIssue}] Something broke\n\n${buildIssueMetadata({
    syncId: `ACP-PUBLIC-${publicIssue}`,
    publicRepository: PUBLIC_REPO,
    publicIssue
  })}`;
}

function makeFakeClient({ actorRole = "maintain", publicLabels = [] } = {}) {
  const createdComments = [];
  const addedLabels = [];
  const removedLabels = [];
  let currentPublicLabels = [...publicLabels];
  const publicCommentStore = [];
  let publicIssueState = "open";

  return {
    createdComments,
    addedLabels,
    removedLabels,
    get currentPublicLabels() {
      return currentPublicLabels;
    },
    get publicIssueState() {
      return publicIssueState;
    },
    async getUserRole() {
      return actorRole;
    },
    async getIssue(repo) {
      if (repo === PUBLIC_REPO) return { number: 52, labels: currentPublicLabels.map((name) => ({ name })) };
      return { number: 300, labels: [] };
    },
    async addLabels(repo, number, labels) {
      addedLabels.push({ repo, number, labels });
      if (repo === PUBLIC_REPO) currentPublicLabels.push(...labels);
    },
    async removeLabel(repo, number, label) {
      removedLabels.push({ repo, number, label });
      if (repo === PUBLIC_REPO) currentPublicLabels = currentPublicLabels.filter((l) => l !== label);
    },
    async createComment(repo, number, body) {
      createdComments.push({ repo, number, body });
      if (repo === PUBLIC_REPO) publicCommentStore.push({ id: publicCommentStore.length + 1, body });
      return { id: 1 };
    },
    async listComments(repo) {
      if (repo === PUBLIC_REPO) return publicCommentStore;
      return [];
    },
    async updateIssue(repo, number, patch) {
      if (repo === PUBLIC_REPO && patch.state) publicIssueState = patch.state;
    }
  };
}

function sampleEvent({ commentBody, commentId = 1001, labels = [], userLogin = "some-maintainer", issueBody } = {}) {
  return {
    issue: { number: 300, body: issueBody !== undefined ? issueBody : correlatedIssueBody(), labels: labels.map((name) => ({ name })) },
    comment: { id: commentId, body: commentBody, user: { login: userLogin }, created_at: "2026-08-19T14:00:00Z" }
  };
}

function collectSinkLines() {
  const lines = [];
  return { lines, sink: (l) => lines.push(l) };
}

test("SEC-001: a default private comment with no command produces no public action", async () => {
  const client = makeFakeClient();
  const { sink } = collectSinkLines();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "Root cause is in auth/session_manager.py." }),
    expectedBotLogin: BOT_LOGIN,
    sink
  });
  assert.equal(result.action, "noop");
  assert.equal(result.reason, "no-command");
  assert.equal(client.createdComments.length, 0);
});

test("SEC-002: /internal produces no public action", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/internal\nRoot cause is in auth/session_manager.py." }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "noop");
  assert.equal(result.reason, "internal");
  assert.equal(client.createdComments.length, 0);
});

test("SEC-003: an authorized /public comment publishes the update", async () => {
  const client = makeFakeClient({ actorRole: "maintain", publicLabels: ["sync:enabled".replace("sync:enabled", "type:bug")] });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({
      commentBody: "/public\nWe reproduced the issue and are testing a remediation.",
      labels: ["sync:enabled"]
    }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "published");
  const publicComments = client.createdComments.filter((c) => c.repo === PUBLIC_REPO);
  assert.equal(publicComments.length, 1);
  assert.match(publicComments[0].body, /^### ACP Engineering Update/);
  assert.match(publicComments[0].body, /We reproduced the issue/);
});

test("SEC-004: a secret in /public blocks publication and never appears in any output", async () => {
  const client = makeFakeClient({ publicLabels: [] });
  const { lines, sink } = collectSinkLines();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/public\nToken: ghp_example123456789", labels: ["sync:enabled"] }),
    expectedBotLogin: BOT_LOGIN,
    sink
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "secret-detected");
  assert.equal(client.createdComments.filter((c) => c.repo === PUBLIC_REPO).length, 0);
  const allOutput = JSON.stringify(client.createdComments) + lines.join("\n");
  assert.equal(allOutput.includes("ghp_example123456789"), false);
});

test("SEC-005: /public is blocked while sync:paused", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/public\nEngineering update.", labels: ["sync:paused"] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "sync-paused");
  assert.equal(client.createdComments.filter((c) => c.repo === PUBLIC_REPO).length, 0);
});

test("SEC-006: /public-resolution is blocked while visibility:security-sensitive", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({
      commentBody: "/public-resolution\nFixed.",
      labels: ["sync:enabled", "visibility:security-sensitive"]
    }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "security-sensitive");
  assert.equal(client.createdComments.filter((c) => c.repo === PUBLIC_REPO).length, 0);
});

test("SEC-007: an actor with only write access cannot use /public", async () => {
  const client = makeFakeClient({ actorRole: "write" });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/public\nPublish this.", labels: ["sync:enabled"] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "unauthorized");
  assert.equal(client.createdComments.filter((c) => c.repo === PUBLIC_REPO).length, 0);
  // A private-only acknowledgement is fine.
  assert.equal(client.createdComments.filter((c) => c.repo === PRIVATE_REPO).length, 1);
});

test("SEC-008: /security from a write-level actor enables security mode, pauses sync, publishes nothing", async () => {
  const client = makeFakeClient({ actorRole: "write" });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/security\nPotential credential leak.", labels: ["sync:enabled"] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "security-enabled");
  assert.deepEqual(
    client.addedLabels.find((l) => l.repo === PRIVATE_REPO).labels.sort(),
    ["sync:paused", "visibility:security-sensitive"].sort()
  );
  assert.ok(client.removedLabels.some((l) => l.label === "sync:enabled"));
  assert.equal(client.createdComments.filter((c) => c.repo === PUBLIC_REPO).length, 0);
});

test("SEC-009: /security-clear from a maintain-level actor (not admin) is blocked", async () => {
  const client = makeFakeClient({ actorRole: "maintain" });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/security-clear", labels: ["visibility:security-sensitive", "sync:paused"] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "unauthorized");
  assert.equal(client.removedLabels.length, 0);
});

test("SEC-010: /security-clear from an admin removes only visibility:security-sensitive; sync stays paused", async () => {
  const client = makeFakeClient({ actorRole: "admin" });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/security-clear", labels: ["visibility:security-sensitive", "sync:paused"] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "security-cleared");
  assert.deepEqual(
    client.removedLabels.filter((l) => l.repo === PRIVATE_REPO).map((l) => l.label),
    ["visibility:security-sensitive"]
  );
  assert.equal(client.addedLabels.length, 0);
});

test("SEC-011: text that merely LOOKS like a forged bridge metadata block is inert as a plain comment", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({
      commentBody: "for reference, the bridge posts things like:\n<!-- ACP-ISSUE-BRIDGE\norigin: bridge\n-->",
      labels: ["sync:enabled"]
    }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "noop");
  assert.equal(result.reason, "no-command");
  assert.equal(client.createdComments.length, 0);
});

test("SEC-012/section 43: redelivering the same /public comment twice publishes exactly once", async () => {
  const client = makeFakeClient();
  const event = sampleEvent({ commentBody: "/public\nWe reproduced the issue.", commentId: 555, labels: ["sync:enabled"] });
  const first = await handlePrivateCommentCreated({ config, client, event, expectedBotLogin: BOT_LOGIN, sink: () => {} });
  const second = await handlePrivateCommentCreated({ config, client, event, expectedBotLogin: BOT_LOGIN, sink: () => {} });
  assert.equal(first.action, "published");
  assert.equal(second.action, "noop");
  assert.equal(second.reason, "already-published");
  assert.equal(client.createdComments.filter((c) => c.repo === PUBLIC_REPO).length, 1);
});

test("SEC-013: a comment authored by the bridge bot itself is ignored (loop protection)", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/public\nsomething", userLogin: BOT_LOGIN }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "bridge-authored");
});

test("skips comments on private issues that were never mirrored from the public repo", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/public\nsomething", issueBody: "This is an ordinary internal-only engineering issue with no bridge metadata." }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "not-bridge-correlated");
});

test("SEC-016: /public blocks a private attachment URL rather than leaking it", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({
      commentBody: `/public\nSee https://github.com/${PRIVATE_REPO}/files/9999/private-file for details`,
      labels: ["sync:enabled"]
    }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "secret-detected");
  assert.ok(result.categories.includes("private-repository-attachment"));
});

test("/public-status testing: publishes the fixed template and rotates status labels both sides", async () => {
  const client = makeFakeClient({ publicLabels: ["status:confirmed"] });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/public-status testing", labels: ["sync:enabled", "status:confirmed"] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "status-published");
  assert.equal(client.currentPublicLabels.includes("status:confirmed"), false);
  assert.equal(client.currentPublicLabels.includes("status:testing"), true);
  const publicComments = client.createdComments.filter((c) => c.repo === PUBLIC_REPO);
  assert.equal(publicComments.length, 1);
  assert.match(publicComments[0].body, /\*\*Status:\*\* Testing/);
  assert.ok(client.addedLabels.some((l) => l.repo === PRIVATE_REPO && l.labels.includes("status:testing")));
});

test("/public-status rejects an arbitrary state without touching any labels", async () => {
  const client = makeFakeClient({ publicLabels: [] });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/public-status made-up-state", labels: ["sync:enabled"] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "invalid-state");
  assert.equal(client.addedLabels.filter((l) => l.repo === PUBLIC_REPO).length, 0);
});

test("/public-resolution publishes the resolution, marks released, and closes the public issue", async () => {
  const client = makeFakeClient({ publicLabels: ["status:testing"] });
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({
      commentBody: "/public-resolution\nFixed in v1.5.1.\n\nThe readiness command now handles unavailable instances correctly.",
      labels: ["sync:enabled", "status:testing"]
    }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "resolution-published");
  const publicComments = client.createdComments.filter((c) => c.repo === PUBLIC_REPO);
  assert.equal(publicComments.length, 1);
  assert.match(publicComments[0].body, /^### ACP Resolution/);
  assert.equal(client.currentPublicLabels.includes("status:released"), true);
  assert.equal(client.publicIssueState, "closed");
  assert.ok(client.addedLabels.some((l) => l.repo === PRIVATE_REPO && l.labels.includes("status:released")));
});

test("unrecognized slash-like text takes no action", async () => {
  const client = makeFakeClient();
  const result = await handlePrivateCommentCreated({
    config,
    client,
    event: sampleEvent({ commentBody: "/frobnicate this" }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "noop");
  assert.equal(result.reason, "unrecognized-command");
  assert.equal(client.createdComments.length, 0);
});
