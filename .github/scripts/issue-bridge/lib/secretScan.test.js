import assert from "node:assert/strict";
import { test } from "node:test";
import { scanForSensitiveContent } from "./secretScan.mjs";

test("SEC-004: blocks the exact spec example (ghp_ token)", () => {
  const result = scanForSensitiveContent("/public\nToken: ghp_example123456789");
  assert.equal(result.blocked, true);
  assert.ok(result.categories.includes("github-pat"));
});

test("does not echo the matched secret anywhere in the result", () => {
  const result = scanForSensitiveContent("Token: ghp_example123456789");
  assert.equal(JSON.stringify(result).includes("ghp_example123456789"), false);
});

test("detects a github fine-grained PAT", () => {
  const token = "github_pat_" + "a".repeat(22) + "_" + "b".repeat(59);
  const result = scanForSensitiveContent(`here: ${token}`);
  assert.ok(result.categories.includes("github-fine-grained-pat"));
});

test("detects a JWT", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQ-abc123XYZ";
  const result = scanForSensitiveContent(`session: ${jwt}`);
  assert.ok(result.categories.includes("jwt"));
});

test("detects a PEM private key header", () => {
  const result = scanForSensitiveContent("-----BEGIN RSA PRIVATE KEY-----\nMIIE...");
  assert.ok(result.categories.includes("pem-private-key"));
});

test("detects an AWS access key id", () => {
  const result = scanForSensitiveContent("key is AKIAABCDEFGHIJKLMNOP for prod");
  assert.ok(result.categories.includes("aws-access-key-id"));
});

test("detects a bearer token", () => {
  const result = scanForSensitiveContent("curl -H 'Authorization: Bearer abcdef1234567890xyz'");
  assert.ok(result.categories.includes("bearer-token"));
  assert.ok(result.categories.includes("authorization-header"));
});

test("detects a cookie/session assignment", () => {
  const result = scanForSensitiveContent("Set-Cookie: connect.sid=s%3Aabc123.def; Path=/");
  assert.ok(result.categories.includes("cookie-or-session-token"));
});

test("detects credentials embedded in a URL", () => {
  const result = scanForSensitiveContent("see https://admin:hunter2@internal-host/dashboard");
  assert.ok(result.categories.includes("credentials-in-url"));
});

test("detects a generic secret-looking assignment", () => {
  const result = scanForSensitiveContent('DUNE_DISCORD_ADAPTER_TOKEN="sk_live_9f8e7d6c5b4a3210"');
  assert.ok(result.categories.includes("generic-secret-assignment"));
});

test("does not flag an obvious placeholder secret assignment", () => {
  const result = scanForSensitiveContent("token: CHANGEME");
  assert.equal(result.categories.includes("generic-secret-assignment"), false);
});

test("configurable: detects RFC1918 addresses when enabled (default)", () => {
  const result = scanForSensitiveContent("connect to 192.168.1.50 for the console");
  assert.ok(result.categories.includes("rfc1918-address"));
});

test("configurable: RFC1918/internal checks can be disabled", () => {
  const result = scanForSensitiveContent("connect to 192.168.1.50", { configurable: false });
  assert.equal(result.blocked, false);
});

test("configurable: detects an internal DNS-style hostname", () => {
  const result = scanForSensitiveContent("ssh to bot-host.internal for logs");
  assert.ok(result.categories.includes("internal-dns-name"));
});

test("configurable: detects a local filesystem path", () => {
  const result = scanForSensitiveContent("check /root/.env for the value");
  assert.ok(result.categories.includes("local-filesystem-path"));
});

test("configurable: detects a node.js-style internal stack trace", () => {
  const result = scanForSensitiveContent("Error: boom\n    at Object.<anonymous> (/root/projects/repos/arrakis-control-panel/src/index.js:42:11)");
  assert.ok(result.categories.includes("internal-stack-trace"));
});

test("SEC-016: flags a private repository attachment URL", () => {
  const result = scanForSensitiveContent(
    "See https://github.com/yacketrj/arrakis-control-panel/files/1234/private-file.log",
    { privateRepoSlugs: ["yacketrj/arrakis-control-panel"] }
  );
  assert.ok(result.categories.includes("private-repository-attachment"));
});

test("flags a bare private repository URL", () => {
  const result = scanForSensitiveContent("see github.com/yacketrj/arrakis-control-panel for the source", {
    privateRepoSlugs: ["yacketrj/arrakis-control-panel"]
  });
  assert.ok(result.categories.includes("private-repository-url"));
});

test("clean, ordinary engineering update produces no findings", () => {
  const result = scanForSensitiveContent(
    "We reproduced the issue and identified the affected readiness path. A fix is currently being tested."
  );
  assert.deepEqual(result, { blocked: false, categories: [] });
});

test("handles empty/non-string input safely", () => {
  assert.deepEqual(scanForSensitiveContent(""), { blocked: false, categories: [] });
  assert.deepEqual(scanForSensitiveContent(null), { blocked: false, categories: [] });
  assert.deepEqual(scanForSensitiveContent(undefined), { blocked: false, categories: [] });
});

test("categories are de-duplicated and sorted", () => {
  const result = scanForSensitiveContent("ghp_aaaaaaaaaaaaaaaaaaaa and ghp_bbbbbbbbbbbbbbbbbbbb");
  assert.deepEqual(result.categories, [...result.categories].sort());
  assert.equal(result.categories.filter((c) => c === "github-pat").length, 1);
});
