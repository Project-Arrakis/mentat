import assert from "node:assert/strict";
import { test } from "node:test";
import { GitHubClient } from "./ghApi.mjs";
import { ErrorClass } from "./errors.mjs";

function jsonResponse(status, body, headers = {}) {
  const h = new Map(Object.entries(headers));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => h.get(k.toLowerCase()) ?? null },
    text: async () => JSON.stringify(body),
    json: async () => body
  };
}

function fakeSleep(calls) {
  return async (ms) => {
    calls.push(ms);
  };
}

test("performs an authenticated GET and returns parsed JSON", async () => {
  const calls = [];
  const client = new GitHubClient({
    getToken: async () => "test-token-abc",
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return jsonResponse(200, { ok: true });
    }
  });

  const result = await client.get("/repos/yacketrj/acp-discordbot/issues/1");
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.headers.Authorization, "Bearer test-token-abc");
  assert.equal(calls[0].url, "https://api.github.com/repos/yacketrj/acp-discordbot/issues/1");
});

test("retries transient 502s with backoff, then succeeds", async () => {
  const sleeps = [];
  let attempts = 0;
  const client = new GitHubClient({
    getToken: async () => "t",
    sleepImpl: fakeSleep(sleeps),
    backoffMs: [10, 20, 30],
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) return jsonResponse(502, { message: "bad gateway" });
      return jsonResponse(200, { done: true });
    }
  });

  const result = await client.get("/x");
  assert.deepEqual(result, { done: true });
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [10, 20]);
});

test("honors Retry-After header on 429 instead of default backoff", async () => {
  const sleeps = [];
  let attempts = 0;
  const client = new GitHubClient({
    getToken: async () => "t",
    sleepImpl: fakeSleep(sleeps),
    backoffMs: [10, 20, 30],
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return jsonResponse(429, { message: "rate limited" }, { "retry-after": "3" });
      return jsonResponse(200, { done: true });
    }
  });

  await client.get("/x");
  assert.deepEqual(sleeps, [3000]);
});

test("gives up after exhausting retries and throws a classified TRANSIENT error", async () => {
  const sleeps = [];
  const client = new GitHubClient({
    getToken: async () => "t",
    sleepImpl: fakeSleep(sleeps),
    backoffMs: [1, 1],
    fetchImpl: async () => jsonResponse(503, { message: "unavailable" })
  });

  await assert.rejects(
    () => client.get("/x"),
    (err) => {
      assert.equal(err.errorClass, ErrorClass.TRANSIENT);
      return true;
    }
  );
  assert.equal(sleeps.length, 2);
});

test("does not retry a permanent 403 and classifies it AUTHORIZATION", async () => {
  let attempts = 0;
  const client = new GitHubClient({
    getToken: async () => "secret-token-value",
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse(403, { message: "forbidden" });
    }
  });

  await assert.rejects(
    () => client.get("/x"),
    (err) => {
      assert.equal(err.errorClass, ErrorClass.AUTHORIZATION);
      assert.equal(JSON.stringify(err.details).includes("secret-token-value"), false);
      return true;
    }
  );
  assert.equal(attempts, 1);
});

test("classifies a rate-limited 403 (secondary limit) as RATE_LIMIT and retries", async () => {
  let attempts = 0;
  const sleeps = [];
  const client = new GitHubClient({
    getToken: async () => "t",
    sleepImpl: fakeSleep(sleeps),
    backoffMs: [5],
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return jsonResponse(403, { message: "secondary rate limit" }, { "x-ratelimit-remaining": "0" });
      return jsonResponse(200, { ok: true });
    }
  });

  const result = await client.get("/x");
  assert.deepEqual(result, { ok: true });
  assert.equal(attempts, 2);
});

test("never includes the raw token in a thrown error", async () => {
  const client = new GitHubClient({
    getToken: async () => "TOP-SECRET-TOKEN",
    fetchImpl: async () => jsonResponse(401, { message: "bad credentials" })
  });

  try {
    await client.get("/x");
    assert.fail("expected rejection");
  } catch (err) {
    assert.equal(JSON.stringify(err.details).includes("TOP-SECRET-TOKEN"), false);
    assert.equal(err.message.includes("TOP-SECRET-TOKEN"), false);
  }
});

test("removeLabel swallows a 404 (label already absent)", async () => {
  const client = new GitHubClient({
    getToken: async () => "t",
    fetchImpl: async () => jsonResponse(404, { message: "not found" })
  });
  const result = await client.removeLabel("o/r", 1, "sync:paused");
  assert.equal(result, null);
});

test("createIssue posts the expected body", async () => {
  let captured;
  const client = new GitHubClient({
    getToken: async () => "t",
    fetchImpl: async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body) };
      return jsonResponse(201, { number: 52 });
    }
  });
  const result = await client.createIssue("yacketrj/arrakis-control-panel", {
    title: "[PUBLIC #52] test",
    body: "body",
    labels: ["source:public"]
  });
  assert.equal(result.number, 52);
  assert.equal(captured.url, "https://api.github.com/repos/yacketrj/arrakis-control-panel/issues");
  assert.deepEqual(captured.body, { title: "[PUBLIC #52] test", body: "body", labels: ["source:public"] });
});

test("searchIssues URL-encodes the query", async () => {
  let capturedUrl;
  const client = new GitHubClient({
    getToken: async () => "t",
    fetchImpl: async (url) => {
      capturedUrl = url;
      return jsonResponse(200, { items: [] });
    }
  });
  await client.searchIssues('repo:a/b "sync_id: ACP-PUBLIC-52" in:body');
  assert.equal(capturedUrl.includes(encodeURIComponent('repo:a/b "sync_id: ACP-PUBLIC-52" in:body')), true);
});
