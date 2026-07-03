import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const checklistPath = "docs/v1.0.0-promotion-checklist.md";

test("v1.0.0 promotion checklist records completed candidate evidence", async () => {
  const checklist = await readFile(checklistPath, "utf8");

  for (const required of [
    "v1.0.0-rc.1",
    "stable `v1.0.0`",
    "PR #40",
    "28635077937",
    "docs/release-evidence/v1.0.0-rc.1.md",
    "docs/security-review-2026-07-03.md",
    "5163bd8",
    "v1.3.41"
  ]) {
    assert.match(checklist, new RegExp(escapeRegExp(required)), required);
  }
});

test("v1.0.0 promotion checklist names operator-owned gates", async () => {
  const checklist = await readFile(checklistPath, "utf8");

  for (const required of [
    "Test-guild command registration",
    "Live private WebUI adapter smoke",
    "Runtime Discord command smoke",
    "Docker start and healthcheck",
    "Owner go/no-go",
    "approved deferral"
  ]) {
    assert.match(checklist, new RegExp(escapeRegExp(required)), required);
  }
});

test("v1.0.0 promotion checklist blocks unsafe stable promotion", async () => {
  const checklist = await readFile(checklistPath, "utf8");
  const normalized = checklist.replace(/\s+/g, " ");

  assert.match(normalized, /no-go if any of these are true/i);
  assert.match(normalized, /any medium, high, or critical security finding is unresolved/i);
  assert.match(normalized, /redaction tests fail or smoke reveals secrets or PII/i);
  assert.match(normalized, /owner go\/no-go is missing/i);
  assert.match(checklist, /Do not use this checklist to approve any\s+write-capable command/);
});

test("stable promotion checklist is linked from release planning docs", async () => {
  for (const file of ["README.md", "docs/roadmap.md", "docs/production-release-plan.md"]) {
    const content = await readFile(file, "utf8");
    assert.match(content, new RegExp(escapeRegExp(checklistPath)), file);
  }
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
