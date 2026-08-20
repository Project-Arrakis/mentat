/**
 * TEST-1: registryLoader.test.js
 *
 * Test suite for Phase 3 registry loading, validation, and the
 * side-effect-free Core catalog drift fetch. Covers:
 * - Startup loading (happy path, validation)
 * - Registry validation and DoS prevention (SEC-3/SEC-4), including the
 *   #206/K10 regression (names validated AS-IS, not lowercased first)
 * - fetchCoreCatalogForGuild() against the REAL
 *   adapterClient.discordCatalog(actor, guildId) interface — asserting
 *   it NEVER writes shared cache state (#192 cross-tenant poisoning
 *   regression) and preserves the adapter's HTTP status on errors (#199)
 * - diffRegistries() drift computation
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert";
import {
  loadRegistryAtStartup,
  getRegistryFromCache,
  getRegistryMetadata,
  fetchCoreCatalogForGuild,
  diffRegistries,
  validateRegistry,
  __resetForTests
} from "../src/registryLoader.js";

beforeEach(() => {
  __resetForTests();
});

function createMockRegistry(overrides = {}) {
  return {
    version: 1,
    groups: [
      {
        name: "core",
        title: "Core Commands",
        subcommands: [
          { name: "about", description: "Bot metadata", params: [] }
        ]
      }
    ],
    ...overrides
  };
}

// Mock adapterClient matching the REAL interface used by
// fetchCoreCatalogForGuild(): adapterClient.discordCatalog(actor, guildId)
// either resolves with the parsed body, or rejects with an
// AdapterHttpError-shaped error (has a `.status`).
function mockAdapterClient({ resolves, rejects } = {}) {
  return {
    calls: [],
    discordCatalog(actor, guildId) {
      this.calls.push({ actor, guildId });
      if (rejects) return Promise.reject(rejects);
      return Promise.resolve(resolves);
    }
  };
}

// ── loadRegistryAtStartup() ──

test("registryLoader: loadRegistryAtStartup() loads valid registry from disk", () => {
  const registry = loadRegistryAtStartup();

  assert.strictEqual(typeof registry, "object");
  assert.strictEqual(typeof registry.version, "number");
  assert.ok(Array.isArray(registry.groups));
  assert.ok(registry.groups.length > 0);
});

// ── validateRegistry() ──

test("registryLoader: validateRegistry() rejects missing groups array", () => {
  assert.throws(() => validateRegistry({ version: 1 }), /groups must be an array/);
});

test("registryLoader: validateRegistry() rejects non-numeric version", () => {
  assert.throws(() => validateRegistry({ version: "1", groups: [] }), /version must be a number/);
});

test("registryLoader: validateRegistry() rejects invalid group names", () => {
  const registry = createMockRegistry({
    groups: [{ name: "Invalid Name!", subcommands: [] }]
  });
  assert.throws(() => validateRegistry(registry), /naming constraints/);
});

test("registryLoader: validateRegistry() rejects UPPERCASE names (#206/K10 regression)", () => {
  // Discord requires lowercase command names. The original check
  // lowercased the name before testing it against a lowercase-only
  // regex, so "Core"/"About" sailed through the very validation that
  // exists to reject them.
  assert.throws(
    () => validateRegistry(createMockRegistry({ groups: [{ name: "Core", subcommands: [] }] })),
    /naming constraints/
  );
  assert.throws(
    () => validateRegistry(createMockRegistry({
      groups: [{ name: "core", subcommands: [{ name: "About", description: "ok" }] }]
    })),
    /naming constraints/
  );
  assert.throws(
    () => validateRegistry(createMockRegistry({
      groups: [{ name: "core", subcommands: [{ name: "about", description: "ok", params: [{ name: "Diagnostic" }] }] }]
    })),
    /Parameter name/
  );
});

test("registryLoader: validateRegistry() rejects invalid subcommand names (SEC-4)", () => {
  const registry = createMockRegistry({
    groups: [{
      name: "core",
      subcommands: [{ name: "Command With Spaces", description: "bad" }]
    }]
  });
  assert.throws(() => validateRegistry(registry), /naming constraints/);
});

test("registryLoader: validateRegistry() rejects invalid parameter names", () => {
  const registry = createMockRegistry({
    groups: [{
      name: "core",
      subcommands: [{
        name: "about",
        description: "ok",
        params: [{ name: "Bad Param!" }]
      }]
    }]
  });
  assert.throws(() => validateRegistry(registry), /Parameter name/);
});

test("registryLoader: validateRegistry() enforces Discord group limit (25)", () => {
  const groups = Array.from({ length: 26 }, (_, i) => ({
    name: `group${i}`,
    subcommands: [{ name: "cmd", description: "ok" }]
  }));
  const registry = createMockRegistry({ groups });
  assert.throws(() => validateRegistry(registry), /more than 25 command groups/);
});

test("registryLoader: validateRegistry() enforces Discord subcommand limit (25)", () => {
  const subcommands = Array.from({ length: 26 }, (_, i) => ({
    name: `cmd${i}`,
    description: "ok"
  }));
  const registry = createMockRegistry({
    groups: [{ name: "core", subcommands }]
  });
  assert.throws(() => validateRegistry(registry), /more than 25 subcommands/);
});

test("registryLoader: validateRegistry() accepts a well-formed registry", () => {
  assert.doesNotThrow(() => validateRegistry(createMockRegistry()));
});

// ── getRegistryFromCache() / getRegistryMetadata() ──

test("registryLoader: getRegistryFromCache() returns loaded registry", () => {
  const loaded = loadRegistryAtStartup();
  const cached = getRegistryFromCache();

  assert.strictEqual(cached.version, loaded.version);
  assert.strictEqual(cached.groups.length, loaded.groups.length);
});

test("registryLoader: getRegistryFromCache() throws if registry not loaded", () => {
  // beforeEach() already called __resetForTests(), so cache is empty here
  assert.throws(() => getRegistryFromCache(), /Registry not loaded/);
});

test("registryLoader: getRegistryMetadata() includes version, group and command counts", () => {
  loadRegistryAtStartup();
  const meta = getRegistryMetadata();

  assert.strictEqual(typeof meta.version, "number");
  assert.strictEqual(typeof meta.groups, "number");
  assert.ok(meta.groups > 0);
  assert.ok(meta.commandCount > 0);
  assert.ok(meta.loadTime instanceof Date);
});

// ── fetchCoreCatalogForGuild() — against the REAL adapterClient interface ──

test("registryLoader: fetchCoreCatalogForGuild() calls adapterClient.discordCatalog(actor, guildId)", async () => {
  const registry = createMockRegistry();
  const adapter = mockAdapterClient({ resolves: registry });

  const result = await fetchCoreCatalogForGuild(adapter, { id: "user-1" }, "guild-123");

  assert.strictEqual(adapter.calls.length, 1);
  assert.deepStrictEqual(adapter.calls[0], { actor: { id: "user-1" }, guildId: "guild-123" });
  assert.strictEqual(result.version, registry.version);
});

test("registryLoader: fetchCoreCatalogForGuild() unwraps Core's response envelope", async () => {
  const registry = createMockRegistry();
  const adapter = mockAdapterClient({ resolves: { ok: true, protocolVersion: 1, catalog: registry } });

  const result = await fetchCoreCatalogForGuild(adapter, { id: "user-1" }, "guild-123");
  assert.strictEqual(result.version, registry.version);
  assert.strictEqual(result.groups.length, registry.groups.length);
});

test("registryLoader: fetchCoreCatalogForGuild() NEVER writes the shared cache (#192 poisoning regression)", async () => {
  const committed = loadRegistryAtStartup();
  const before = getRegistryMetadata();

  // A hostile/foreign tenant's Core returns a completely different
  // (valid-looking) catalog...
  const foreign = createMockRegistry({
    version: 99,
    groups: [{ name: "evil", subcommands: [{ name: "totally-legit", description: "poisoned entry", params: [] }] }]
  });
  const adapter = mockAdapterClient({ resolves: foreign });
  const fetched = await fetchCoreCatalogForGuild(adapter, { id: "tenant-admin" }, "guild-evil");

  // ...the fetch RETURNS it for drift comparison...
  assert.strictEqual(fetched.version, 99);

  // ...but shared process state is untouched: every other tenant and
  // the public API still see the committed artifact.
  const cached = getRegistryFromCache();
  assert.strictEqual(cached.version, committed.version);
  assert.strictEqual(getRegistryMetadata().commandCount, before.commandCount);
  assert.ok(!cached.groups.some((g) => g.name === "evil"));
});

test("registryLoader: fetchCoreCatalogForGuild() rejects an invalid catalog from Core (HIGH-3)", async () => {
  const adapter = mockAdapterClient({ resolves: { version: 1 } }); // missing groups

  await assert.rejects(
    fetchCoreCatalogForGuild(adapter, { id: "user-1" }, "guild-123"),
    /Failed to fetch Core catalog/
  );
});

test("registryLoader: fetchCoreCatalogForGuild() preserves the adapter's HTTP status on errors (#199)", async () => {
  const adapter = mockAdapterClient({
    rejects: Object.assign(new Error("Adapter discord-catalog returned HTTP 503."), { status: 503 })
  });

  await assert.rejects(
    fetchCoreCatalogForGuild(adapter, { id: "user-1" }, "guild-123"),
    (error) => {
      assert.match(error.message, /Failed to fetch Core catalog/);
      assert.strictEqual(error.status, 503, "HTTP status must survive the wrap so callers can classify without substring-matching");
      return true;
    }
  );
});

test("registryLoader: concurrent fetches for different guilds are independent (multi-tenant)", async () => {
  const registry = createMockRegistry();
  const adapter = mockAdapterClient({ resolves: registry });

  await Promise.all([
    fetchCoreCatalogForGuild(adapter, { id: "a" }, "guild-1"),
    fetchCoreCatalogForGuild(adapter, { id: "b" }, "guild-2")
  ]);

  // Each guild talks to its OWN Core — coalescing guild-2's check onto
  // guild-1's in-flight fetch (the old CRITICAL-1 "serialization") would
  // report one tenant the other tenant's catalog.
  assert.strictEqual(adapter.calls.length, 2);
  assert.deepStrictEqual(adapter.calls.map((c) => c.guildId).sort(), ["guild-1", "guild-2"]);
});

// ── diffRegistries() ──

test("registryLoader: diffRegistries() reports in-sync for identical registries", () => {
  const a = createMockRegistry();
  const drift = diffRegistries(a, createMockRegistry());
  assert.strictEqual(drift.inSync, true);
  assert.deepStrictEqual(drift.added, []);
  assert.deepStrictEqual(drift.removed, []);
});

test("registryLoader: diffRegistries() reports added and removed command keys", () => {
  const committed = createMockRegistry();
  const fetched = createMockRegistry({
    groups: [
      { name: "core", subcommands: [{ name: "ping", description: "new", params: [] }] }
    ]
  });

  const drift = diffRegistries(committed, fetched);
  assert.strictEqual(drift.inSync, false);
  assert.deepStrictEqual(drift.added, ["core:ping"]);
  assert.deepStrictEqual(drift.removed, ["core:about"]);
});

export default undefined;
