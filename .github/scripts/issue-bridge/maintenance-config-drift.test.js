import assert from "node:assert/strict";
import { test } from "node:test";
import { CHECKSUM_ISSUE_TITLE, renderChecksumIssueBody, sha256Hex } from "./lib/configChecksum.mjs";
import { checkDrift, publishChecksum } from "./maintenance-config-drift.mjs";

function makeFakeClient({ searchItems = [] } = {}) {
  const createdIssues = [];
  const updatedIssues = [];
  return {
    createdIssues,
    updatedIssues,
    async searchIssues() {
      return { items: searchItems };
    },
    async createIssue(repo, { title, body }) {
      createdIssues.push({ repo, title, body });
      return { number: 900 };
    },
    async updateIssue(repo, number, patch) {
      updatedIssues.push({ repo, number, patch });
    }
  };
}

test("publishChecksum creates the bookkeeping issue when none exists yet", async () => {
  const client = makeFakeClient({ searchItems: [] });
  const result = await publishChecksum({ client, repoSlug: "yacketrj/acp-discordbot", configText: "version: 1\n", sink: () => {} });
  assert.equal(client.createdIssues.length, 1);
  assert.equal(client.createdIssues[0].title, CHECKSUM_ISSUE_TITLE);
  assert.match(client.createdIssues[0].body, new RegExp(result.hash));
});

test("publishChecksum updates the existing bookkeeping issue instead of creating a duplicate", async () => {
  const client = makeFakeClient({ searchItems: [{ number: 42, body: "old" }] });
  await publishChecksum({ client, repoSlug: "yacketrj/acp-discordbot", configText: "version: 1\n", sink: () => {} });
  assert.equal(client.createdIssues.length, 0);
  assert.equal(client.updatedIssues.length, 1);
  assert.equal(client.updatedIssues[0].number, 42);
});

test("checkDrift reports no drift when hashes match", async () => {
  const configText = "version: 1\nrepositories:\n  public: a/b\n";
  const hash = sha256Hex(configText);
  const client = makeFakeClient({ searchItems: [{ number: 1, body: renderChecksumIssueBody(hash, "now") }] });
  const result = await checkDrift({ client, publicRepo: "yacketrj/acp-discordbot", localConfigText: configText, sink: () => {} });
  assert.equal(result.drift, false);
});

test("checkDrift detects a mismatch rather than assuming files are identical", async () => {
  const client = makeFakeClient({
    searchItems: [{ number: 1, body: renderChecksumIssueBody(sha256Hex("different content"), "now") }]
  });
  const result = await checkDrift({ client, publicRepo: "yacketrj/acp-discordbot", localConfigText: "version: 1\n", sink: () => {} });
  assert.equal(result.drift, true);
});

test("checkDrift fails closed (throws) when the public repo has not published a checksum yet", async () => {
  const client = makeFakeClient({ searchItems: [] });
  await assert.rejects(() =>
    checkDrift({ client, publicRepo: "yacketrj/acp-discordbot", localConfigText: "version: 1\n", sink: () => {} })
  );
});

test("checkDrift fails closed when the published checksum body is malformed", async () => {
  const client = makeFakeClient({ searchItems: [{ number: 1, body: "not a real checksum body" }] });
  await assert.rejects(() =>
    checkDrift({ client, publicRepo: "yacketrj/acp-discordbot", localConfigText: "version: 1\n", sink: () => {} })
  );
});
