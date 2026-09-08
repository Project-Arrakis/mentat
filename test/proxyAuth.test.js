// mentat-link#121: the shared-secret gate between mentat-link's reverse
// proxy and this bot's setup/steam-link servers. See
// src/proxyAuth.js and the matching mentat-link fix
// (functions/_lib/reverseProxy.js) for the two halves of this control.
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { proxySharedSecret, requireProxySecret } from "../src/proxyAuth.js";

function withApp(middlewareOpts) {
  const app = express();
  app.use(requireProxySecret(middlewareOpts));
  app.get("/setup", (req, res) => res.json({ ok: true }));
  app.post("/api/alerts/relay", (req, res) => res.json({ ok: true }));
  return app;
}

function request(app, method, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers })
        .then((res) => res.json().then((body) => ({ status: res.status, body })))
        .then((result) => server.close(() => resolve(result)))
        .catch((err) => server.close(() => reject(err)));
    });
  });
}

test("proxySharedSecret: returns empty string when unset (fail-open, two-phase rollout)", () => {
  assert.equal(proxySharedSecret({}), "");
});

test("proxySharedSecret: a direct MENTAT_PROXY_SHARED_SECRET value wins", () => {
  assert.equal(proxySharedSecret({ MENTAT_PROXY_SHARED_SECRET: "abc123" }), "abc123");
});

test("proxySharedSecret: reads from MENTAT_PROXY_SHARED_SECRET_FILE when the direct value is unset", () => {
  const file = join(tmpdir(), `proxy-secret-test-${process.pid}.txt`);
  writeFileSync(file, "from-file-secret\n");
  try {
    assert.equal(proxySharedSecret({ MENTAT_PROXY_SHARED_SECRET_FILE: file }), "from-file-secret");
  } finally {
    unlinkSync(file);
  }
});

test("proxySharedSecret: direct value takes precedence over the _FILE variant", () => {
  const file = join(tmpdir(), `proxy-secret-test-precedence-${process.pid}.txt`);
  writeFileSync(file, "file-value");
  try {
    assert.equal(
      proxySharedSecret({ MENTAT_PROXY_SHARED_SECRET: "direct-value", MENTAT_PROXY_SHARED_SECRET_FILE: file }),
      "direct-value"
    );
  } finally {
    unlinkSync(file);
  }
});

test("requireProxySecret: allows every request when no secret is configured (fail-open before rollout)", async () => {
  delete process.env.MENTAT_PROXY_SHARED_SECRET;
  const app = withApp();
  const { status } = await request(app, "GET", "/setup");
  assert.equal(status, 200);
});

test("requireProxySecret: rejects a request with no header once a secret is configured", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp();
    const { status, body } = await request(app, "GET", "/setup");
    assert.equal(status, 403);
    assert.match(body.error, /Forbidden/);
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("requireProxySecret: rejects a request with the wrong header value", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp();
    const { status } = await request(app, "GET", "/setup", { "x-mentat-proxy-secret": "wrong" });
    assert.equal(status, 403);
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("requireProxySecret: rejection JSON body includes the actionable misconfiguration message, not the old dead-end text", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp();
    const { body } = await request(app, "GET", "/setup");
    assert.match(body.detail, /MENTAT_PROXY_SHARED_SECRET/, "must give the operator something actionable, not just 'must be accessed via...'");
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

// mentat#283 (UI/UX hat finding): a browser navigation (Accept: text/html)
// hitting this gate mid-misconfiguration must not see a raw JSON blob --
// it should get the same rendered error page every other error on this
// server uses. Uses a real renderError callback (matching the shape
// setupServer.js/steamLinkServer.js's own errorPage() functions share),
// not a mock that could hide a signature mismatch.
test("requireProxySecret: a browser (Accept: text/html) request gets a rendered page via renderError, not raw JSON", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const renderError = (res, status, title, message) =>
      res.status(status).type("html").send(`<html><body><h1>${title}</h1><p>${message}</p></body></html>`);
    const app = withApp({ renderError });
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const address = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${address.port}/setup`, {
        headers: { Accept: "text/html" },
      });
      assert.equal(res.status, 403);
      assert.match(res.headers.get("content-type"), /text\/html/);
      const text = await res.text();
      assert.match(text, /Access Blocked/);
      assert.match(text, /MENTAT_PROXY_SHARED_SECRET/);
    } finally {
      server.close();
    }
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("requireProxySecret: an API caller (Accept: application/json) still gets JSON even when renderError is configured", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const renderError = () => {
      throw new Error("renderError must not be called for a JSON-only request");
    };
    const app = withApp({ renderError });
    const { status, body } = await request(app, "GET", "/setup", { Accept: "application/json" });
    assert.equal(status, 403);
    assert.equal(body.error, "Forbidden");
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("requireProxySecret: accepts a request with the correct header value", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp();
    const { status, body } = await request(app, "GET", "/setup", { "x-mentat-proxy-secret": "supersecret" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("requireProxySecret: an exempt path is never gated with no header", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp({ exemptPaths: ["/api/alerts/relay"] });
    const { status } = await request(app, "POST", "/api/alerts/relay");
    assert.equal(status, 200, "/api/alerts/relay has its own bearer-token auth and must not require this header too");
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

// mentat#283 (QA hat finding): the test above only ever sent NO header at
// all -- it never proved a WRONG header is also let through on an exempt
// path, despite its original title claiming "even with the wrong/no
// header". Exemption short-circuits before secretMatches() runs at all, so
// this should pass trivially, but "should" isn't "verified" -- this test
// makes that explicit rather than assumed.
test("requireProxySecret: an exempt path is never gated with a wrong header either", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp({ exemptPaths: ["/api/alerts/relay"] });
    const { status } = await request(app, "POST", "/api/alerts/relay", { "x-mentat-proxy-secret": "wrong" });
    assert.equal(status, 200);
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

// mentat#283 (QA hat finding): the real operationally-dangerous case isn't
// "no secret configured anywhere" (already covered above) -- it's a
// mismatched ROLLOUT: this side has been given a secret but the caller
// hasn't (or has a different one). Named explicitly so a future reader
// sees this is the outage scenario Requirement 0's "test the update path"
// doctrine cares about, not just an equivalent-looking unit case.
test("requireProxySecret: mismatched rollout state (this side configured, caller has no header) is rejected, not silently allowed", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "backend-is-configured";
  try {
    const app = withApp();
    const { status } = await request(app, "GET", "/setup");
    assert.equal(status, 403, "a caller that hasn't been given the secret yet must be rejected, not let through");
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});

test("requireProxySecret: a non-exempt path is still gated even when a different path is exempted", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp({ exemptPaths: ["/api/alerts/relay"] });
    const { status } = await request(app, "GET", "/setup");
    assert.equal(status, 403);
  } finally {
    delete process.env.MENTAT_PROXY_SHARED_SECRET;
  }
});
