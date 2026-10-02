import test from "node:test";
import assert from "node:assert/strict";
import { commandDefinitions } from "../src/commands.js";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, mkdirSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { hashRegistration } from "../scripts/command-defs-hash.js";

// mentat#440: the register decision hashes the RENDERED tree, so a change to
// any file or env value that feeds commandDefinitions() changes the hash and
// no hand-kept file list can rot.
const render = (includeWriteGroup, scope = "global") => ({
  commands: commandDefinitions({ includeWriteGroup }),
  scope
});

test("hash is stable for identical inputs", () => {
  assert.equal(hashRegistration(render(true), "c1"), hashRegistration(render(true), "c1"));
});

test("hash changes when the writes flag changes the tree (an env value, invisible to git diff)", () => {
  assert.notEqual(hashRegistration(render(true), "c1"), hashRegistration(render(false), "c1"));
});

test("hash changes with scope and with client id", () => {
  assert.notEqual(hashRegistration(render(true, "global"), "c1"), hashRegistration(render(true, "guild:1"), "c1"));
  assert.notEqual(hashRegistration(render(true), "c1"), hashRegistration(render(true), "c2"));
});

// The CLI entry guard once printed nothing (exit 0) for a symlinked or
// space-containing path, which the deploy hook reads as "register always".
test("CLI prints a 64-hex hash when run through a symlink and a path with spaces", () => {
  const dir = mkdtempSync(join(tmpdir(), "hash cli "));
  try {
    const link = join(dir, "link dir");
    symlinkSync(resolve("scripts"), link);
    const env = { PATH: process.env.PATH, DISCORD_BOT_TOKEN: "x", DISCORD_CLIENT_ID: "123", DUNE_CONSOLE_API_URL: "http://x", DUNE_DISCORD_ADAPTER_TOKEN: "y", DISCORD_RBAC_MODE: "open" };
    const r = spawnSync("node", [join(link, "command-defs-hash.js")], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout.trim(), /^[0-9a-f]{64}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
