import assert from "node:assert/strict";
import { test } from "node:test";
import { createSetupServer } from "../src/setupServer.js";

// ─── Issue #91: the bare domain root previously fell through to
// Express's default "Cannot GET /" error page. A real landing page now
// exists at "/" -- these tests pin that behavior so a future refactor
// can't silently re-expose the error page. ─────────────────────────────

function makeSetupApp() {
  return createSetupServer({
    dbPath: ":memory:",
    discordClientId: "client-id",
    baseUrl: "http://localhost:3100"
  });
}

async function withApp(fn) {
  const app = makeSetupApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("GET / returns a friendly landing page, not Express's default 404", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes("Arrakis Control Panel"), "should title the landing page");
    assert.ok(!html.includes("Cannot GET /"), "must not be the Express default error page");
  });
});

test("GET / links to the setup flow", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/`);
    const html = await res.text();
    assert.ok(html.includes('href="/setup"'), "should link to /setup");
  });
});

test("GET /health is unaffected by the new root route", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
  });
});
