// consoleUrlValidation.test.js -- direct unit tests for validateConsoleUrl(),
// the SSRF-prevention check mentat#328 found wired into only one of its
// three real call sites (the /setup portal path) despite the other two
// (consoleRegistration.js's verifyAndRegisterConsole(), autoInvite.js's
// stageAutoInviteSession()) sharing the exact same risk. This function
// itself had zero direct test coverage before this file -- every existing
// test exercised it only indirectly, through setupServer.js's HTTP routes.
import assert from "node:assert/strict";
import test from "node:test";
import { validateConsoleUrl } from "../src/consoleUrlValidation.js";

async function publicLookupImpl() {
  return [{ address: "203.0.113.10", family: 4 }];
}

test("accepts a well-formed https:// URL resolving to a public address", async () => {
  await assert.doesNotReject(validateConsoleUrl("https://console.example.com", { lookupImpl: publicLookupImpl }));
});

test("rejects a non-string/empty consoleUrl", async () => {
  await assert.rejects(validateConsoleUrl(undefined), /required/);
  await assert.rejects(validateConsoleUrl(""), /required/);
  await assert.rejects(validateConsoleUrl("   "), /required/);
});

test("rejects a malformed URL", async () => {
  await assert.rejects(validateConsoleUrl("not a url at all"), /valid URL/);
});

test("rejects a non-https scheme", async () => {
  await assert.rejects(validateConsoleUrl("http://console.example.com"), /https/);
  await assert.rejects(validateConsoleUrl("ftp://console.example.com"), /https/);
});

test("rejects a literal IPv4 address in each disallowed range", async () => {
  const disallowed = [
    "https://127.0.0.1",       // loopback
    "https://10.0.0.5",        // RFC 1918
    "https://172.16.0.5",      // RFC 1918
    "https://192.168.1.5",     // RFC 1918
    "https://169.254.169.254", // link-local / cloud metadata
    "https://100.64.0.5",      // RFC 6598 carrier-grade NAT
    "https://224.0.0.1"        // multicast
  ];
  for (const url of disallowed) {
    await assert.rejects(validateConsoleUrl(url), `${url} must be rejected`);
  }
});

test("accepts a literal public IPv4 address", async () => {
  await assert.doesNotReject(validateConsoleUrl("https://203.0.113.10"));
});

test("rejects a literal localhost hostname", async () => {
  await assert.rejects(validateConsoleUrl("https://localhost"), /localhost/);
});

// Layer 2 audit finding (Security Architect hat): this test previously
// passed for the wrong reason -- URL.hostname keeps the brackets on an
// IPv6 literal ("[::1]"), which net.isIP() doesn't accept, so the
// intended literal-IP fast path never fired and these were actually
// rejected via a real DNS lookup throwing ENOTFOUND, not the loopback/
// link-local range check. Asserting the specific message (not just
// `rejects()` with no check) proves the fast path itself is what's
// rejecting these, not an accidental DNS failure -- and doing it with NO
// lookupImpl override proves no DNS lookup happens at all for a literal
// IP, matching the accept-case test below.
test("rejects IPv6 loopback and link-local literals via the literal-IP fast path, not an accidental DNS failure", async () => {
  await assert.rejects(validateConsoleUrl("https://[::1]"), /private, loopback, or link-local/);
  await assert.rejects(validateConsoleUrl("https://[fe80::1]"), /private, loopback, or link-local/);
  await assert.rejects(validateConsoleUrl("https://[fc00::1]"), /private, loopback, or link-local/);
});

test("accepts a literal public IPv6 address (regression lock for the bracket-stripping fix)", async () => {
  await assert.doesNotReject(validateConsoleUrl("https://[2001:db8::1]"));
});

test("rejects a hostname that resolves to a disallowed address, even though the hostname itself looks innocuous", async () => {
  const lookupImpl = async () => ([{ address: "169.254.169.254", family: 4 }]);
  await assert.rejects(validateConsoleUrl("https://attacker-controlled-hostname.test", { lookupImpl }), /private, loopback, or link-local/);
});

test("rejects if ANY resolved address is disallowed, even when another is public -- a DNS response can carry multiple records", async () => {
  const lookupImpl = async () => ([
    { address: "203.0.113.10", family: 4 },
    { address: "127.0.0.1", family: 4 }
  ]);
  await assert.rejects(validateConsoleUrl("https://mixed-records.test", { lookupImpl }));
});

test("rejects a hostname that fails to resolve at all", async () => {
  const lookupImpl = async () => { throw new Error("ENOTFOUND"); };
  await assert.rejects(validateConsoleUrl("https://does-not-resolve.test", { lookupImpl }), /could not be resolved/);
});

test("rejects a hostname that resolves to zero addresses", async () => {
  const lookupImpl = async () => ([]);
  await assert.rejects(validateConsoleUrl("https://no-records.test", { lookupImpl }));
});
