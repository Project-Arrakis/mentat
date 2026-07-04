import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCsv, startScheduler } from "../src/scheduler.js";

test("parseCsv splits comma-separated values", () => {
  assert.deepEqual(parseCsv("a,b,c"), ["a", "b", "c"]);
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("  x  ,  y  "), ["x", "y"]);
});

test("startScheduler returns inactive when disabled", () => {
  const scheduler = startScheduler({ client: { channels: { fetch: async () => null } } });
  assert.equal(scheduler.active, false);
  assert.equal(scheduler.reason, "disabled");
});

test("startScheduler returns inactive with empty channels", () => {
  const oldEnv = process.env.DUNE_POST_ALLOWED_CHANNELS;
  const oldType = process.env.DUNE_POST_SCHEDULE_TYPE;
  process.env.DUNE_POST_ALLOWED_CHANNELS = "";
  process.env.DUNE_POST_SCHEDULE_TYPE = "status";
  try {
    const scheduler = startScheduler({ client: { channels: { fetch: async () => null } } });
    assert.equal(scheduler.active, false);
  } finally {
    process.env.DUNE_POST_ALLOWED_CHANNELS = oldEnv;
    process.env.DUNE_POST_SCHEDULE_TYPE = oldType;
  }
});

test("default actor uses scheduler identifier", async () => {
  const oldCh = process.env.DUNE_POST_ALLOWED_CHANNELS;
  const oldType = process.env.DUNE_POST_SCHEDULE_TYPE;
  process.env.DUNE_POST_ALLOWED_CHANNELS = "1";
  process.env.DUNE_POST_SCHEDULE_TYPE = "status-summary";
  const fetchCalls = [];
  try {
    const client = {
      channels: {
        fetch: async (id) => {
          fetchCalls.push({ id });
          return { isTextBased: () => true, send: async (content) => {
            assert.ok(content.includes("Scheduled Status Summary"));
          }};
        }
      }
    };
    const adapterClient = {
      status: async (actor) => {
        assert.equal(actor.userId, "scheduler");
        return { ok: true, result: { summary: { overall: "OK", region: "us", mode: "pve" } } };
      }
    };
    const scheduler = startScheduler({ client, adapterClient, intervalMs: 100 });
    scheduler.stop();
  } finally {
    process.env.DUNE_POST_ALLOWED_CHANNELS = oldCh;
    process.env.DUNE_POST_SCHEDULE_TYPE = oldType;
  }
});
