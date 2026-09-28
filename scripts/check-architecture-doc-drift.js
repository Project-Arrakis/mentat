// Mechanical drift check for docs/architecture.md — fails CI if the doc's
// factual claims no longer match the real source. Written because this
// exact class of doc-vs-code drift (assuming direct Postgres access that
// never existed, stale tier names) recurred across multiple sessions before
// this check existed. Mirrors dune-awakening-selfhost-docker's
// rw-architecture-consistency-check.py pattern: parse real source, not the
// doc's own prose.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const REPO_ROOT = process.cwd();
const ROOT = (p) => resolve(REPO_ROOT, p);

async function main() {
  const issues = [];

  const doc = await readFile(ROOT("docs/architecture.md"), "utf8");
  const pkg = JSON.parse(await readFile(ROOT("package.json"), "utf8"));
  const rbac = await readFile(ROOT("src/rbac.js"), "utf8");
  // mentat#401: this used to read the old, dead src/writeCommands.js (no
  // real code has imported it since the write-command-reconciliation work
  // landed -- see mentat#400, which deleted it) giving a false "no drift"
  // pass the entire time docs/architecture.md's write-command claims were
  // actually stale. The real source of truth is now src/writeActions.js's
  // WRITE_ACTIONS table (the 27 real commands) plus src/writeHandler.js's
  // LEGACY_WRITE_STUBS (the 9 still-deferred legacy commands) -- together,
  // every write subcommand a user can actually type.
  //
  // [Audit fix, mentat#401 round 2] Imports the real modules rather than
  // regex-parsing their source text -- a round-2 review found the regex
  // approach (matched on `group: "...", name: "..."` ordering) had a real
  // ordering blind spot: inserting any field between `group` and `name` on
  // a single entry made that entry silently invisible to the check, with
  // nothing catching it (the only empty-match guard is
  // `writeNameMatches.length === 0`, which doesn't fire for one dropped
  // entry among many). Importing the actual exported arrays has no such
  // blind spot -- it sees exactly what the real dispatch code sees.
  const { WRITE_ACTIONS } = await import(ROOT("src/writeActions.js"));
  const { LEGACY_WRITE_STUBS } = await import(ROOT("src/writeHandler.js"));

  // 1. No Postgres driver dependency — the doc's central claim.
  const deps = Object.keys(pkg.dependencies || {});
  const pgLike = deps.filter((d) => /^pg$|postgres/i.test(d));
  if (pgLike.length > 0) {
    issues.push(
      `package.json now has a Postgres-like dependency (${pgLike.join(", ")}) — ` +
      `docs/architecture.md claims Mentat never holds a direct DB connection. ` +
      `Either this is a real architecture change (update the doc) or an accidental dependency add.`
    );
  }

  // 2. Tier names — must match the doc's stated four-tier model exactly.
  const tierMatch = rbac.match(/export const TIERS = Object\.freeze\(\[([^\]]+)\]\)/);
  if (!tierMatch) {
    issues.push("Could not find `export const TIERS = ...` in src/rbac.js — drift check itself needs updating.");
  } else {
    const realTiers = tierMatch[1].split(",").map((s) => s.trim().replace(/["']/g, ""));
    const expectedTiers = ["observer", "moderator", "admin", "owner"];
    if (JSON.stringify(realTiers) !== JSON.stringify(expectedTiers)) {
      issues.push(
        `src/rbac.js TIERS is now [${realTiers.join(", ")}] but docs/architecture.md documents ` +
        `[${expectedTiers.join(", ")}] — update the doc's Role Tiers section.`
      );
    }
    if (!doc.includes(realTiers.join(" < "))) {
      issues.push(
        `docs/architecture.md does not contain the literal tier chain "${realTiers.join(" < ")}" — ` +
        `the doc's Role Tiers section may be stale relative to src/rbac.js.`
      );
    }
  }

  // 3. Write command list — every real write command name must appear in the doc.
  const writeNameMatches = [
    ...WRITE_ACTIONS.map((e) => e.name),
    ...LEGACY_WRITE_STUBS.map((e) => e.name)
  ];
  if (writeNameMatches.length === 0) {
    issues.push("WRITE_ACTIONS and LEGACY_WRITE_STUBS both resolved empty — drift check itself needs updating (or something is badly broken in src/writeActions.js / src/writeHandler.js).");
  } else {
    for (const name of writeNameMatches) {
      if (!doc.includes(name)) {
        issues.push(
          `src/writeActions.js or src/writeHandler.js defines write command "${name}" which is not mentioned anywhere in ` +
          `docs/architecture.md's Write Capabilities table.`
        );
      }
    }
    // Doc's own explicit claim used to be "No player-facing write ...
    // exists today" -- that's now false (mentat#396/#404 work shipped real
    // player-facing write commands) and docs/architecture.md was already
    // corrected to say so. If a future edit ever reintroduces that old
    // claim while player-facing commands still exist, catch it.
    const playerFacingPattern = /player|kick|ban|grant.?item/i;
    const suspicious = writeNameMatches.filter((n) => playerFacingPattern.test(n));
    if (suspicious.length > 0 && doc.includes("No player-facing write")) {
      issues.push(
        `docs/architecture.md claims "No player-facing write ... exists today" but src/writeActions.js ` +
        `now has command(s) that look player-facing: ${suspicious.join(", ")}. Update the doc — this is exactly ` +
        `the kind of change that must not silently go undocumented.`
      );
    }
  }

  if (issues.length > 0) {
    console.error("docs/architecture.md drift detected:\n");
    for (const issue of issues) console.error(`  - ${issue}`);
    console.error("\nUpdate docs/architecture.md (or this script, if the check itself is wrong) before merging.");
    process.exitCode = 1;
    return;
  }

  console.log("docs/architecture.md: no drift detected against src/rbac.js, src/writeActions.js, src/writeHandler.js, package.json.");
}

main();
