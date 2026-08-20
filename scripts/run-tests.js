#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { readdirSync } from "node:fs";
import { join } from "node:path";

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

async function runTests(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--test", "--test-reporter=spec", ...args], {
      stdio: ["inherit", "pipe", "inherit"]
    });

    const rl = createInterface({ input: child.stdout });

    rl.on("line", (line) => {
      const formatted = line.replace(/duration_ms\s+([\d.]+)/g, (_, ms) => {
        return `duration ${formatDuration(Number(ms))}`;
      });
      process.stdout.write(formatted + "\n");
    });

    child.on("exit", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", reject);
  });
}

const BATS_TEST_FILE = "test/deploy-hook.bats";

// ACP Issue Bridge tests live under .github/scripts/issue-bridge/ (see
// docs/issue-bridge/testing.md). `node --test`'s handling of a
// dot-directory is NOT stable across Node versions, in TWO different,
// mutually-incompatible ways (both verified directly, 2026-08-19 — a
// real regression, not a hypothetical one: this caused CI on Node 22 to
// report a fully passing suite while silently running 0 of the 240
// issue-bridge tests):
//   - Node 20: a bare directory path recurses into it correctly (dot-dirs
//     included), but a `**` glob string passed as a CLI arg is NOT
//     expanded — treated as a literal, nonexistent path.
//   - Node 22: the reverse — a bare dot-directory path is NOT recursed
//     into by default, but `--test` DOES expand a `**` glob string itself.
// Neither single invocation works on both versions, so this walks the
// directory itself (plain fs, no glob syntax, no version-dependent
// behavior) and passes the resulting file list explicitly.
function findTestFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(full);
    }
  }
  return files;
}

const ISSUE_BRIDGE_DIR = ".github/scripts/issue-bridge";

function runBats() {
  return new Promise((resolve) => {
    const child = spawn("bats", [BATS_TEST_FILE], {
      stdio: "inherit"
    });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", (err) => {
      console.error(`bats unavailable (${err.message}); skipping ${BATS_TEST_FILE} — install bats to run hook tests`);
      resolve(0);
    });
  });
}

async function main() {
  const exitCode1 = await runTests(process.argv.slice(2).filter(a => a !== "test/discord-bot-test-harness.js"));
  const exitCode2 = await runTests(["test/discord-bot-test-harness.js"]);
  const exitCode3 = await runBats();
  const issueBridgeFiles = findTestFiles(ISSUE_BRIDGE_DIR);
  if (issueBridgeFiles.length === 0) {
    console.error(`FAIL: found 0 test files under ${ISSUE_BRIDGE_DIR} — this almost certainly means discovery is broken, not that there are no tests`);
    process.exit(1);
  }
  const exitCode4 = await runTests(issueBridgeFiles);
  console.log(`Test results: all-others=${exitCode1}, harness=${exitCode2}, bats=${exitCode3}, issue-bridge=${exitCode4}`);
  if (exitCode1 !== 0) console.error("FAIL: all-other tests failed with exit code " + exitCode1);
  if (exitCode2 !== 0) console.error("FAIL: discord-bot-test-harness failed with exit code " + exitCode2);
  if (exitCode3 !== 0) console.error("FAIL: bats deploy-hook tests failed with exit code " + exitCode3);
  if (exitCode4 !== 0) console.error("FAIL: issue-bridge tests failed with exit code " + exitCode4);
  process.exit(exitCode1 === 0 && exitCode2 === 0 && exitCode3 === 0 && exitCode4 === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
