import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const currentEvidence = Object.freeze({
  commit: "5163bd8",
  tag: "v1.3.41",
  date: "July 3, 2026"
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
  "fea65b4",
  "233aedf"
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
