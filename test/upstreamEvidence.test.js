import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

// Baseline advanced to upstream v1.4.12 (release commit
// 1afdb95766eba92f4c3ef4ed3965d21990aab431, released 2026-09-08) on
// 2026-09-08 (issue #267). Directly diffed DISCORD_ADAPTER_ROUTES, the
// opsRoutes dispatch table, and every route handler in routes.js between
// v1.4.8 and v1.4.12 (23 commits, `gh api .../compare/v1.4.8...v1.4.12`):
// zero files under console/api/src/integrations/discord/ touched in that
// range -- the game-data route classification remains accurate as-is.
//
// FOLLOW-UP (issue #267): #267 correctly flagged that no evidence existed
// the PRIOR v1.4.8 re-classification (dated 2026-09-06) was actually
// re-run at the code level, only cited in a doc header. Independently
// re-checked that claim directly this session by diffing v1.3.87...v1.4.8
// (not just v1.4.8...v1.4.12): adapter.js/routes.js/policy.js/
// opsProvider.js were genuinely modified in that range, and a new
// commandCatalog.js file (498 lines) was added, shipping
// `GET /api/integrations/discord/catalog` (Phase 1 of
// docs/rfc-command-discovery.md, upstream PR #171). This is NOT a gap in
// the prior evidence, though: that route is deliberately excluded from
// DISCORD_LIVE_ADAPTER_ROUTES (metadata about the live routes, not itself
// a data route -- see adapter.js's own comment on the CATALOG key), so it
// never affected this repo's LIVE_ROUTES/PLANNED_ROUTES/UNMERGED_ROUTES/
// MISSING_ROUTES classification -- and this repo's own catalogTransform.js/
// config.js/adapterClient.js already track and consume it separately
// (Phase 3 command discovery, #181), predating this re-verification. The
// v1.4.8 evidence's "entire route surface unchanged" phrasing was
// imprecise (something *did* change) but not substantively wrong for what
// it actually classifies (game-data routes).
const currentEvidence = Object.freeze({
  commit: "1afdb95766eba92f4c3ef4ed3965d21990aab431",
  tag: "v1.4.12",
  date: "September 8, 2026"
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
  "v1.3.87",
  "b53765c2070c12d7ebb4adc8103f26c42745fa7c",
  "v1.4.8"
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
