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

test("requireProxySecret: an exempt path is never gated, even with the wrong/no header", async () => {
  process.env.MENTAT_PROXY_SHARED_SECRET = "supersecret";
  try {
    const app = withApp({ exemptPaths: ["/api/alerts/relay"] });
    const { status } = await request(app, "POST", "/api/alerts/relay");
    assert.equal(status, 200, "/api/alerts/relay has its own bearer-token auth and must not require this header too");
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
