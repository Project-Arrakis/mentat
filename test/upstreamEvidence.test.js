import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Baseline advanced to upstream v1.3.87 (release commit
// b4f8fe4c5a36e2ac2f81deb4c9fddde087c77d06, released 2026-08-14) on
// 2026-08-16. The 2026-08-16 upstream compat pin refresh (#172)
// re-verified every Discord adapter route this bot calls against every
// tagged upstream release from v1.3.79 through v1.3.87 (see
// docs/adapter-contract.md and the full-set pin in
// test/adapterClient.test.js) -- that re-verification is the
// compatibility review this evidence records; it is NOT an unimplemented
// claim. This refresh also found and corrected two real drift issues the
// prior v1.3.79 evidence had missed: a false LIVE claim for the
// players/accounts/* routes (never existed in any tagged release) and a
// real regression (ops-dashboard: live at v1.3.79, 404s at v1.3.87). See
// #172 for the full audit.
const currentEvidence = Object.freeze({
  commit: "b4f8fe4c5a36e2ac2f81deb4c9fddde087c77d06",
  tag: "v1.3.87",
  date: "August 16, 2026"
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
  "v1.3.60",
  "d41f1270",
  "ac8f086",
  "v1.3.79"
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
