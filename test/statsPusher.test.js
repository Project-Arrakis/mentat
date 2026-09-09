import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStatsPayload, shouldAlertOnFailure, ALERT_AFTER_CONSECUTIVE_FAILURES, pushStats } from "../src/statsPusher.js";
import { createDatabase, upsertGuild, setGuildStatsSharingSecret, upsertGuildStatsSnapshot, getStatsSnapshot, _resetEphemeralStateForTests } from "../src/database.js";

// guild_stats_snapshot/stats_snapshot are module-level, in-memory, process-
// wide state as of schema v7 -- reset before each test so one test's data
// can't leak into another's assertions.
test.beforeEach(() => {
  _resetEphemeralStateForTests();
});

// Validates that buildStatsPayload() produces a shape acp-landing's
// reader (yacketrj/acp-landing:functions/api/stats.js) would actually
// accept — see yacketrj/acp-landing:docs/kv-stats-schema.md for the
// authoritative field list this mirrors. This is the real acceptance
// test for the cross-repo stats contract fix (Phase 2 of
// docs/remediation-prompt-cross-repo.md in
// dune-awakening-selfhost-docker): a passing test here means the KV
// payload this bot writes would be read correctly by the other repo's
// scripts/check-stats-contract.js assertions, without needing to run
// that repo's own test suite from here.
//
// Mirrors acp-landing's own isValidNumber(): a field only "counts" if it
// is a real, finite number — not a string, not NaN, not missing.
const CONTRACT_NUMERIC_FIELDS = ["players_online", "sietches", "battlegroups", "spice_fields", "installations", "commands_total"];

function isValidNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function baseArgs(overrides = {}) {
  return {
    guildCount: 3,
    allGuilds: [{ status: "active" }, { status: "active" }, { status: "suspended" }],
    activeGuilds: [{ status: "active" }, { status: "active" }],
    commandsTotal: 42,
    aggregates: {},
    ...overrides
  };
}

test("buildStatsPayload always sets version and updated_at to well-typed, valid values", () => {
  const stats = buildStatsPayload(baseArgs());
  // version and updated_at must always be present and well-typed —
  // acp-landing's reader treats a missing/malformed updated_at as
  // stale, never as fresh (LD-6 in that repo's audit).
  assert.equal(typeof stats.version, "string");
  assert.ok(stats.version.length > 0);
  assert.equal(typeof stats.updated_at, "string");
  assert.ok(Number.isFinite(new Date(stats.updated_at).getTime()), "updated_at must be a parseable ISO timestamp");
});

test("buildStatsPayload always sets installations and commands_total (fields with real, always-available sources)", () => {
  const stats = buildStatsPayload(baseArgs());
  assert.ok("installations" in stats, "installations has a real source (guilds_active) and must always be set");
  assert.ok("commands_total" in stats, "commands_total has a real source (bot_stats table) and must always be set");
});

test("installations is aliased to guilds_active (not guilds_total) per the documented resolution", () => {
  const stats = buildStatsPayload(baseArgs({
    allGuilds: [{ status: "active" }, { status: "suspended" }, { status: "pending" }],
    activeGuilds: [{ status: "active" }]
  }));
  assert.equal(stats.installations, 1, "installations must equal guilds_active.length, not guilds_total.length");
  assert.equal(stats.guilds_total, 3, "guilds_total must remain available under its own existing field name");
  assert.equal(stats.guilds_active, 1);
  assert.notEqual(stats.installations, stats.guilds_total, "this test's fixture must actually distinguish the two counts, or it isn't testing anything");
});

test("installations is a valid number acp-landing's isValidNumber() would accept, never a placeholder", () => {
  const stats = buildStatsPayload(baseArgs({ activeGuilds: [] }));
  assert.equal(isValidNumber(stats.installations), true);
  assert.equal(stats.installations, 0, "zero active guilds is a real, honest zero -- not the same bug class as a fabricated 0 for an unmeasured field");
});

test("battlegroups and sietches are never set by buildStatsPayload -- reported as unavailable, not fabricated", () => {
  const stats = buildStatsPayload(baseArgs());
  assert.equal("battlegroups" in stats, false, "no real source exists yet; must be absent, not a guessed value");
  assert.equal("sietches" in stats, false, "no reachable route exposes this yet; must be absent, not a guessed value");
});

test("players_online and spice_fields pass through real aggregate values when present", () => {
  const stats = buildStatsPayload(baseArgs({
    aggregates: { players_online: 12, spice_fields: 45000 }
  }));
  assert.equal(stats.players_online, 12);
  assert.equal(stats.spice_fields, 45000);
  assert.equal(isValidNumber(stats.players_online), true);
  assert.equal(isValidNumber(stats.spice_fields), true);
});

test("players_online and spice_fields are absent (not 0) when the aggregate has no real data", () => {
  const stats = buildStatsPayload(baseArgs({ aggregates: {} }));
  assert.equal("players_online" in stats, false);
  assert.equal("spice_fields" in stats, false);
});

test("commands_total passes through unchanged -- the one field with a pre-existing confirmed-real source", () => {
  const stats = buildStatsPayload(baseArgs({ commandsTotal: 999 }));
  assert.equal(stats.commands_total, 999);
  assert.equal(isValidNumber(stats.commands_total), true);
});

test("every present numeric field in the payload is a value acp-landing's isValidNumber() would accept", () => {
  const stats = buildStatsPayload(baseArgs({
    aggregates: { players_online: 5, spice_fields: 100 }
  }));
  for (const field of CONTRACT_NUMERIC_FIELDS) {
    if (field in stats) {
      assert.equal(isValidNumber(stats[field]), true, `${field} = ${JSON.stringify(stats[field])} must be a valid finite number if present at all`);
    }
  }
});

test("buildStatsPayload never mutates its input arrays/objects", () => {
  const args = baseArgs();
  const allGuildsCopy = [...args.allGuilds];
  const activeGuildsCopy = [...args.activeGuilds];
  const aggregatesCopy = { ...args.aggregates };
  buildStatsPayload(args);
  assert.deepEqual(args.allGuilds, allGuildsCopy);
  assert.deepEqual(args.activeGuilds, activeGuildsCopy);
  assert.deepEqual(args.aggregates, aggregatesCopy);
});

// KV removed (issue #83.2 / docs/kv-replacement-evaluation.md): the bot
// no longer writes any Cloudflare KV key. The acp-stats-aggregate payload
// is now stored in the local stats_snapshot table (see saveStatsSnapshot /
// getStatsSnapshot in src/database.js and the round-trip test in
// test/database.test.js) and served by setupServer.js's GET
// /api/live-stats, so there is no buildAggregateKvUrl to test anymore.

// KV-4: write-failure alerting must fire exactly once per failure
// streak, at the configured threshold -- never on every failure past it
// (which would spam the alert channel for as long as an outage lasts),
// and never before the threshold (which would alert on a single
// transient blip).
test("shouldAlertOnFailure fires exactly at the configured threshold, not before or after", () => {
  for (let count = 1; count < ALERT_AFTER_CONSECUTIVE_FAILURES; count += 1) {
    assert.equal(shouldAlertOnFailure(count), false, `must not alert yet at failure #${count}`);
  }
  assert.equal(shouldAlertOnFailure(ALERT_AFTER_CONSECUTIVE_FAILURES), true, "must alert exactly at the threshold");
  for (const count of [ALERT_AFTER_CONSECUTIVE_FAILURES + 1, ALERT_AFTER_CONSECUTIVE_FAILURES + 5, 100]) {
    assert.equal(shouldAlertOnFailure(count), false, `must not alert again past the threshold at failure #${count} (avoid spamming the channel for a long outage)`);
  }
});

test("shouldAlertOnFailure never fires for zero (no failures yet)", () => {
  assert.equal(shouldAlertOnFailure(0), false);
});

// ─── pushStats: guild_stats_snapshot wiring (mentat#276) ─────────────────
// The core aggregation logic (fresh/stale/absent/suspended-guild
// handling) is unit-tested directly against getActiveGuildStatsAggregate
// in test/database.test.js. These tests cover the one remaining seam:
// that pushStats() actually reads that aggregate and merges it into the
// snapshot it saves, without needing a live Discord client or adapter.
const fakeClient = { guilds: { cache: { size: 1 } } };

test("pushStats includes players_online/spice_fields/sietches from guild_stats_snapshot, even with no adapterClient configured", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "G1", consoleUrl: "https://g1.test", adapterToken: "t", status: "active" });
  setGuildStatsSharingSecret(db, "g1", "secret");
  upsertGuildStatsSnapshot("g1", { playersOnline: 7, spiceFields: 2, sietches: 1 });

  const ok = await pushStats(fakeClient, db, null, {});
  assert.equal(ok, true);

  const snapshot = getStatsSnapshot(db);
  assert.equal(snapshot.players_online, 7);
  assert.equal(snapshot.spice_fields, 2);
  assert.equal(snapshot.sietches, 1);
});

test("pushStats publishes a real sietches: 0 (not an absent field) when every contributing guild genuinely has zero", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "G1", consoleUrl: "https://g1.test", adapterToken: "t", status: "active" });
  setGuildStatsSharingSecret(db, "g1", "secret");
  upsertGuildStatsSnapshot("g1", { playersOnline: 7, spiceFields: 2, sietches: 0 });

  await pushStats(fakeClient, db, null, {});

  const snapshot = getStatsSnapshot(db);
  assert.equal(snapshot.players_online, 7);
  assert.equal("sietches" in snapshot, true, "a real, sourced zero must be published, not treated as absent -- same contract as players_online/spice_fields");
  assert.equal(snapshot.sietches, 0);
});

test("pushStats queries the active-guilds table only once per push, not twice", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "G1", consoleUrl: "https://g1.test", adapterToken: "t", status: "active" });
  setGuildStatsSharingSecret(db, "g1", "secret");
  upsertGuildStatsSnapshot("g1", { playersOnline: 7, spiceFields: 2, sietches: 1 });

  // L2 /code-review high finding on mentat#276: getActiveGuildStatsAggregate()
  // used to run its own independent "SELECT * FROM guilds WHERE status =
  // 'active'" query even though pushStats() already had the identical
  // result in `activeGuilds`. Wrap db.prepare() to count exactly how many
  // times that specific query text is prepared during one pushStats()
  // call -- a real query count, not an inference from the code shape.
  const activeGuildsSql = "SELECT * FROM guilds WHERE status = 'active'";
  const originalPrepare = db.prepare.bind(db);
  let activeGuildsQueryCount = 0;
  db.prepare = (sql) => {
    if (sql === activeGuildsSql) activeGuildsQueryCount += 1;
    return originalPrepare(sql);
  };

  await pushStats(fakeClient, db, null, {});

  assert.equal(activeGuildsQueryCount, 1, "pushStats must reuse its own already-fetched activeGuilds list instead of querying it again inside getActiveGuildStatsAggregate()");
});

test("pushStats reports players_online/spice_fields as absent (not a fabricated zero) when no guild has opted in", async () => {
  const db = createDatabase(":memory:");
  upsertGuild(db, { guildId: "g1", guildName: "G1", consoleUrl: "https://g1.test", adapterToken: "t", status: "active" });

  await pushStats(fakeClient, db, null, {});

  const snapshot = getStatsSnapshot(db);
  assert.equal("players_online" in snapshot, false);
  assert.equal("spice_fields" in snapshot, false);
});
