import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { buildIssueMetadata } from "./lib/metadata.mjs";
import { handlePublicIssueOpened } from "./public-issue-opened.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);

const PUBLIC_REPO = config.repositories.public;
const PRIVATE_REPO = config.repositories.private;
const BOT_LOGIN = "acp-issue-bridge[bot]";

/** Minimal in-memory fake implementing only the ghApi surface this script uses. */
function makeFakeClient({ searchItems = [], commentsByIssue = {} } = {}) {
  const calls = [];
  const createdIssues = [];
  const createdComments = [];
  const addedLabels = [];
  let nextIssueNumber = 900;

  return {
    calls,
    createdIssues,
    createdComments,
    addedLabels,
    async searchIssues(query) {
      calls.push({ method: "searchIssues", query });
      return { items: searchItems };
    },
    async listComments(repo, number) {
      calls.push({ method: "listComments", repo, number });
      return (commentsByIssue[number] || []).map((body) => ({ body }));
    },
    async addLabels(repo, number, labels) {
      calls.push({ method: "addLabels", repo, number, labels });
      addedLabels.push({ repo, number, labels });
      return null;
    },
    async createIssue(repo, { title, body, labels }) {
      calls.push({ method: "createIssue", repo, title, labels });
      const number = nextIssueNumber++;
      createdIssues.push({ repo, number, title, body, labels });
      return { number };
    },
    async createComment(repo, number, body) {
      calls.push({ method: "createComment", repo, number });
      createdComments.push({ repo, number, body });
      return { id: 1 };
    }
  };
}

function samplePublicIssueEvent(overrides = {}) {
  return {
    issue: {
      number: 52,
      title: "Readiness command returns null for offline instance",
      body: "Steps to reproduce:\n1. Stop the game server\n2. Run /dune server readiness",
      html_url: `https://github.com/${PUBLIC_REPO}/issues/52`,
      created_at: "2026-08-19T12:00:00Z",
      user: { login: "some-reporter" },
      labels: [{ name: "type:bug" }, { name: "priority:p1" }, { name: "good first issue" }],
      ...overrides
    }
  };
}

test("integration: public issue opened creates a labeled private mirror with metadata", async () => {
  const client = makeFakeClient();
  const result = await handlePublicIssueOpened({
    config,
    client,
    event: samplePublicIssueEvent(),
    expectedBotLogin: BOT_LOGIN,
    workflowRunId: "run-1",
    sink: () => {}
  });

  assert.equal(result.action, "created");
  assert.equal(result.syncId, "ACP-PUBLIC-52");
  assert.equal(client.createdIssues.length, 1);

  const created = client.createdIssues[0];
  assert.equal(created.repo, PRIVATE_REPO);
  assert.equal(created.title, "[PUBLIC #52] Readiness command returns null for offline instance");
  assert.deepEqual(created.labels.sort(), ["priority:p1", "source:public", "sync:enabled", "type:bug", "visibility:internal"].sort());
  assert.match(created.body, /Sync ID:\*\* `ACP-PUBLIC-52`/);
  assert.match(created.body, /sync_id: ACP-PUBLIC-52/);
  assert.match(created.body, /## Engineering Notes/);

  // Mechanism 2: a bridge sync comment was also created for redundant correlation.
  assert.equal(client.createdComments.length, 1);
  assert.match(client.createdComments[0].body, /sync_id: ACP-PUBLIC-52/);
});

test("sanitizes and suppresses mentions in the mirrored body", async () => {
  const client = makeFakeClient();
  const result = await handlePublicIssueOpened({
    config,
    client,
    event: samplePublicIssueEvent({ body: "cc @some-maintainer this breaks for me\u202Etoo" }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "created");
  const created = client.createdIssues[0];
  assert.equal(created.body.includes("@\u200Bsome-maintainer"), true);
  assert.equal(/[\u202A-\u202E]/.test(created.body), false);
});

test("SEC-012 / idempotency: a re-delivered issue-opened event does not create a duplicate mirror", async () => {
  const existingBody = `# mirror\n\n${buildIssueMetadata({
    syncId: "ACP-PUBLIC-52",
    publicRepository: PUBLIC_REPO,
    publicIssue: 52
  })}`;
  const client = makeFakeClient({ searchItems: [{ number: 555, body: existingBody }] });

  const result = await handlePublicIssueOpened({
    config,
    client,
    event: samplePublicIssueEvent(),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });

  assert.equal(result.action, "noop");
  assert.equal(result.privateIssue, 555);
  assert.equal(client.createdIssues.length, 0);
});

test("SEC-014: two ambiguous private mirrors -> sync:error on both, no new issue created", async () => {
  const bodyFor = (n) =>
    `# mirror ${n}\n\n${buildIssueMetadata({ syncId: "ACP-PUBLIC-52", publicRepository: PUBLIC_REPO, publicIssue: 52 })}`;
  const client = makeFakeClient({
    searchItems: [
      { number: 700, body: bodyFor(700) },
      { number: 701, body: bodyFor(701) }
    ]
  });

  const result = await handlePublicIssueOpened({
    config,
    client,
    event: samplePublicIssueEvent(),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });

  assert.equal(result.action, "blocked");
  assert.equal(result.reason, "ambiguous-correlation");
  assert.deepEqual(result.matches, [700, 701]);
  assert.equal(client.createdIssues.length, 0);
  assert.deepEqual(
    client.addedLabels.map((l) => l.number).sort(),
    [700, 701]
  );
  for (const entry of client.addedLabels) {
    assert.deepEqual(entry.labels, ["sync:error"]);
  }
});

test("SEC-013 loop protection: an issue authored by the bridge bot itself is never mirrored", async () => {
  const client = makeFakeClient();
  const result = await handlePublicIssueOpened({
    config,
    client,
    event: samplePublicIssueEvent({ user: { login: BOT_LOGIN } }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "bridge-authored");
  assert.equal(client.calls.length, 0);
});

test("ignores pull requests (issues API also carries PR events)", async () => {
  const client = makeFakeClient();
  const result = await handlePublicIssueOpened({
    config,
    client,
    event: samplePublicIssueEvent({ pull_request: { url: "..." } }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
  assert.equal(result.reason, "is-pull-request");
});

test("only allowlisted public labels are translated onto the private mirror", async () => {
  const client = makeFakeClient();
  await handlePublicIssueOpened({
    config,
    client,
    event: samplePublicIssueEvent({ labels: [{ name: "good first issue" }, { name: "wontfix" }] }),
    expectedBotLogin: BOT_LOGIN,
    sink: () => {}
  });
  const created = client.createdIssues[0];
  assert.deepEqual(created.labels.sort(), ["source:public", "sync:enabled", "visibility:internal"].sort());
});
