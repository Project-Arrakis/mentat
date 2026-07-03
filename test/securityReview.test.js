import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const latestReview = "docs/security-review-2026-07-03.md";

test("latest security review records current read-only evidence", async () => {
  const review = await readFile(latestReview, "utf8");

  for (const required of [
    "390a343716cba2b4d72fc16695e0581c08608ef7",
    "5163bd83bff5b8c04b1b5dfb973d0675165686ca",
    "v1.3.41",
    "PR #38",
    "77 tests",
    "0 vulnerabilities",
    "npm run smoke:adapter",
    "No unresolved medium, high, or critical security finding"
  ]) {
    assert.match(review, new RegExp(escapeRegExp(required)), required);
  }
});

test("latest security review keeps STRIDE coverage explicit", async () => {
  const review = await readFile(latestReview, "utf8");

  for (const category of [
    "Spoofing",
    "Tampering",
    "Repudiation",
    "Information disclosure",
    "Denial of service",
    "Elevation of privilege"
  ]) {
    assert.match(review, new RegExp(escapeRegExp(category)), category);
  }
});

test("latest security review records privacy and SOC 2 limits", async () => {
  const review = await readFile(latestReview, "utf8");

  for (const required of [
    "emails",
    "SteamID",
    "Funcom",
    "real-name",
    "payment-card",
    "Minimal actor context",
    "not SOC 2 compliant",
    "certified by itself",
    "Security",
    "Availability",
    "Processing integrity",
    "Confidentiality",
    "Privacy"
  ]) {
    assert.match(review, new RegExp(escapeRegExp(required), "i"), required);
  }
});

test("current readiness docs link the latest security review", async () => {
  const files = [
    "README.md",
    "SECURITY.md",
    "docs/public-readiness.md",
    "docs/changes/PR-0039-readonly-security-readiness.md"
  ];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    assert.match(content, new RegExp(escapeRegExp(latestReview)), file);
  }

  const index = await readFile("docs/changes/README.md", "utf8");
  assert.match(index, /PR-0039/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
