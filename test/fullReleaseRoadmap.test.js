import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("full release roadmap keeps R1 scoped to read-only production", async () => {
  const roadmap = await readFile("docs/full-release-roadmap.md", "utf8");

  assert.match(roadmap, /`R1\.0\.0` is the production-ready read-only bot/);
  assert.match(roadmap, /write-capable commands/i);
  assert.match(roadmap, /Excluded:/);
  assert.match(roadmap, /service restarts/);
  assert.match(roadmap, /database mutations/);
});

test("full release roadmap defines later major trains for write capability", async () => {
  const roadmap = await readFile("docs/full-release-roadmap.md", "utf8");

  for (const train of ["R2.0.0", "R3.0.0", "R4.0.0"]) {
    assert.match(roadmap, new RegExp(escapeRegExp(train)), train);
  }

  assert.match(roadmap, /Write-Safety Foundation/);
  assert.match(roadmap, /Low-Risk Administrative Writes/);
  assert.match(roadmap, /Operational Writes/);
  assert.match(roadmap, /Highest-Risk Operations/);
});

test("full release roadmap requires security and release gates", async () => {
  const roadmap = await readFile("docs/full-release-roadmap.md", "utf8");

  for (const required of [
    "npm run check",
    "npm audit --audit-level=moderate",
    "secret scan",
    "Semgrep",
    "Trivy filesystem",
    "Trivy image",
    "dependency review",
    "SBOM",
    "checksum",
    "STRIDE",
    "no unresolved medium, high, or critical"
  ]) {
    assert.match(roadmap, new RegExp(escapeRegExp(required), "i"), required);
  }
});

test("full release roadmap blocks writes without upstream contract and controls", async () => {
  const roadmap = await readFile("docs/full-release-roadmap.md", "utf8");

  assert.match(roadmap, /upstream publishes and approves a write-capable adapter contract/i);
  assert.match(roadmap, /write routes disabled by default/i);
  assert.match(roadmap, /observer roles do not inherit/i);
  assert.match(roadmap, /confirmation cannot be bypassed/i);
  assert.match(roadmap, /idempotency is tested/i);
});

test("core roadmap documents link the full release roadmap", async () => {
  for (const file of [
    "README.md",
    "docs/production-release-plan.md",
    "docs/non-readonly-roadmap.md",
    "docs/roadmap.md"
  ]) {
    const content = await readFile(file, "utf8");
    assert.match(content, /docs\/full-release-roadmap\.md/, file);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
