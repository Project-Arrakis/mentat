import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startHealthState } from "../src/healthState.js";
import { checkHealthState } from "../src/healthcheck.js";

test("startHealthState writes readiness state and stop marker", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dune-health-"));
  const filePath = join(dir, "health.json");
  const errors = [];
  const healthState = startHealthState({
    filePath,
    intervalMs: 60000,
    onError: (error) => errors.push(error)
  });

  try {
    let state = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(state.ready, false);
    assert.equal(typeof state.updatedAt, "string");

    healthState.markReady();
    state = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(state.ready, true);
    assert.equal(typeof state.readyAt, "string");
    assert.equal(typeof state.pid, "number");

    healthState.stop();
    state = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(state.ready, false);
    assert.equal(state.stopping, true);
    assert.deepEqual(errors, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkHealthState accepts fresh ready state", () => {
  const now = Date.parse("2026-06-22T19:40:00.000Z");
  const state = checkHealthState({
    now: () => now,
    maxAgeMs: 120000,
    readFile: () => JSON.stringify({
      ready: true,
      updatedAt: new Date(now - 1000).toISOString()
    })
  });

  assert.equal(state.ready, true);
});

test("checkHealthState rejects not-ready stale or invalid state", () => {
  const now = Date.parse("2026-06-22T19:40:00.000Z");

  assert.throws(
    () => checkHealthState({
      now: () => now,
      readFile: () => JSON.stringify({ ready: false, updatedAt: new Date(now).toISOString() })
    }),
    /not ready/
  );

  assert.throws(
    () => checkHealthState({
      now: () => now,
      maxAgeMs: 120000,
      readFile: () => JSON.stringify({ ready: true, updatedAt: new Date(now - 180000).toISOString() })
    }),
    /stale/
  );

  assert.throws(
    () => checkHealthState({
      now: () => now,
      readFile: () => JSON.stringify({ ready: true, updatedAt: "nope" })
    }),
    /timestamp/
  );
});
