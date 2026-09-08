import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDuneCommand } from "../src/commands.js";

// Regression test for issue #286: docs/user-guide.md's "Command Groups"
// tables are hand-maintained prose, not generated from the live command
// tree, and had drifted significantly (a stale admin-group list missing
// sync-commands/roles, missing server/ops subcommands, and player-group
// commands miscategorized under the data group). The original finding
// also compared against the WRONG source (src/commands-registry.json,
// a separate file used only for Core-catalog drift checks) and produced
// an inaccurate delta -- see the issue's own correction comment.
//
// buildDuneCommand() is the real, authoritative source: it's what
// registers the live Discord command tree, and what setupServer.js's
// GET /api/commands actually serves via getCommandRegistry(). This test
// parses every `/dune <group> <subcommand>` occurrence out of the doc
// and asserts, per group, that the set of subcommands mentioned exactly
// matches buildDuneCommand()'s real registered set -- so a future
// registration change that isn't reflected in the doc fails CI instead
// of silently drifting again.
test("docs/user-guide.md's Command Groups tables match the real, live command tree exactly", () => {
  const cmd = buildDuneCommand({ includeWriteGroup: false }).toJSON();
  const realByGroup = {};
  for (const group of cmd.options.filter((o) => o.type === 2)) {
    realByGroup[group.name] = new Set(group.options.map((o) => o.name));
  }

  const doc = readFileSync(new URL("../docs/user-guide.md", import.meta.url), "utf8");
  const docByGroup = {};
  // L3 audit finding (2026-09-08): [a-z-]+ excluded digits and underscores,
  // both valid in a real Discord subcommand name -- a future subcommand
  // like "readiness2" would get truncated by this regex at the digit,
  // producing a false "doc is missing/mentions stale" failure on this
  // "permanent regression test" for documentation that's actually correct.
  for (const match of doc.matchAll(/\/dune ([a-z0-9_-]+) ([a-z0-9_-]+)/g)) {
    const [, group, sub] = match;
    (docByGroup[group] ??= new Set()).add(sub);
  }

  const problems = [];
  for (const [group, realSubs] of Object.entries(realByGroup)) {
    const docSubs = docByGroup[group] || new Set();
    const missing = [...realSubs].filter((s) => !docSubs.has(s)).sort();
    const stale = [...docSubs].filter((s) => !realSubs.has(s)).sort();
    if (missing.length) problems.push(`${group}: doc is missing ${JSON.stringify(missing)}`);
    if (stale.length) problems.push(`${group}: doc mentions ${JSON.stringify(stale)}, which no longer exist in the real command tree`);
  }

  // Any `/dune <group> <sub>` mention whose <group> isn't a real registered group at all --
  // e.g. a typo, a renamed group, or a stale reference -- must fail loudly rather than being
  // silently dropped from validation (see this test's own regression history: it previously
  // `continue`d past unknown groups entirely, which would let a typoed or stale group name
  // drift undetected).
  const unknownGroups = Object.keys(docByGroup).filter((g) => !(g in realByGroup)).sort();
  if (unknownGroups.length) {
    problems.push(`doc mentions unknown command group(s) ${JSON.stringify(unknownGroups)}, which don't exist in the real command tree`);
  }

  assert.deepEqual(problems, [], `docs/user-guide.md has drifted from the real command tree:\n${problems.join("\n")}`);
});
