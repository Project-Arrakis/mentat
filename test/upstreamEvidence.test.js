import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Baseline advanced to upstream v1.3.79 (release commit d41f1270, tag
// ac8f086, released 2026-08-05) on 2026-08-06. The 2026-08-06 RO roadmap
// audit re-verified every Discord adapter route this bot calls against
// this tag (see docs/ro-roadmap-state-2026-08-06.md and the full-set pin in
// test/adapterClient.test.js) -- that re-verification is the compatibility
// review this evidence records; it is NOT an unimplemented claim.
const currentEvidence = Object.freeze({
  commit: "d41f1270",
  tag: "v1.3.79",
  date: "August 6, 2026"
});

const livingEvidenceDocs = Object.freeze([
  "docs/adapter-contract.md",
  "docs/upstream-source.md",
  "docs/roadmap.md",
  "docs/upstream-write-adapter-rfc.md"
]);

const supersededEvidenceTerms = Object.freeze([
  "1bb72c5",
  "v1.3.37",
  "v1.3.38-rc.1",
  "v1.3.40",
  "v1.3.41",
  "5163bd8",
  "fea65b4",
  "233aedf",
  "fdaca43",
  "v1.3.60"
]);

test("living upstream evidence docs name the current baseline", async () => {
  for (const file of livingEvidenceDocs) {
    const content = await readFile(file, "utf8");

    assert.match(content, new RegExp(escapeRegExp(currentEvidence.commit)), file);
    assert.match(content, new RegExp(escapeRegExp(currentEvidence.tag)), file);
  }
});

test("living upstream evidence docs do not keep superseded baseline values", async () => {
  for (const file of livingEvidenceDocs) {
    const content = await readFile(file, "utf8");

    for (const term of supersededEvidenceTerms) {
      assert.doesNotMatch(content, new RegExp(escapeRegExp(term)), `${file} should not keep ${term}`);
    }
  }
});

test("upstream source evidence includes the compatibility review date", async () => {
  const content = await readFile("docs/upstream-source.md", "utf8");

  assert.match(content, new RegExp(escapeRegExp(currentEvidence.date)));
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
