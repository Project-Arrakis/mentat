import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { buildIssueMetadata } from "./lib/metadata.mjs";
import { handlePublicCommentCreated } from "./public-comment-created.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);
const PUBLIC_REPO = config.repositories.public;
const PRIVATE_REPO = config.repositories.private;
const BOT_LOGIN = "acp-issue-bridge[bot]";

function mirrorBody(publicIssue = 52) {
  return `# mirror\n\n${buildIssueMetadata({ syncId: `ACP-PUBLIC-${publicIssue}`, publicRepository: PUBLIC_REPO, publicIssue })}`;
}

function makeFakeClient({ searchItems, commentsByIssue = {} }) {
  const createdComments = [];
  const addedLabels = [];
  return {
    createdComments,
    addedLabels,
    async searchIssues() {
      return { items: searchItems };
    },
    async listComments(repo, number) {
      return (commentsByIssue[number] || []).map((body, i) => ({ id: 1000 + i, body }));
    },
    async addLabels(repo, number, labels) {
      addedLabels.push({ repo, number, labels });
      return null;
    },
    async createComment(repo, number, body) {
      createdComments.push({ repo, number, body });
      return { id: 9999 };
    }
  };
}

function sampleEvent(overrides = {}) {
  return {
    issue: { number: 52, pull_request: undefined, ...overrides.issue },
    comment: {
      id: 23891827,
      body: "This still occurs after upgrading to v1.5.0.",
      user: { login: "some-reporter" },
      created_at: "2026-08-19T13:00:00Z",
      html_url: `https://github.com/${PUBLIC_REPO}/issues/52#issuecomment-23891827`,
      ...overrides.comment
    }
  };
}

test("integration: public comment mirrors into the correlated private issue", async () => {
  const client = makeFakeClient({ searchItems: [{ number: 300, body: mirrorBody() }] });
  const result = await handlePublicCommentCreated({
    config,
    client,
    event: sampleEvent(),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "mirrored");
  assert.equal(result.privateIssue, 300);
  assert.equal(client.createdComments.length, 1);
  const body = client.createdComments[0].body;
  assert.match(body, /^### Public Comment/);
  assert.match(body, /\*\*Author:\*\* `@some-reporter`/);
  assert.match(body, /> This still occurs after upgrading to v1\.5\.0\./);
  assert.match(body, /source_comment: 23891827/);
});

test("SEC-015: suppresses a mention-injection attempt from a public commenter", async () => {
  const client = makeFakeClient({ searchItems: [{ number: 300, body: mirrorBody() }] });
  const result = await handlePublicCommentCreated({
    config,
    client,
    event: sampleEvent({ comment: { body: "@ACP-Admins please check." } }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "mirrored");
  const body = client.createdComments[0].body;
  assert.equal(body.includes("@\u200BACP-Admins"), true);
  assert.equal(/(?<!\u200B)@ACP-Admins/.test(body), false);
});

test("does not mirror a comment authored by the bridge bot itself (loop protection)", async () => {
  const client = makeFakeClient({ searchItems: [] });
  const result = await handlePublicCommentCreated({
    config,
    client,
    event: sampleEvent({ comment: { user: { login: BOT_LOGIN } } }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "bridge-authored");
  assert.equal(client.createdComments.length, 0);
});

test("fails closed when no correlated private mirror can be found", async () => {
  const client = makeFakeClient({ searchItems: [] });
  const result = await handlePublicCommentCreated({
    config,
    client,
    event: sampleEvent(),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "no-private-mirror-found");
  assert.equal(client.createdComments.length, 0);
});

test("SEC-014-adjacent: ambiguous correlation blocks and flags sync:error rather than guessing", async () => {
  const client = makeFakeClient({
    searchItems: [
      { number: 700, body: mirrorBody() },
      { number: 701, body: mirrorBody() }
    ]
  });
  const result = await handlePublicCommentCreated({
    config,
    client,
    event: sampleEvent(),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "ambiguous-correlation");
  assert.equal(client.createdComments.length, 0);
  assert.equal(client.addedLabels.length, 2);
});

test("SEC-012: duplicate delivery of the same comment event produces exactly one mirrored comment", async () => {
  const alreadyMirroredComment = [
    "### Public Comment\n\n<!-- ACP-ISSUE-BRIDGE\nschema_version: 1\ndirection: public-to-private\nsync_id: ACP-PUBLIC-52\nsource_repository: " +
      PUBLIC_REPO +
      "\nsource_issue: 52\nsource_comment: 23891827\n-->"
  ];
  const client = makeFakeClient({
    searchItems: [{ number: 300, body: mirrorBody() }],
    commentsByIssue: { 300: alreadyMirroredComment }
  });
  const result = await handlePublicCommentCreated({
    config,
    client,
    event: sampleEvent(),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "noop");
  assert.equal(result.reason, "already-mirrored");
  assert.equal(client.createdComments.length, 0);
});

test("ignores comments on pull requests", async () => {
  const client = makeFakeClient({ searchItems: [] });
  const result = await handlePublicCommentCreated({
    config,
    client,
    event: sampleEvent({ issue: { number: 52, pull_request: { url: "..." } } }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "is-pull-request");
});
