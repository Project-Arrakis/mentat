import test from "node:test";
import assert from "node:assert/strict";
import { commandDefinitions } from "../src/commands.js";
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
