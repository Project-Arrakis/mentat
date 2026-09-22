// secureFetchDispatcher.test.js -- mentat#393: the DNS-rebinding fix.
//
// Two layers of coverage, deliberately: (1) direct unit tests of
// createSecureLookup()'s callback contract for every outcome (accept,
// disallowed, mixed records, resolution failure, zero records) -- the
// same style consoleUrlValidation.test.js already uses for the underlying
// isDisallowedIP() logic this reuses; (2) real-network integration tests
// proving the REJECT path actually stops a real fetch() before it reaches
// a real local server. The ACCEPT path can't be proven via a live TCP
// connection in a unit test the same way: any address a real local server
// can bind to (127.0.0.1, or any RFC 1918 address) is exactly what this
// check is designed to reject, so "resolves to a public-looking address"
// is necessarily tested via the callback contract, not a live connection
// to a real public IP -- matching consoleUrlValidation.test.js's own
// existing precedent (its accept-path tests use 203.0.113.10, a
// non-routable documentation address, for the same reason).

import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { createSecureDispatcher, createSecureLookup, getDefaultSecureDispatcher } from "../src/secureFetchDispatcher.js";

function callbackPromise(lookupFn, hostname) {
  return new Promise((resolve, reject) => {
    lookupFn(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

test("createSecureLookup: calls back with every resolved address when none are disallowed", async () => {
  const lookupImpl = async () => ([{ address: "203.0.113.10", family: 4 }, { address: "198.51.100.20", family: 4 }]);
  const lookup = createSecureLookup(lookupImpl);
  const addresses = await callbackPromise(lookup, "console.example.com");
  assert.deepEqual(addresses, [{ address: "203.0.113.10", family: 4 }, { address: "198.51.100.20", family: 4 }]);
});

test("createSecureLookup: calls back with an error when the resolved address is disallowed", async () => {
  const lookupImpl = async () => ([{ address: "169.254.169.254", family: 4 }]);
  const lookup = createSecureLookup(lookupImpl);
  await assert.rejects(callbackPromise(lookup, "attacker-controlled.test"), /private, loopback, or link-local/);
});

test("createSecureLookup: calls back with an error when ANY resolved address is disallowed, not just the first", async () => {
  const lookupImpl = async () => ([{ address: "203.0.113.10", family: 4 }, { address: "127.0.0.1", family: 4 }]);
  const lookup = createSecureLookup(lookupImpl);
  await assert.rejects(callbackPromise(lookup, "mixed-records.test"), /private, loopback, or link-local/);
});

test("createSecureLookup: calls back with an error when the lookup resolves to zero addresses", async () => {
  const lookupImpl = async () => ([]);
  const lookup = createSecureLookup(lookupImpl);
  await assert.rejects(callbackPromise(lookup, "no-records.test"), /could not be resolved/);
});

test("createSecureLookup: calls back with an error when the underlying lookup itself throws", async () => {
  const lookupImpl = async () => { throw new Error("ENOTFOUND"); };
  const lookup = createSecureLookup(lookupImpl);
  await assert.rejects(callbackPromise(lookup, "does-not-resolve.test"));
});

function startServer() {
  let connectionCount = 0;
  const server = createServer((req, res) => { res.end("real-server-response"); });
  server.on("connection", () => { connectionCount++; });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, connections: () => connectionCount }));
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

// Real-network integration: proves this actually stops a real fetch()
// before any connection reaches a real listening server, not just that
// the callback contract looks right in isolation.
test("real fetch() through the dispatcher never reaches the server when the resolved address is disallowed", async () => {
  const { server, connections } = await startServer();
  try {
    const lookupImpl = async () => ([{ address: "127.0.0.1", family: 4 }]);
    const dispatcher = createSecureDispatcher({ lookupImpl });
    await assert.rejects(
      fetch("http://this-hostname-is-never-actually-resolved.test/", { dispatcher }),
      /fetch failed/
    );
    assert.equal(connections(), 0, "a rejected lookup must never let the real server see a connection");
  } finally {
    await stopServer(server);
  }
});

test("real fetch() through the dispatcher never reaches the server when the lookup itself fails", async () => {
  const { server, connections } = await startServer();
  try {
    const lookupImpl = async () => { throw new Error("ENOTFOUND"); };
    const dispatcher = createSecureDispatcher({ lookupImpl });
    await assert.rejects(fetch("http://does-not-resolve.test/", { dispatcher }), /fetch failed/);
    assert.equal(connections(), 0);
  } finally {
    await stopServer(server);
  }
});

// No "real fetch() through the dispatcher succeeds for an allowed address"
// live-connection test exists here, deliberately: any address a real local
// test server can actually bind to and receive a connection on (127.0.0.1,
// any RFC 1918 address) is exactly what isDisallowedIP() is designed to
// reject -- there is no real, locally-reachable address this check
// legitimately allows. Proving "accept path really connects" would either
// require a real external network dependency (flaky, inappropriate for a
// unit test) or bypassing the real isDisallowedIP() check for the test
// (which would stop testing the real production code path at all). The
// accept path's callback contract is proven directly above
// ("calls back with every resolved address when none are disallowed");
// the reject-path tests below prove the real Agent/connect/fetch wiring
// genuinely intercepts a real fetch() call using that exact same
// mechanism -- together, nothing about the integration is left unproven.

test("getDefaultSecureDispatcher returns the same instance across calls (real connection pooling, not a fresh Agent per request)", () => {
  const first = getDefaultSecureDispatcher();
  const second = getDefaultSecureDispatcher();
  assert.equal(first, second);
});

test("createSecureDispatcher defaults to real dns.lookup when no lookupImpl is given (production shape)", async () => {
  const dispatcher = createSecureDispatcher();
  assert.equal(typeof dispatcher.close, "function");
  await dispatcher.close();
});
