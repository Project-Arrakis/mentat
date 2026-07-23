import assert from "node:assert/strict";
import { test } from "node:test";
import { createDigestFormatter, alertSubscriber, sendChannelAlert } from "../src/notifications.js";

test("digest formatter produces status digest", () => {
  const fmt = createDigestFormatter();
  const digest = fmt.formatStatusDigest({
    result: { summary: { overall: "OK", region: "us", mode: "pve", population: "12/100" } }
  });
  assert.ok(digest.includes("Incident Digest"));
  assert.ok(digest.includes("OK"));
  assert.ok(digest.includes("us"));
  assert.ok(digest.includes("pve"));
  assert.ok(digest.includes("12/100"));
});

test("readiness alert fires when not ready", () => {
  const fmt = createDigestFormatter();
  const alert = fmt.formatReadinessAlert({
    result: { ready: false, issues: ["Database disconnected"] }
  });
  assert.ok(alert.includes("NOT READY"));
  assert.ok(alert.includes("Database disconnected"));
});

test("readiness alert is null when ready", () => {
  const fmt = createDigestFormatter();
  const alert = fmt.formatReadinessAlert({
    result: { ready: true, issues: [] }
  });
  assert.equal(alert, null);
});

test("services alert fires when services are down", () => {
  const fmt = createDigestFormatter();
  const alert = fmt.formatServicesAlert({
    result: { services: [{ name: "DB", status: "down" }] }
  });
  assert.ok(alert.includes("Service Alert"));
  assert.ok(alert.includes("DB"));
  assert.ok(alert.includes("down"));
});

test("services alert is null when all up", () => {
  const fmt = createDigestFormatter();
  const alert = fmt.formatServicesAlert({
    result: { services: [{ name: "DB", status: "up" }] }
  });
  assert.equal(alert, null);
});

test("alert subscriber sends readiness alert to channel", async () => {
  const sent = [];
  const sub = alertSubscriber({
    adapterClient: {
      readiness: async () => ({ result: { ready: false, issues: ["test issue"] } })
    },
    client: {
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (msg) => sent.push(msg) }) }
    },
    channelId: "x"
  });
  await sub.checkReadiness();
  assert.ok(sent[0].includes("NOT READY"));
});

test("alert subscriber sends services alert to channel", async () => {
  const sent = [];
  const sub = alertSubscriber({
    adapterClient: {
      services: async () => ({ result: { services: [{ name: "API", status: "down" }] } })
    },
    client: {
      channels: { fetch: async () => ({ isTextBased: () => true, send: async (msg) => sent.push(msg) }) }
    },
    channelId: "x"
  });
  await sub.checkServices();
  assert.ok(sent[0].includes("Service Alert"));
});

// sendChannelAlert() — the shared low-level helper both alertSubscriber()
// above and statsPusher.js's write-failure alerting (KV-4,
// docs/remediation-prompt-cross-repo.md Phase 3) go through, so there is
// exactly one place that knows how to reach Discord for an operational
// alert.
test("sendChannelAlert posts to a text-based channel and reports success", async () => {
  const sent = [];
  const client = {
    channels: { fetch: async () => ({ isTextBased: () => true, send: async (msg) => sent.push(msg) }) }
  };
  const result = await sendChannelAlert(client, "channel-1", "hello");
  assert.equal(result, true);
  assert.deepEqual(sent, ["hello"]);
});

test("sendChannelAlert does nothing and reports false for a non-text channel", async () => {
  const client = {
    channels: { fetch: async () => ({ isTextBased: () => false, send: async () => { throw new Error("must not be called"); } }) }
  };
  const result = await sendChannelAlert(client, "channel-1", "hello");
  assert.equal(result, false);
});

test("sendChannelAlert does nothing and reports false when the message is empty", async () => {
  let fetchCalled = false;
  const client = {
    channels: { fetch: async () => { fetchCalled = true; return { isTextBased: () => true, send: async () => {} }; } }
  };
  const result = await sendChannelAlert(client, "channel-1", null);
  assert.equal(result, false);
  assert.equal(fetchCalled, false, "must not even look up the channel for an empty message");
});

test("sendChannelAlert does nothing and reports false when client or channelId is missing", async () => {
  assert.equal(await sendChannelAlert(null, "channel-1", "hello"), false);
  assert.equal(await sendChannelAlert({ channels: { fetch: async () => ({}) } }, null, "hello"), false);
});
