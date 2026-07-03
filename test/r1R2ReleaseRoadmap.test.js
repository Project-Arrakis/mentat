import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("R1/R2 roadmap defines cadence without calendar-driven release permission", async () => {
  const roadmap = await readFile("docs/r1-r2-release-roadmap.md", "utf8");

  assert.match(roadmap, /Cadence is a planning tool, not permission to release/);
  assert.match(roadmap, /Every 4 to 6 weeks/);
  assert.match(roadmap, /Every 6 to 8 weeks or slower/);
  assert.match(roadmap, /Security patch/);
  assert.match(roadmap, /Upstream compatibility patch/);
});

test("R1 roadmap stays read-only and blocks write behavior", async () => {
  const roadmap = await readFile("docs/r1-r2-release-roadmap.md", "utf8");
  const normalized = roadmap.replace(/\s+/g, " ");

  assert.match(roadmap, /R1\.x is for read-only production maturity/);
  assert.match(normalized, /must not add commands that mutate server state/);
  assert.match(roadmap, /write-specific Discord commands/);
  assert.match(roadmap, /database mutation/);
  assert.match(roadmap, /shell execution from the bot/);
});

test("R2 entry criteria require upstream contract and security evidence", async () => {
  const roadmap = await readFile("docs/r1-r2-release-roadmap.md", "utf8");

  for (const required of [
    "upstream publishes and approves a write-capable Discord adapter contract",
    "Write routes are separate from read-only routes and disabled by default",
    "Capability discovery advertises write actions",
    "A fresh STRIDE and abuse-case review is recorded",
    "No medium, high, or critical finding is unresolved"
  ]) {
    assert.match(roadmap, new RegExp(escapeRegExp(required), "i"), required);
  }
});

test("R2 roadmap starts with foundation and low-risk writes", async () => {
  const roadmap = await readFile("docs/r1-r2-release-roadmap.md", "utf8");

  assert.match(roadmap, /R2\.0\.0-rc\.1/);
  assert.match(roadmap, /No executable write command required/);
  assert.match(roadmap, /Maintenance metadata writes/);
  assert.match(roadmap, /Discord notification configuration writes/);
  assert.match(roadmap, /service restart as the first write command/);
  assert.match(roadmap, /player moderation/);
});

test("R1/R2 roadmap links from core planning docs", async () => {
  for (const file of [
    "README.md",
    "docs/full-release-roadmap.md",
    "docs/production-release-plan.md",
    "docs/non-readonly-roadmap.md",
    "docs/roadmap.md"
  ]) {
    const content = await readFile(file, "utf8");
    assert.match(content, /docs\/r1-r2-release-roadmap\.md/, file);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
