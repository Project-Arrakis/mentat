import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig } from "./lib/config.mjs";
import { buildIssueMetadata } from "./lib/metadata.mjs";
import { handlePublicLabelSync } from "./public-label-sync.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL_CONFIG_PATH = join(__dirname, "..", "..", "acp-issue-bridge.yml");
const config = loadConfig(REAL_CONFIG_PATH);
const PUBLIC_REPO = config.repositories.public;
const PRIVATE_REPO = config.repositories.private;

function mirrorBody() {
  return `# mirror\n\n${buildIssueMetadata({ syncId: "ACP-PUBLIC-52", publicRepository: PUBLIC_REPO, publicIssue: 52 })}`;
}

function makeFakeClient(searchItems) {
  const addedLabels = [];
  const removedLabels = [];
  return {
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
    }
  };
}

test("maps and applies an allowlisted label", async () => {
  const client = makeFakeClient([{ number: 300, body: mirrorBody() }]);
  const result = await handlePublicLabelSync({
    config,
    client,
    event: { action: "labeled", issue: { number: 52 }, label: { name: "priority:p0" } },
    sink: () => {}
  });
  assert.equal(result.action, "synced");
  assert.deepEqual(client.addedLabels, [{ repo: PRIVATE_REPO, number: 300, labels: ["priority:p0"] }]);
});

test("removes the mapped label on unlabeled", async () => {
  const client = makeFakeClient([{ number: 300, body: mirrorBody() }]);
  const result = await handlePublicLabelSync({
    config,
    client,
    event: { action: "unlabeled", issue: { number: 52 }, label: { name: "area:webui" } },
    sink: () => {}
  });
  assert.equal(result.action, "synced");
  assert.deepEqual(client.removedLabels, [{ repo: PRIVATE_REPO, number: 300, label: "area:webui" }]);
});

test("ignores a non-allowlisted label without error", async () => {
  const client = makeFakeClient([{ number: 300, body: mirrorBody() }]);
  const result = await handlePublicLabelSync({
    config,
    client,
    event: { action: "labeled", issue: { number: 52 }, label: { name: "good first issue" } },
    sink: () => {}
  });
  assert.equal(result.action, "ignored");
  assert.equal(client.addedLabels.length, 0);
});

test("never processes status:* labels through generic label sync", () => {
  // status:* was already excluded from label_mapping at config load time; this
  // is a regression guard for that invariant from this call site's perspective.
  assert.equal(config.label_mapping["status:confirmed"], undefined);
});

test("ignores pull request label events", async () => {
  const client = makeFakeClient([]);
  const result = await handlePublicLabelSync({
    config,
    client,
    event: { action: "labeled", issue: { number: 52, pull_request: { url: "x" } }, label: { name: "type:bug" } },
    sink: () => {}
  });
  assert.equal(result.action, "skipped");
});
