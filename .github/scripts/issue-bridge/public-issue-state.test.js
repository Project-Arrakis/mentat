import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { buildIssueMetadata } from "./lib/metadata.mjs";
import { handlePublicIssueState } from "./public-issue-state.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);
const PUBLIC_REPO = config.repositories.public;
const PRIVATE_REPO = config.repositories.private;
const BOT_LOGIN = "acp-issue-bridge[bot]";

function mirrorBody() {
  return `# mirror\n\n${buildIssueMetadata({ syncId: "ACP-PUBLIC-52", publicRepository: PUBLIC_REPO, publicIssue: 52 })}`;
}

function makeFakeClient(searchItems) {
  const createdComments = [];
  const addedLabels = [];
  const removedLabels = [];
  return {
    createdComments,
    addedLabels,
    removedLabels,
    async searchIssues() {
      return { items: searchItems };
    },
    async listComments() {
      return [];
    },
    async addLabels(repo, number, labels) {
      addedLabels.push({ repo, number, labels });
    },
    async removeLabel(repo, number, label) {
      removedLabels.push({ repo, number, label });
    },
    async createComment(repo, number, body) {
      createdComments.push({ repo, number, body });
      return { id: 1 };
    }
  };
}

function sampleEvent(action, overrides = {}) {
  return {
    action,
    issue: { number: 52, body: "updated description", pull_request: undefined },
    sender: { login: "some-reporter" },
    ...overrides
  };
}

test("issue edited: appends a sync comment with the sanitized latest body, never rewrites the issue", async () => {
  const client = makeFakeClient([{ number: 300, body: mirrorBody() }]);
  const result = await handlePublicIssueState({
    config,
    client,
    event: sampleEvent("edited"),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "synced");
  assert.equal(client.createdComments.length, 1);
  assert.match(client.createdComments[0].body, /^### Public Issue Updated/);
  assert.match(client.createdComments[0].body, /edited by `@some-reporter`/);
  assert.match(client.createdComments[0].body, /updated description/);
});

test("issue closed: applies status:public-closed and appends the closure comment", async () => {
  const client = makeFakeClient([{ number: 300, body: mirrorBody() }]);
  const result = await handlePublicIssueState({
    config,
    client,
    event: sampleEvent("closed"),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "synced");
  assert.deepEqual(client.addedLabels, [{ repo: PRIVATE_REPO, number: 300, labels: ["status:public-closed"] }]);
  assert.match(client.createdComments[0].body, /^### Public Issue Closed/);
  assert.match(client.createdComments[0].body, /has not been automatically closed/);
});

test("issue reopened: removes status:public-closed and appends the reopen comment", async () => {
  const client = makeFakeClient([{ number: 300, body: mirrorBody() }]);
  const result = await handlePublicIssueState({
    config,
    client,
    event: sampleEvent("reopened"),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "synced");
  assert.deepEqual(client.removedLabels, [{ repo: PRIVATE_REPO, number: 300, label: "status:public-closed" }]);
  assert.match(client.createdComments[0].body, /^### Public Issue Reopened/);
});

test("fails closed when no correlated private mirror exists", async () => {
  const client = makeFakeClient([]);
  const result = await handlePublicIssueState({
    config,
    client,
    event: sampleEvent("closed"),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "no-private-mirror-found");
});

test("ignores pull request state changes", async () => {
  const client = makeFakeClient([]);
  const result = await handlePublicIssueState({
    config,
    client,
    event: sampleEvent("closed", { issue: { number: 52, pull_request: { url: "x" } } }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "is-pull-request");
});
