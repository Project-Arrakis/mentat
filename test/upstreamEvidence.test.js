import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Baseline advanced to upstream v1.4.8 (release commit
// b53765c2070c12d7ebb4adc8103f26c42745fa7c, released 2026-09-03) on
// 2026-09-06. This re-verification (issue #178) directly diffed
// DISCORD_ADAPTER_ROUTES, the opsRoutes dispatch table, and every route
// handler in routes.js between the prior (v1.3.87) baseline and current
// upstream (~1,139 commits of drift) and found the entire Discord-adapter
// route surface UNCHANGED -- see docs/adapter-contract.md's 2026-09-06
// entry for the full diff-based re-verification. It is NOT a
// route-classification change, only an evidence/pin refresh. The prior
// v1.3.87 evidence (2026-08-16) itself corrected two real drift issues
// the original v1.3.79 evidence had missed: a false LIVE claim for the
// players/accounts/* routes (never existed in any tagged release) and a
// real regression (ops-dashboard: live at v1.3.79, 404s at v1.3.87,
// still absent at v1.4.8). See #172 for that full audit.
const currentEvidence = Object.freeze({
  commit: "b53765c2070c12d7ebb4adc8103f26c42745fa7c",
  tag: "v1.4.8",
  date: "September 6, 2026"
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
  "v1.3.79",
  "b4f8fe4c5a36e2ac2f81deb4c9fddde087c77d06",
  "v1.3.87"
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
