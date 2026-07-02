import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("production release plan records the release train baseline and target", async () => {
  const plan = await readFile("docs/production-release-plan.md", "utf8");

  assert.match(plan, /\bR0\.1\.5\b/);
  assert.match(plan, /\bR1\.0\.0\b/);
  assert.match(plan, /\bv1\.0\.0\b/);
  assert.match(plan, /\bv0\.1\.1\b/);
  assert.match(plan, /read-only Discord bot/);
});

test("release process distinguishes roadmap labels from SemVer tags", async () => {
  const process = await readFile("docs/release-process.md", "utf8");

  assert.match(process, /RMAJOR\.MINOR\.PATCH/);
  assert.match(process, /vMAJOR\.MINOR\.PATCH/);
  assert.match(process, /current planning baseline is `R0\.1\.5`/);
});

test("production release plan keeps security gates non-negotiable", async () => {
  const plan = await readFile("docs/production-release-plan.md", "utf8");

  for (const required of [
    "npm audit --audit-level=moderate",
    "secret scan",
    "Semgrep",
    "Trivy filesystem",
    "Trivy image",
    "dependency review",
    "SBOM",
    "checksums",
    "STRIDE"
  ]) {
    assert.match(plan, new RegExp(escapeRegExp(required), "i"), required);
  }

  assert.match(plan, /No stable release ships with unresolved medium, high, or critical security/);
});

test("production release plan keeps write-capable work out of R1.0.0 by default", async () => {
  const plan = await readFile("docs/production-release-plan.md", "utf8");
  const normalized = plan.replace(/\s+/g, " ");

  assert.match(normalized, /Write-capable commands remain out of scope for `R1\.0\.0`/);
  assert.match(plan, /upstream must publish and approve a write-capable adapter contract/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
