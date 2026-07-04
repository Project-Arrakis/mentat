import assert from "node:assert/strict";
import { test } from "node:test";
import { createAnnouncementBridge, formatAnnouncement, announcementConfig } from "../src/announcements.js";

test("announcementConfig returns disabled by default", () => {
  const cfg = announcementConfig({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.channelId, "");
  assert.equal(cfg.pollIntervalMs, 30000);
});

test("announcementConfig reads env vars", () => {
  const cfg = announcementConfig({
    DUNE_ANNOUNCEMENTS_ENABLED: "true",
    DUNE_ANNOUNCEMENTS_CHANNEL: "chan-1",
    DUNE_ANNOUNCEMENTS_POLL_MS: "60000"
  });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.channelId, "chan-1");
  assert.equal(cfg.pollIntervalMs, 60000);
});

test("formatAnnouncement renders type and message", () => {
  const result = formatAnnouncement({
    type: "ServerBroadcast",
    title: "Event Starting",
    message: "The event begins in 5 minutes",
    timestamp: "2026-07-04T12:00:00Z"
  });
  assert.ok(result.includes("ServerBroadcast"));
  assert.ok(result.includes("Event Starting"));
  assert.ok(result.includes("5 minutes"));
  assert.ok(result.includes("2026-07-04"));
});

test("formatAnnouncement caps long messages", () => {
  const result = formatAnnouncement({
    type: "Broadcast",
    message: "x".repeat(3000)
  });
  assert.ok(result.length <= 2100);
});

test("createAnnouncementBridge returns inactive without channel", () => {
  const bridge = createAnnouncementBridge({
    adapterClient: { announcements: async () => ({ result: { announcements: [] } }) },
    client: null,
    channelId: ""
  });
  assert.equal(bridge.active, false);
});

test("announcement bridge polls and posts to channel", async () => {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (msg) => sent.push(msg) };
  const client = { channels: { fetch: async () => channel } };
  const adapterClient = {
    announcements: async () => ({
      result: {
        announcements: [
          { type: "Alert", message: "Server restart in 10m", timestamp: "2026-07-04T12:00:00Z", id: "a1" }
        ]
      }
    })
  };

  const bridge = createAnnouncementBridge({ adapterClient, client, channelId: "x" });
  bridge.start(50);
  await new Promise((r) => setTimeout(r, 100));
  bridge.stop();
  assert.ok(sent.length >= 1);
  assert.ok(sent[0].includes("Alert"));
  assert.ok(sent[0].includes("Server restart"));
});

test("announcement bridge deduplicates by id", async () => {
  const sent = [];
  const channel = { isTextBased: () => true, send: async (msg) => sent.push(msg) };
  const client = { channels: { fetch: async () => channel } };
  let callCount = 0;
  const adapterClient = {
    announcements: async () => {
      callCount++;
      return {
        result: { announcements: [{ type: "Test", message: "msg", id: "dup-1", timestamp: "now" }] }
      };
    }
  };

  const bridge = createAnnouncementBridge({ adapterClient, client, channelId: "x" });
  bridge.start(30);
  await new Promise((r) => setTimeout(r, 120));
  bridge.stop();
  assert.ok(callCount >= 2);
  assert.equal(sent.length, 1);
});

test("announcement bridge handles adapter errors gracefully", async () => {
  const errors = [];
  const client = { channels: { fetch: async () => ({ isTextBased: () => true, send: async () => {} }) } };
  const adapterClient = {
    announcements: async () => { throw new Error("adapter down"); }
  };

  const bridge = createAnnouncementBridge({
    adapterClient, client, channelId: "x",
    onError: (e) => errors.push(e)
  });
  bridge.start(30);
  await new Promise((r) => setTimeout(r, 80));
  bridge.stop();
  assert.ok(errors.length >= 1);
});
