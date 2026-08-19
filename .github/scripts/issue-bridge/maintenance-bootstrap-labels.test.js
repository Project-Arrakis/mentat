import assert from "node:assert/strict";
import { test } from "node:test";
import { PUBLIC_LABELS } from "./lib/labelDefinitions.mjs";
import { bootstrapLabels } from "./maintenance-bootstrap-labels.mjs";

function makeFakeClient(existingNames) {
  const created = [];
  return {
    created,
    async listLabels() {
      return existingNames.map((name) => ({ name }));
    },
    async createLabel(repo, label) {
      created.push(label);
    }
  };
}

test("creates only the labels that don't already exist", async () => {
  const client = makeFakeClient(["type:bug", "type:feature"]);
  const result = await bootstrapLabels({ client, repoSlug: "yacketrj/acp-discordbot", taxonomy: PUBLIC_LABELS, sink: () => {} });
  assert.equal(result.skipped.includes("type:bug"), true);
  assert.equal(result.skipped.includes("type:feature"), true);
  assert.equal(result.created.includes("type:documentation"), true);
  assert.equal(client.created.length, PUBLIC_LABELS.length - 2);
});

test("is a no-op (creates nothing) when every label already exists", async () => {
  const client = makeFakeClient(PUBLIC_LABELS.map((l) => l.name));
  const result = await bootstrapLabels({ client, repoSlug: "yacketrj/acp-discordbot", taxonomy: PUBLIC_LABELS, sink: () => {} });
  assert.equal(result.created.length, 0);
  assert.equal(result.skipped.length, PUBLIC_LABELS.length);
});

test("creates every label on a completely empty repo", async () => {
  const client = makeFakeClient([]);
  const result = await bootstrapLabels({ client, repoSlug: "yacketrj/acp-discordbot", taxonomy: PUBLIC_LABELS, sink: () => {} });
  assert.equal(result.created.length, PUBLIC_LABELS.length);
});
