/**
 * Public /api/commands contract pin (issues #193/#203).
 *
 * getCommandRegistry() is served VERBATIM by GET /api/commands
 * (setupServer.js) to the acp-landing command-reference accordion
 * (acp.darkdante.org/js/command-accordion.js), which reads exactly
 * group.title / group.commands / cmd.name / cmd.desc / cmd.role. This
 * shape drifting is a production outage for the landing page — the
 * Phase 3 branch shipped exactly that (raw internal registry groups
 * instead of the public projection) and the accordion rendered
 * "Command registry unavailable." for every visitor.
 *
 * It is also a security boundary (#203): the internal Core-catalog
 * registry carries adapter route paths, capability identifiers, HTTP
 * methods, and body-field mappings that must never reach an
 * unauthenticated public endpoint.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getCommandRegistry, helpPayload } from "../src/commands.js";

const FORBIDDEN_KEYS = ["route", "routes", "capability", "method", "bodyField", "selector", "minTier", "requiresWritesEnabled", "params"];

test("contract: getCommandRegistry() returns the public accordion shape", () => {
  const registry = getCommandRegistry();

  assert.ok(Array.isArray(registry), "registry must be an array of groups");
  assert.ok(registry.length > 0, "registry must not be empty");

  for (const group of registry) {
    assert.equal(typeof group.group, "string", `group.group must be a string: ${JSON.stringify(group)}`);
    assert.ok(group.group.length > 0);
    assert.equal(typeof group.title, "string", `group "${group.group}" must have a display title`);
    assert.ok(Array.isArray(group.commands), `group "${group.group}" must have a commands array`);
    assert.ok(group.commands.length > 0, `group "${group.group}" must not be empty`);

    for (const cmd of group.commands) {
      assert.equal(typeof cmd.name, "string", `command in "${group.group}" missing name`);
      assert.equal(typeof cmd.desc, "string", `command "${cmd.name}" missing desc`);
      assert.ok(["observer", "moderator", "admin", "owner"].includes(cmd.role),
        `command "${cmd.name}" has unexpected role "${cmd.role}"`);
    }
  }
});

test("contract: getCommandRegistry() never exposes internal adapter details (#203)", () => {
  const scan = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => scan(v, `${path}[${i}]`));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        assert.ok(!FORBIDDEN_KEYS.includes(k),
          `internal key "${k}" leaked into the public registry at ${path}`);
        scan(v, `${path}.${k}`);
      }
    }
  };
  scan(getCommandRegistry(), "registry");
});

test("contract: every public group corresponds to a real registered command group", () => {
  // helpPayload() mirrors buildDuneCommand()'s registered tree (enforced
  // by the mirror-coverage test in commands.test.js). The public
  // registry's groups must be a subset of those real groups — a phantom
  // group here means the landing page documents commands that don't
  // exist (#196's phantom `logs service` class of bug, at group level).
  const help = helpPayload(
    { multiTenant: false, discord: { rbac: { mode: "open", observerRoleIds: [], adminRoleIds: [], commandRoleIds: {} }, defaultEphemeral: true } },
    { member: { roles: [] }, user: { id: "u" }, guildId: null }
  );
  const realGroups = new Set([...help.available, ...help.locked].map((n) => n.split(":")[0]));

  for (const group of getCommandRegistry()) {
    assert.ok(realGroups.has(group.group),
      `public registry group "${group.group}" is not a registered command group`);
  }
});

test("contract: sync-commands is documented in the admin group", () => {
  const admin = getCommandRegistry().find((g) => g.group === "admin");
  assert.ok(admin, "admin group must exist");
  assert.ok(admin.commands.some((c) => c.name === "sync-commands"),
    "admin group must document sync-commands");
});

export default undefined;
