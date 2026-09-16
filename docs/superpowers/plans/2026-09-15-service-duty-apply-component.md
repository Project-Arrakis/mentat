# Service Duty/Apply Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the generalized On Duty/Off Duty/Apply button component for Chronicles of Kanly's service channels (mentat#372), wired end-to-end for two pilot channels (Water-Seller, Smuggler).

**Architecture:** Three new additive SQLite tables (schema v9) plus one new column on the existing `guild_settings` table, accessed through a new `src/serviceChannels.js` module. A new `src/serviceComponent.js` module holds the button/modal interaction handlers, reusing the existing customId-prefix dispatch chain in `src/index.js` and the existing `isAdminActor()` gate. A new `/dune admin service-setup` subcommand provisions a channel end-to-end.

**Tech Stack:** Node.js, discord.js 14.26.4 (`ModalBuilder`/`TextInputBuilder` — first use in this codebase), better-sqlite3, `node:test` (native test runner via `node scripts/run-tests.js`).

**Spec:** `docs/design/service-duty-apply-component-l1-design-2026-09-15.md` (merged to `main`, Layer 1 eight-hat audit resolved — findings register on mentat#372).

## Global Constraints

- Schema changes are additive only (`CREATE TABLE IF NOT EXISTS`, one guarded `ALTER TABLE ADD COLUMN`) — no `DROP`/`RENAME` on anything existing. Bump `SCHEMA_VERSION` from 8 to 9.
- Every new table/column ships with an inline rollback comment matching the `live_messages` (schema v8) precedent — see `src/database.js:126-132`.
- `service_applications`'s pending-application guard is a real `CREATE UNIQUE INDEX ... WHERE status = 'pending'` — not a plain index. `createApplication()` must catch the resulting constraint violation, not just rely on a pre-check.
- The review channel (`service_channels.review_channel_id`) is a per-guild value passed explicitly to `/dune admin service-setup` — never a process-global env var (mentat is multi-tenant, confirmed via `docs/multi-tenant-design.md` and `config.multiTenant` branches in `src/commands.js`).
- `postOrEditLiveMessage()`'s `messageKey` for this feature is always constructed as `` `service:duty:${serviceKey}` `` — never a bare `serviceKey`.
- `proof_link` is rendered as plain text (a code-block-style field), never interpolated into Discord markdown link syntax (`[label](url)`).
- Every DB accessor query is parameterized (`db.prepare(...).get/run(...)` with `?` placeholders) — never string-interpolated SQL.
- Approve/Deny handlers verify `application.guild_id === interaction.guildId` before any mutation, and re-check `isAdminActor()` live at click time.
- All new tests use `node:test` + `assert from "node:assert/strict"`, an in-memory `createDatabase(":memory:")`, and hand-rolled fake Discord.js objects matching the exact shape used in `test/ownerConfirmation.test.js` (`isButton: () => true`, `customId`, `user`, `client`, `updates`/`replies` arrays with `update()`/`reply()` methods appending to them) — extended for `isModalSubmit`/`showModal`/`fields.getTextInputValue` per Task 8's note on checking real discord.js types first.
- Run `npm test` after every task and confirm the full suite is green before committing — never assume.

---

### Task 1: Schema v9 — three new tables + `guild_settings.on_duty_role_id`

**Files:**
- Modify: `src/database.js` (SCHEMA_VERSION, SCHEMA string, migration block)
- Test: `test/database.test.js`

**Interfaces:**
- Produces: `service_channels`, `service_duty_status`, `service_applications` tables; `guild_settings.on_duty_role_id` column (TEXT, default `''`). Later tasks' accessors query these directly.

- [ ] **Step 1: Write the failing test**

Add to `test/database.test.js`. This file is ESM (`import` at the top, no `require`) and already imports `mkdtempSync`/`rmSync` from `node:fs`, `tmpdir` from `node:os`, and `join` from `node:path` — reuse those, don't add new imports. Mirror the exact on-disk-migration technique the existing `"schema v5 install upgrades straight to v7..."` test uses (`test/database.test.js:~380`, `mkdtempSync(join(tmpdir(), "acp-db-migration-"))` + a real file path, not `:memory:`, since `:memory:` can't be closed and reopened to simulate an upgrade):

```javascript
test("createDatabase migrates a v8 database to v9, adding service tables and guild_settings.on_duty_role_id without touching existing data", () => {
  const dir = mkdtempSync(join(tmpdir(), "acp-db-service-migration-"));
  const dbPath = join(dir, "acp.db");
  try {
    let db = createDatabase(dbPath);
    db.prepare("UPDATE schema_version SET version = 8").run();
    upsertGuild(db, "g1", "Test Guild", "https://console.test", "token", "active");
    db.close();

    db = createDatabase(dbPath);
    const version = db.prepare("SELECT version FROM schema_version LIMIT 1").get();
    assert.equal(version.version, 9);

    // New tables exist and are empty, not erroring.
    assert.deepEqual(db.prepare("SELECT * FROM service_channels").all(), []);
    assert.deepEqual(db.prepare("SELECT * FROM service_duty_status").all(), []);
    assert.deepEqual(db.prepare("SELECT * FROM service_applications").all(), []);

    // guild_settings gained the new column, existing row untouched otherwise.
    const settings = db.prepare("SELECT * FROM guild_settings WHERE guild_id = ?").get("g1");
    assert.equal(settings.on_duty_role_id, "");

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/database.test.js`
Expected: FAIL — `no such table: service_channels` (or similar), since none of Step 3's schema exists yet.

- [ ] **Step 3: Write the schema additions**

In `src/database.js`, bump `const SCHEMA_VERSION = 8;` to `const SCHEMA_VERSION = 9;`.

Add to the end of the `SCHEMA` template literal, right after the existing `live_messages` block:

```sql

-- service_channels / service_duty_status / service_applications
-- (schema v9, mentat#372): the generalized On Duty/Off Duty/Apply
-- button component backing every Chronicles of Kanly service channel.
-- See docs/design/service-duty-apply-component-l1-design-2026-09-15.md
-- for the full design and its Layer 1 audit findings register
-- (mentat#372 issue comments).
CREATE TABLE IF NOT EXISTS service_channels (
  guild_id TEXT NOT NULL,
  service_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  review_channel_id TEXT NOT NULL,
  status_message_id TEXT,
  requires_review INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, service_key)
);
-- Rollback: plain DROP TABLE IF EXISTS service_channels. No FK; losing
-- rows means every service channel loses its registry entry and must
-- be re-provisioned via /dune admin service-setup -- acceptable, no
-- in-game state depends on it.

CREATE TABLE IF NOT EXISTS service_duty_status (
  guild_id TEXT NOT NULL,
  service_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (guild_id, service_key, user_id)
);
-- Rollback: plain DROP TABLE IF EXISTS service_duty_status. No FK;
-- losing rows means every on-duty member appears off-duty until they
-- re-toggle -- acceptable, no persistent consequence beyond a stale
-- roster display.

CREATE TABLE IF NOT EXISTS service_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  service_key TEXT NOT NULL,
  applicant_id TEXT NOT NULL,
  character_name TEXT NOT NULL,
  proof_link TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  review_message_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- The UNIQUE partial index is the real, authoritative guard against a
-- duplicate pending application (Layer 1 Architect/DBA/QA hats, all
-- three independently caught the earlier draft's missing UNIQUE
-- keyword) -- see createApplication() in serviceChannels.js (Task 4),
-- which MUST catch this constraint's violation, not just rely on a
-- pre-check.
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_applications_pending
  ON service_applications (guild_id, service_key, applicant_id)
  WHERE status = 'pending';
-- Rollback: plain DROP TABLE IF EXISTS service_applications (drops the
-- index with it). No FK; losing rows means in-flight applications
-- disappear and applicants would need to re-apply -- acceptable, no
-- in-game state depends on it.
```

Add the `ALTER TABLE` migration block (`guild_settings.on_duty_role_id` is a new column on a pre-existing table — `CREATE TABLE IF NOT EXISTS` alone won't reach an existing install, exactly like the v5→v6 `guilds` column additions). Insert this block right before the final `if (currentVersion && currentVersion.version < SCHEMA_VERSION) {` block near the end of `createDatabase()`:

```javascript
  // v8->v9 (mentat#372): guild_settings.on_duty_role_id is a new column
  // on a pre-existing table -- SCHEMA's own CREATE TABLE IF NOT EXISTS
  // is a no-op for any operator upgrading from an earlier version, so
  // without this explicit ALTER TABLE step the column would silently
  // never reach an existing install (same reasoning as the v5->v6
  // guilds columns above). service_channels/service_duty_status/
  // service_applications are all brand-new tables and need no
  // migration here -- SCHEMA's CREATE TABLE IF NOT EXISTS already
  // handles them correctly for both fresh and upgraded installs.
  if (currentVersion && currentVersion.version < 9) {
    try {
      db.prepare("ALTER TABLE guild_settings ADD COLUMN on_duty_role_id TEXT NOT NULL DEFAULT ''").run();
    } catch {
      // Column may already exist from a previous migration attempt.
    }
  }
```

Update the comment inside the final version-bump block to mention v8→v9 (find the comment block ending in `db.prepare("UPDATE schema_version SET version = ?").run(SCHEMA_VERSION);` and add one line: `// v8->v9 (mentat#372) is additive (three new tables) plus one guarded ALTER TABLE (guild_settings.on_duty_role_id), handled in the block immediately above.`).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/database.test.js`
Expected: PASS

- [ ] **Step 5: Update 6 pre-existing hardcoded `schema_version === 8` assertions**

Bumping `SCHEMA_VERSION` breaks every existing test that hardcodes the *current* version as a literal `8` — this exact class of breakage happened when v7→v8 shipped (#370) and will happen again here if skipped. Confirmed via `grep -n "SELECT version FROM schema_version" test/database.test.js test/rollbackV7Schema.test.js` — six call sites assert a literal current-version number (a further two assert `6`, the rollback *target* version, which does NOT change and must NOT be touched):

In `test/database.test.js`, change `.version, 8)` to `.version, 9)` at:
- Line ~184 (fresh-install test)
- Line ~411-413 (the multi-line `assert.equal(db.prepare(...).get().version, 8, ...)` inside the "v5 install upgrades straight to v7" test — rename this test's own title too if it still says "straight to v7"; it now upgrades straight to v9)
- Line ~475 (v6→v7 hardening migration test — still lands on the *current* version after migrating forward, so this needs the bump too)
- Line ~520 (the "always migrates to current SCHEMA_VERSION" comment/assertion)

Line ~527 (`assert.equal(... .version, 6, "schema_version must be reset to 6")`) is the *rollback target* version, not the current version — leave it at `6`.

In `test/rollbackV7Schema.test.js`, change `.version, 8)` to `.version, 9)` at:
- Line ~62 (seeded database's starting version after a fresh `createDatabase()` call)
- Line ~69 (dry-run must-not-change-version check)

Line ~89 (`.version, 6)`) is again the rollback target — leave it. Also update the comment at line ~52 (`// createDatabase() always migrates to the current SCHEMA_VERSION (8, as of...`) to say `9`.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS (all existing tests green, including the six updated in Step 5 — the v7→v6 rollback script/tests are otherwise unaffected since this migration adds no DROP/RENAME).

- [ ] **Step 7: Commit**

```bash
git add src/database.js test/database.test.js test/rollbackV7Schema.test.js
git commit -m "feat: schema v9 -- service_channels/service_duty_status/service_applications + guild_settings.on_duty_role_id (mentat#372)"
```

---

### Task 2: `service_channels` accessors

**Files:**
- Create: `src/serviceChannels.js`
- Test: `test/serviceChannels.test.js`

**Interfaces:**
- Consumes: nothing new (raw `db` handle from `createDatabase()`, Task 1's schema).
- Produces: `getServiceChannel(db, guildId, serviceKey)`, `setServiceChannel(db, guildId, serviceKey, {channelId, roleId, reviewChannelId, requiresReview})`, `listServiceChannels(db, guildId)` — later tasks import these.

- [ ] **Step 1: Write the failing test**

Create `test/serviceChannels.test.js`:

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { getServiceChannel, setServiceChannel, listServiceChannels } from "../src/serviceChannels.js";

function fakeDb() {
  return createDatabase(":memory:");
}

const GUILD_ID = "111111111111111111";

test("setServiceChannel then getServiceChannel round-trips all fields", () => {
  const db = fakeDb();
  setServiceChannel(db, GUILD_ID, "water-seller", {
    channelId: "chan-1", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true
  });
  const row = getServiceChannel(db, GUILD_ID, "water-seller");
  assert.equal(row.channel_id, "chan-1");
  assert.equal(row.role_id, "role-1");
  assert.equal(row.review_channel_id, "review-1");
  assert.equal(row.requires_review, 1);
});

test("getServiceChannel returns undefined for an unknown service", () => {
  const db = fakeDb();
  assert.equal(getServiceChannel(db, GUILD_ID, "nonexistent"), undefined);
});

test("setServiceChannel is idempotent -- calling it twice for the same guild+service updates in place, no duplicate row", () => {
  const db = fakeDb();
  setServiceChannel(db, GUILD_ID, "water-seller", { channelId: "chan-1", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true });
  setServiceChannel(db, GUILD_ID, "water-seller", { channelId: "chan-2", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true });
  assert.equal(getServiceChannel(db, GUILD_ID, "water-seller").channel_id, "chan-2");
  assert.equal(listServiceChannels(db, GUILD_ID).length, 1);
});

test("listServiceChannels returns every service for a guild, none for another guild", () => {
  const db = fakeDb();
  setServiceChannel(db, GUILD_ID, "water-seller", { channelId: "chan-1", roleId: "role-1", reviewChannelId: "review-1", requiresReview: true });
  setServiceChannel(db, GUILD_ID, "smuggler", { channelId: "chan-2", roleId: "role-2", reviewChannelId: "review-1", requiresReview: true });
  setServiceChannel(db, "other-guild", "water-seller", { channelId: "chan-3", roleId: "role-3", reviewChannelId: "review-3", requiresReview: true });
  const rows = listServiceChannels(db, GUILD_ID);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => r.service_key).sort(), ["smuggler", "water-seller"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceChannels.test.js`
Expected: FAIL — `Cannot find module '../src/serviceChannels.js'`

- [ ] **Step 3: Write the implementation**

Create `src/serviceChannels.js`:

```javascript
// serviceChannels.js (mentat#372): DB accessors for the generalized
// service duty/apply component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md.
// Every query is parameterized -- never string-interpolated -- matching
// the getLiveMessage/setLiveMessage precedent in database.js.

export function getServiceChannel(db, guildId, serviceKey) {
  return db.prepare("SELECT * FROM service_channels WHERE guild_id = ? AND service_key = ?").get(guildId, serviceKey);
}

export function setServiceChannel(db, guildId, serviceKey, { channelId, roleId, reviewChannelId, requiresReview = true }) {
  db.prepare(`
    INSERT INTO service_channels (guild_id, service_key, channel_id, role_id, review_channel_id, requires_review)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, service_key) DO UPDATE SET
      channel_id = excluded.channel_id,
      role_id = excluded.role_id,
      review_channel_id = excluded.review_channel_id,
      requires_review = excluded.requires_review
  `).run(guildId, serviceKey, channelId, roleId, reviewChannelId, requiresReview ? 1 : 0);
}

export function listServiceChannels(db, guildId) {
  return db.prepare("SELECT * FROM service_channels WHERE guild_id = ?").all(guildId);
}

export function setServiceStatusMessageId(db, guildId, serviceKey, statusMessageId) {
  db.prepare("UPDATE service_channels SET status_message_id = ? WHERE guild_id = ? AND service_key = ?")
    .run(statusMessageId, guildId, serviceKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceChannels.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serviceChannels.js test/serviceChannels.test.js
git commit -m "feat: service_channels accessors (mentat#372)"
```

---

### Task 3: `service_duty_status` accessors

**Files:**
- Modify: `src/serviceChannels.js`
- Test: `test/serviceChannels.test.js`

**Interfaces:**
- Produces: `setDutyStatus(db, guildId, serviceKey, userId)`, `clearDutyStatus(db, guildId, serviceKey, userId)`, `listOnDuty(db, guildId, serviceKey)`, `isOnDuty(db, guildId, serviceKey, userId)` — Task 6 (On/Off Duty handler) and Task 5 (embed builder) import these.

- [ ] **Step 1: Write the failing test**

Append to `test/serviceChannels.test.js`:

```javascript
import { setDutyStatus, clearDutyStatus, listOnDuty, isOnDuty } from "../src/serviceChannels.js";

test("setDutyStatus then isOnDuty/listOnDuty reflect the new row", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), true);
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-2"), false);
  assert.deepEqual(listOnDuty(db, GUILD_ID, "water-seller").map(r => r.user_id), ["user-1"]);
});

test("setDutyStatus is idempotent -- calling it twice for the same user doesn't duplicate", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(listOnDuty(db, GUILD_ID, "water-seller").length, 1);
});

test("clearDutyStatus removes the row", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  clearDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), false);
  assert.deepEqual(listOnDuty(db, GUILD_ID, "water-seller"), []);
});

test("listOnDuty scopes by service_key -- a duty row for a different service doesn't leak in", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  setDutyStatus(db, GUILD_ID, "smuggler", "user-1");
  assert.equal(listOnDuty(db, GUILD_ID, "water-seller").length, 1);
  assert.equal(listOnDuty(db, GUILD_ID, "smuggler").length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceChannels.test.js`
Expected: FAIL — `setDutyStatus is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/serviceChannels.js`:

```javascript
export function setDutyStatus(db, guildId, serviceKey, userId) {
  db.prepare(`
    INSERT OR IGNORE INTO service_duty_status (guild_id, service_key, user_id)
    VALUES (?, ?, ?)
  `).run(guildId, serviceKey, userId);
}

export function clearDutyStatus(db, guildId, serviceKey, userId) {
  db.prepare("DELETE FROM service_duty_status WHERE guild_id = ? AND service_key = ? AND user_id = ?")
    .run(guildId, serviceKey, userId);
}

export function isOnDuty(db, guildId, serviceKey, userId) {
  return !!db.prepare("SELECT 1 FROM service_duty_status WHERE guild_id = ? AND service_key = ? AND user_id = ?")
    .get(guildId, serviceKey, userId);
}

export function listOnDuty(db, guildId, serviceKey) {
  return db.prepare("SELECT * FROM service_duty_status WHERE guild_id = ? AND service_key = ? ORDER BY started_at ASC")
    .all(guildId, serviceKey);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceChannels.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serviceChannels.js test/serviceChannels.test.js
git commit -m "feat: service_duty_status accessors (mentat#372)"
```

---

### Task 4: `service_applications` accessors (with the real race guard)

**Files:**
- Modify: `src/serviceChannels.js`
- Test: `test/serviceChannels.test.js`

**Interfaces:**
- Consumes: the `UNIQUE` partial index from Task 1.
- Produces: `createApplication(db, {guildId, serviceKey, applicantId, characterName, proofLink})` → `{ ok: true, application } | { ok: false, reason: "already_pending" }`; `getPendingApplication(db, guildId, serviceKey, applicantId)`; `setApplicationReviewMessage(db, applicationId, reviewMessageId)`; `getApplication(db, applicationId)`; `resolveApplication(db, guildId, applicationId, {status, reviewedBy})` → updated row, or `null` if not found / wrong guild. Task 7 (Apply handler), Task 8 (modal submit), and Task 9 (Approve/Deny) import these.

- [ ] **Step 1: Write the failing test**

Append to `test/serviceChannels.test.js`:

```javascript
import { createApplication, getPendingApplication, setApplicationReviewMessage, getApplication, resolveApplication } from "../src/serviceChannels.js";

test("createApplication succeeds and getPendingApplication finds it", () => {
  const db = fakeDb();
  const result = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "Muad'Dib", proofLink: "https://example.test/proof" });
  assert.equal(result.ok, true);
  assert.equal(result.application.character_name, "Muad'Dib");
  assert.equal(result.application.status, "pending");
  const pending = getPendingApplication(db, GUILD_ID, "water-seller", "user-1");
  assert.equal(pending.id, result.application.id);
});

test("createApplication rejects a second pending application for the same guild+service+applicant -- the real race guard, not just a pre-check", () => {
  const db = fakeDb();
  const first = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  assert.equal(first.ok, true);
  // Simulate the race directly: insert a second pending row without going
  // through the pre-check, proving the UNIQUE index -- not app logic --
  // is what actually blocks it.
  const second = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "B", proofLink: null });
  assert.equal(second.ok, false);
  assert.equal(second.reason, "already_pending");
});

test("createApplication allows a new pending application once the prior one is resolved", () => {
  const db = fakeDb();
  const first = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  resolveApplication(db, GUILD_ID, first.application.id, { status: "denied", reviewedBy: "admin-1" });
  const second = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "B", proofLink: null });
  assert.equal(second.ok, true);
});

test("setApplicationReviewMessage then getApplication reflects the stored message ID", () => {
  const db = fakeDb();
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  setApplicationReviewMessage(db, application.id, "review-msg-1");
  assert.equal(getApplication(db, application.id).review_message_id, "review-msg-1");
});

test("resolveApplication updates status/reviewedBy/reviewedAt and returns the row", () => {
  const db = fakeDb();
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  const resolved = resolveApplication(db, GUILD_ID, application.id, { status: "approved", reviewedBy: "admin-1" });
  assert.equal(resolved.status, "approved");
  assert.equal(resolved.reviewed_by, "admin-1");
  assert.ok(resolved.reviewed_at);
});

test("resolveApplication returns null for an application belonging to a different guild -- cross-tenant guard", () => {
  const db = fakeDb();
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  const resolved = resolveApplication(db, "some-other-guild", application.id, { status: "approved", reviewedBy: "admin-1" });
  assert.equal(resolved, null);
  // Confirm it truly wasn't mutated.
  assert.equal(getApplication(db, application.id).status, "pending");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceChannels.test.js`
Expected: FAIL — `createApplication is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/serviceChannels.js`:

```javascript
export function getPendingApplication(db, guildId, serviceKey, applicantId) {
  return db.prepare(`
    SELECT * FROM service_applications
    WHERE guild_id = ? AND service_key = ? AND applicant_id = ? AND status = 'pending'
  `).get(guildId, serviceKey, applicantId);
}

export function getApplication(db, applicationId) {
  return db.prepare("SELECT * FROM service_applications WHERE id = ?").get(applicationId);
}

// createApplication: the pre-check via getPendingApplication() (done by
// the caller in serviceComponent.js, Task 7, before ever showing the
// modal) is a fast, friendly first line -- this function's own
// try/catch around the INSERT is the real, authoritative guard, since
// idx_service_applications_pending (Task 1) is a UNIQUE partial index.
// Two near-simultaneous calls for the same guild+service+applicant will
// have exactly one succeed and one land here with a caught constraint
// violation, translated to a typed result instead of throwing a raw
// SQLITE_CONSTRAINT at the caller (Layer 1 Architect/DBA/QA finding).
export function createApplication(db, { guildId, serviceKey, applicantId, characterName, proofLink }) {
  try {
    const result = db.prepare(`
      INSERT INTO service_applications (guild_id, service_key, applicant_id, character_name, proof_link)
      VALUES (?, ?, ?, ?, ?)
    `).run(guildId, serviceKey, applicantId, characterName, proofLink || null);
    return { ok: true, application: getApplication(db, result.lastInsertRowid) };
  } catch (error) {
    // Verified directly against the real better-sqlite3 package installed
    // in this repo: a partial UNIQUE index violation throws with
    // error.code === "SQLITE_CONSTRAINT_UNIQUE" (message: "UNIQUE
    // constraint failed: service_applications.guild_id, ...") -- checking
    // the code is more robust than matching the message string.
    if (error?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return { ok: false, reason: "already_pending" };
    }
    throw error;
  }
}

export function setApplicationReviewMessage(db, applicationId, reviewMessageId) {
  db.prepare("UPDATE service_applications SET review_message_id = ? WHERE id = ?").run(reviewMessageId, applicationId);
}

// resolveApplication: guildId is REQUIRED and part of the WHERE clause
// (Layer 1 Security hat finding -- the original draft keyed this only
// on applicationId, with no guild scoping, a latent cross-tenant gap
// on a confirmed multi-tenant bot). Returns null, not a thrown error,
// for a wrong-guild or nonexistent applicationId -- the caller
// (serviceComponent.js, Task 9) treats null the same as "application
// not found," never leaking whether a differently-scoped row exists.
export function resolveApplication(db, guildId, applicationId, { status, reviewedBy }) {
  const existing = db.prepare("SELECT * FROM service_applications WHERE id = ? AND guild_id = ?").get(applicationId, guildId);
  if (!existing) return null;
  db.prepare(`
    UPDATE service_applications
    SET status = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(status, reviewedBy, applicationId);
  return getApplication(db, applicationId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceChannels.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/serviceChannels.js test/serviceChannels.test.js
git commit -m "feat: service_applications accessors, UNIQUE-constraint race guard (mentat#372)"
```

---

### Task 5: `buildServiceStatusEmbed`

**Files:**
- Create: `src/serviceComponent.js`
- Test: `test/serviceComponent.test.js`

**Interfaces:**
- Consumes: `listOnDuty` (Task 3), `getServiceChannel` (Task 2), `duneEmbed` (`src/embedFormat.js:56`).
- Produces: `buildServiceStatusEmbed(db, guildId, serviceKey, serviceDisplayName)` → `{ embeds: [EmbedBuilder], components: [ActionRowBuilder] }`. Task 6/7/11 all call this to (re)render the pinned status message.

- [ ] **Step 1: Write the failing test**

Create `test/serviceComponent.test.js`:

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";
import { setDutyStatus } from "../src/serviceChannels.js";
import { buildServiceStatusEmbed } from "../src/serviceComponent.js";

function fakeDb() { return createDatabase(":memory:"); }
const GUILD_ID = "111111111111111111";

test("buildServiceStatusEmbed shows the plan's exact empty-roster string when no one is on duty", () => {
  const db = fakeDb();
  const { embeds } = buildServiceStatusEmbed(db, GUILD_ID, "water-seller", "Water-Seller");
  const description = embeds[0].data.description || "";
  const fieldsText = JSON.stringify(embeds[0].data.fields || []);
  assert.ok((description + fieldsText).includes("No one currently on duty"));
});

test("buildServiceStatusEmbed lists on-duty members when present", () => {
  const db = fakeDb();
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  const { embeds } = buildServiceStatusEmbed(db, GUILD_ID, "water-seller", "Water-Seller");
  const fieldsText = JSON.stringify(embeds[0].data.fields || []);
  assert.ok(fieldsText.includes("user-1"));
});

test("buildServiceStatusEmbed returns exactly 3 buttons: On Duty, Off Duty, Apply, with serviceKey-scoped customIds", () => {
  const db = fakeDb();
  const { components } = buildServiceStatusEmbed(db, GUILD_ID, "water-seller", "Water-Seller");
  const buttons = components[0].components;
  assert.equal(buttons.length, 3);
  const customIds = buttons.map(b => b.data.custom_id);
  assert.deepEqual(customIds, ["service:onduty:water-seller", "service:offduty:water-seller", "service:apply:water-seller"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceComponent.test.js`
Expected: FAIL — `Cannot find module '../src/serviceComponent.js'`

- [ ] **Step 3: Write the implementation**

Create `src/serviceComponent.js`:

```javascript
// serviceComponent.js (mentat#372): the generalized On Duty/Off Duty/
// Apply button component. See
// docs/design/service-duty-apply-component-l1-design-2026-09-15.md and
// the Layer 1 audit findings register (mentat#372 issue comments) for
// why each piece of this file is shaped the way it is.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { duneEmbed } from "./embedFormat.js";
import { listOnDuty } from "./serviceChannels.js";

export function buildServiceStatusEmbed(db, guildId, serviceKey, serviceDisplayName) {
  const onDuty = listOnDuty(db, guildId, serviceKey);
  const rosterValue = onDuty.length === 0
    ? "No one currently on duty"
    : onDuty.map(row => `<@${row.user_id}>`).join("\n");

  const embed = duneEmbed({
    title: `${serviceDisplayName} Duty Status`,
    description: "Click below to go on/off duty, or apply for this role.",
    fields: [{ name: "On Duty", value: rosterValue }]
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`service:onduty:${serviceKey}`).setLabel("On Duty").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`service:offduty:${serviceKey}`).setLabel("Off Duty").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`service:apply:${serviceKey}`).setLabel("Apply").setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceComponent.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serviceComponent.js test/serviceComponent.test.js
git commit -m "feat: buildServiceStatusEmbed (mentat#372)"
```

---

### Task 6: On Duty / Off Duty button handler

**Files:**
- Modify: `src/serviceComponent.js`
- Test: `test/serviceComponent.test.js`

**Interfaces:**
- Consumes: `getServiceChannel`, `setDutyStatus`, `clearDutyStatus`, `isOnDuty` (Task 2/3); `getGuildSettings` (`src/database.js:512`); `postOrEditLiveMessage` (`src/liveMessage.js:29`); `buildServiceStatusEmbed` (Task 5); `extractRoleIds` (`src/commands.js:880`, exported).
- Produces: `handleServiceButtonInteraction(interaction, db, client)` — Task 7/9 add more branches to this same function; Task 10 wires it into `index.js`.

- [ ] **Step 1: Write the failing test**

Append to `test/serviceComponent.test.js`:

```javascript
import { setServiceChannel } from "../src/serviceChannels.js";
import { handleServiceButtonInteraction } from "../src/serviceComponent.js";
import { updateGuildSettings } from "../src/database.js";

function stageService(db, overrides = {}) {
  setServiceChannel(db, GUILD_ID, "water-seller", {
    channelId: "chan-1", roleId: "role-water-seller", reviewChannelId: "review-1", requiresReview: true, ...overrides
  });
}

function fakeChannel(sent = []) {
  return {
    isTextBased: () => true,
    send: async (payload) => { const id = `msg-${sent.length + 1}`; sent.push({ id, payload }); return { id }; },
    messages: { fetch: async () => { throw new Error("not found"); } }
  };
}

function fakeClient(sent = []) {
  return { channels: { fetch: async () => fakeChannel(sent) } };
}

test("handleServiceButtonInteraction returns false for a customId it doesn't own", async () => {
  const db = fakeDb();
  const fakeInteraction = { isButton: () => true, customId: "write:confirm:something" };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, false);
});

test("onduty without the role is rejected ephemerally, no DB write, and names the fix", async () => {
  const db = fakeDb();
  stageService(db);
  const replies = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:onduty:water-seller",
    user: { id: "user-1" },
    member: { roles: [] },
    reply: async (payload) => { replies.push(payload); }
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].ephemeral);
  assert.match(replies[0].content, /Apply/);
  const { isOnDuty } = await import("../src/serviceChannels.js");
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), false);
});

test("onduty with the role writes service_duty_status, grants the generic On Duty role if configured, and refreshes the pinned embed", async () => {
  const db = fakeDb();
  stageService(db);
  updateGuildSettings(db, GUILD_ID, { on_duty_role_id: "generic-on-duty-role" });
  const added = [];
  const sent = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:onduty:water-seller",
    user: { id: "user-1" },
    member: { roles: ["role-water-seller"], roles_add: async (roleId) => added.push(roleId) },
    guildId: GUILD_ID,
    deferUpdate: async () => {},
    client: fakeClient(sent)
  };
  fakeInteraction.member.roles = { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() }, add: async (roleId) => added.push(roleId) };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeInteraction.client);
  assert.equal(handled, true);
  const { isOnDuty } = await import("../src/serviceChannels.js");
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), true);
  assert.deepEqual(added, ["generic-on-duty-role"]);
  assert.equal(sent.length, 1, "must post/refresh the pinned status message");
});

test("offduty clears service_duty_status and removes the generic On Duty role", async () => {
  const db = fakeDb();
  stageService(db);
  updateGuildSettings(db, GUILD_ID, { on_duty_role_id: "generic-on-duty-role" });
  const { setDutyStatus } = await import("../src/serviceChannels.js");
  setDutyStatus(db, GUILD_ID, "water-seller", "user-1");
  const removed = [];
  const sent = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:offduty:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() }, remove: async (roleId) => removed.push(roleId) } },
    client: fakeClient(sent)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeInteraction.client);
  assert.equal(handled, true);
  const { isOnDuty } = await import("../src/serviceChannels.js");
  assert.equal(isOnDuty(db, GUILD_ID, "water-seller", "user-1"), false);
  assert.deepEqual(removed, ["generic-on-duty-role"]);
});

test("onduty when on_duty_role_id is unset (default '') skips the generic-role toggle without error", async () => {
  const db = fakeDb();
  stageService(db);
  const sent = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:onduty:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() }, add: async () => { throw new Error("must not be called"); } } },
    client: fakeClient(sent)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeInteraction.client);
  assert.equal(handled, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceComponent.test.js`
Expected: FAIL — `handleServiceButtonInteraction is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/serviceComponent.js` (add imports at the top):

```javascript
import { getServiceChannel, setDutyStatus, clearDutyStatus, isOnDuty } from "./serviceChannels.js";
import { getGuildSettings } from "./database.js";
import { postOrEditLiveMessage } from "./liveMessage.js";
import { extractRoleIds } from "./commands.js";
```

```javascript
async function refreshServiceStatusMessage({ client, db, guildId, serviceChannel, serviceKey }) {
  const { embeds, components } = buildServiceStatusEmbed(db, guildId, serviceKey, serviceKey);
  await postOrEditLiveMessage({
    client, db, guildId,
    channelId: serviceChannel.channel_id,
    messageKey: `service:duty:${serviceKey}`,
    content: { embeds, components }
  });
}

async function toggleGenericOnDutyRole(interaction, db, guildId, grant) {
  const settings = getGuildSettings(db, guildId);
  if (!settings?.on_duty_role_id) return; // Not configured -- optional infra, skip silently.
  if (grant) {
    await interaction.member.roles.add(settings.on_duty_role_id);
  } else {
    await interaction.member.roles.remove(settings.on_duty_role_id);
  }
}

export async function handleServiceButtonInteraction(interaction, db, client) {
  if (!interaction?.isButton?.()) return false;
  const parts = String(interaction.customId || "").split(":");
  if (parts[0] !== "service") return false;
  // Third customId segment: a serviceKey for onduty/offduty/apply, but an
  // applicationId (numeric) for approve/deny -- kept as one destructured
  // `identifier` to make that distinction explicit rather than reusing a
  // `serviceKey`-named variable for something that isn't one in half the
  // branches below.
  const [, action, identifier] = parts;
  const guildId = interaction.guildId;

  if (action === "onduty" || action === "offduty") {
    const serviceKey = identifier;
    const serviceChannel = getServiceChannel(db, guildId, serviceKey);
    const hasRole = extractRoleIds(interaction).includes(serviceChannel?.role_id);
    if (!hasRole) {
      await interaction.reply({
        content: `You need the \`${serviceKey}\` role first — click Apply below.`,
        ephemeral: true
      });
      return true;
    }
    if (action === "onduty") {
      setDutyStatus(db, guildId, serviceKey, interaction.user.id);
      await toggleGenericOnDutyRole(interaction, db, guildId, true);
    } else {
      clearDutyStatus(db, guildId, serviceKey, interaction.user.id);
      await toggleGenericOnDutyRole(interaction, db, guildId, false);
    }
    await refreshServiceStatusMessage({ client, db, guildId, serviceChannel, serviceKey });
    if (typeof interaction.reply === "function" && !interaction.replied) {
      await interaction.reply({ content: action === "onduty" ? "You're now on duty." : "You're now off duty.", ephemeral: true }).catch(() => {});
    }
    return true;
  }

  return false;
}
```

Note for the implementer: the test fakes above use a plain array as `member.roles` in one test and a `{cache: {keys}}` shape in others — `extractRoleIds` (Task's Global Constraints, real implementation at `src/commands.js:880`) already handles both. If a test fails on the reply-call ordering (e.g. `interaction.replied` isn't set by the fake), simplify the fake or the implementation's guard so the test's actual assertions (DB state, role add/remove calls, message-send count) are what's checked — those are the load-bearing assertions, not the exact reply-call mechanics.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceComponent.test.js`
Expected: PASS. If the reply-related assertions are flaky against the exact fakes above, adjust the fakes (not the production logic) until the DB-state and role-mutation assertions pass — those are what this task is actually verifying.

- [ ] **Step 5: Commit**

```bash
git add src/serviceComponent.js test/serviceComponent.test.js
git commit -m "feat: On Duty/Off Duty button handler, generic role toggle (mentat#372)"
```

---

### Task 7: Apply button handler (opens the modal)

**Files:**
- Modify: `src/serviceComponent.js`
- Test: `test/serviceComponent.test.js`

**Interfaces:**
- Consumes: `getPendingApplication` (Task 4); `extractRoleIds` (`src/commands.js:880`).
- Produces: extends `handleServiceButtonInteraction` with the `apply` action, calling `interaction.showModal(...)`.

- [ ] **Step 1: Write the failing test**

Append to `test/serviceComponent.test.js`:

```javascript
test("apply when the user already holds the role is rejected ephemerally before any modal is shown", async () => {
  const db = fakeDb();
  stageService(db);
  const replies = [];
  const shownModals = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:apply:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["role-water-seller"][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload),
    showModal: async (modal) => shownModals.push(modal)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(shownModals.length, 0);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /already/i);
});

test("apply with an existing pending application is rejected ephemerally, no modal shown", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication } = await import("../src/serviceChannels.js");
  createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "A", proofLink: null });
  const replies = [];
  const shownModals = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:apply:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => [][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload),
    showModal: async (modal) => shownModals.push(modal)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(shownModals.length, 0);
  assert.match(replies[0].content, /pending/i);
});

test("apply with no role and no pending application shows the modal with the right customId", async () => {
  const db = fakeDb();
  stageService(db);
  const shownModals = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: "service:apply:water-seller",
    user: { id: "user-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => [][Symbol.iterator]() } } },
    showModal: async (modal) => shownModals.push(modal)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient());
  assert.equal(handled, true);
  assert.equal(shownModals.length, 1);
  assert.equal(shownModals[0].data.custom_id, "service:applymodal:water-seller");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceComponent.test.js`
Expected: FAIL — `apply` action currently falls through `handleServiceButtonInteraction`'s `return false`, so `handled` is `false` and `shownModals`/`replies` stay empty, failing the `assert.equal(handled, true)` lines.

- [ ] **Step 3: Write the implementation**

Add the import at the top of `src/serviceComponent.js`:

```javascript
import { ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { getPendingApplication } from "./serviceChannels.js";
```

Add the `apply` branch inside `handleServiceButtonInteraction`, right before the final `return false;`:

```javascript
  if (action === "apply") {
    const serviceKey = identifier;
    const serviceChannel = getServiceChannel(db, guildId, serviceKey);
    const hasRole = extractRoleIds(interaction).includes(serviceChannel?.role_id);
    if (hasRole) {
      await interaction.reply({ content: `You're already a \`${serviceKey}\`.`, ephemeral: true });
      return true;
    }
    if (getPendingApplication(db, guildId, serviceKey, interaction.user.id)) {
      await interaction.reply({ content: "You already have a pending application.", ephemeral: true });
      return true;
    }
    const modal = new ModalBuilder()
      .setCustomId(`service:applymodal:${serviceKey}`)
      .setTitle(`Apply: ${serviceKey}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("characterName").setLabel("Character Name").setStyle(TextInputStyle.Short).setRequired(true)
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId("proofLink").setLabel("Proof Link (optional)").setStyle(TextInputStyle.Paragraph).setRequired(false)
        )
      );
    await interaction.showModal(modal);
    return true;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceComponent.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serviceComponent.js test/serviceComponent.test.js
git commit -m "feat: Apply button handler, opens the modal (mentat#372)"
```

---

### Task 8: Modal submit handler

**Files:**
- Modify: `src/serviceComponent.js`
- Test: `test/serviceComponent.test.js`

**Interfaces:**
- Consumes: `createApplication`, `setApplicationReviewMessage` (Task 4); `getServiceChannel` (Task 2).
- Produces: `handleServiceModalSubmit(interaction, db, client)` — Task 10 wires this into `index.js`'s new `isModalSubmit?.()` branch.

**Before writing the mock:** this is the bot's first-ever `ModalSubmitInteraction` — check discord.js 14.26.4's real shape (`interaction.fields.getTextInputValue(customId)`, `interaction.customId`, `interaction.isModalSubmit()`) against `node_modules/discord.js/src/structures/ModalSubmitInteraction.js` or the installed type definitions before writing the fake below, rather than inventing the shape from the button fixtures used elsewhere in this file (Layer 1 QA hat finding — no existing fixture in this codebase covers a modal).

- [ ] **Step 1: Write the failing test**

Append to `test/serviceComponent.test.js`:

```javascript
import { handleServiceModalSubmit } from "../src/serviceComponent.js";

function fakeModalInteraction({ serviceKey = "water-seller", characterName = "Muad'Dib", proofLink = "https://example.test", userId = "user-1" } = {}) {
  return {
    isModalSubmit: () => true,
    customId: `service:applymodal:${serviceKey}`,
    guildId: GUILD_ID,
    user: { id: userId },
    fields: {
      getTextInputValue: (id) => (id === "characterName" ? characterName : proofLink)
    },
    replied: false,
    reply: async function (payload) { this.replied = true; this._reply = payload; }
  };
}

test("handleServiceModalSubmit returns false for a customId it doesn't own", async () => {
  const db = fakeDb();
  const handled = await handleServiceModalSubmit({ isModalSubmit: () => true, customId: "other:thing:x" }, db, fakeClient());
  assert.equal(handled, false);
});

test("handleServiceModalSubmit creates the application, posts to the review channel with proof_link as plain text (never markdown-link syntax), and acknowledges the applicant", async () => {
  const db = fakeDb();
  stageService(db);
  const sentToReview = [];
  const reviewChannel = {
    isTextBased: () => true,
    send: async (payload) => { sentToReview.push(payload); return { id: "review-msg-1" }; }
  };
  const client = { channels: { fetch: async (id) => (id === "review-1" ? reviewChannel : fakeChannel()) } };
  const interaction = fakeModalInteraction({ proofLink: "[legit](https://phish.test)" });
  const handled = await handleServiceModalSubmit(interaction, db, client);
  assert.equal(handled, true);
  assert.equal(interaction.replied, true);
  assert.match(interaction._reply.content, /DM/i);

  const { getPendingApplication, getApplication } = await import("../src/serviceChannels.js");
  const pending = getPendingApplication(db, GUILD_ID, "water-seller", "user-1");
  assert.ok(pending);
  assert.equal(pending.review_message_id, "review-msg-1");

  assert.equal(sentToReview.length, 1);
  const postedText = JSON.stringify(sentToReview[0]);
  assert.ok(!postedText.includes("[legit]("), "proof_link must never be rendered as markdown link syntax");
  assert.ok(postedText.includes("https://phish.test") || postedText.includes("legit"), "the raw text must still be visible to reviewers, just not as a clickable masked link");
});

test("handleServiceModalSubmit rejects a race-losing duplicate submission with a friendly message, not a raw DB error", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication } = await import("../src/serviceChannels.js");
  createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "user-1", characterName: "X", proofLink: null });
  const interaction = fakeModalInteraction();
  const handled = await handleServiceModalSubmit(interaction, db, fakeClient());
  assert.equal(handled, true);
  assert.match(interaction._reply.content, /pending/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceComponent.test.js`
Expected: FAIL — `handleServiceModalSubmit is not a function`

- [ ] **Step 3: Write the implementation**

Add the import at the top of `src/serviceComponent.js`:

```javascript
import { createApplication, setApplicationReviewMessage } from "./serviceChannels.js";
import { duneEmbed } from "./embedFormat.js";
```

(if `duneEmbed`/`createApplication` aren't already imported from earlier tasks, add them; do not duplicate an existing import line — merge into it.)

Append to `src/serviceComponent.js`:

```javascript
export async function handleServiceModalSubmit(interaction, db, client) {
  if (!interaction?.isModalSubmit?.()) return false;
  const parts = String(interaction.customId || "").split(":");
  if (parts[0] !== "service" || parts[1] !== "applymodal") return false;
  const serviceKey = parts[2];
  const guildId = interaction.guildId;

  const characterName = interaction.fields.getTextInputValue("characterName");
  const proofLink = interaction.fields.getTextInputValue("proofLink") || null;

  const result = createApplication(db, {
    guildId, serviceKey, applicantId: interaction.user.id, characterName, proofLink
  });

  if (!result.ok) {
    await interaction.reply({ content: "You already have a pending application.", ephemeral: true });
    return true;
  }

  const serviceChannel = getServiceChannel(db, guildId, serviceKey);
  const reviewEmbed = duneEmbed({
    title: `New Application: ${serviceKey}`,
    fields: [
      { name: "Applicant", value: `<@${interaction.user.id}>` },
      { name: "Character Name", value: characterName },
      // proof_link is rendered as a plain-text/code-block field --
      // NEVER interpolated into markdown link syntax ([label](url)) --
      // an applicant-controlled label over an applicant-controlled URL
      // would let a malicious applicant phish staff reviewers with a
      // deceptive display label (Layer 1 Security hat finding).
      { name: "Proof Link", value: proofLink ? `\`${proofLink}\`` : "(none provided)" }
    ]
  });
  const approveDenyRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`service:approve:${result.application.id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`service:deny:${result.application.id}`).setLabel("Deny").setStyle(ButtonStyle.Danger)
  );

  const reviewChannel = await client.channels.fetch(serviceChannel.review_channel_id);
  const reviewMessage = await reviewChannel.send({ embeds: [reviewEmbed], components: [approveDenyRow] });
  setApplicationReviewMessage(db, result.application.id, reviewMessage.id);

  await interaction.reply({
    content: "Your application has been submitted. You'll be notified by DM once it's reviewed.",
    ephemeral: true
  });
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceComponent.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/serviceComponent.js test/serviceComponent.test.js
git commit -m "feat: modal submit handler, application review post (mentat#372)"
```

---

### Task 9: Approve / Deny button handler

**Files:**
- Modify: `src/serviceComponent.js`
- Test: `test/serviceComponent.test.js`

**Interfaces:**
- Consumes: `resolveApplication`, `getApplication` (Task 4); `isAdminActor` (`src/commands.js:971`, exported).
- Produces: extends `handleServiceButtonInteraction` with `approve`/`deny` actions.

- [ ] **Step 1: Write the failing test**

Append to `test/serviceComponent.test.js`:

```javascript
import { isAdminActor } from "../src/commands.js";

function fakeConfig(multiTenant = false) { return { multiTenant }; }

test("non-admin clicking Approve/Deny gets an explicit ephemeral rejection, no mutation", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication, getApplication } = await import("../src/serviceChannels.js");
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "applicant-1", characterName: "A", proofLink: null });
  const replies = [];
  const fakeInteraction = {
    isButton: () => true,
    customId: `service:approve:${application.id}`,
    user: { id: "not-an-admin" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => [][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient(), fakeConfig());
  assert.equal(handled, true);
  assert.match(replies[0].content, /not authorized/i);
  assert.equal(getApplication(db, application.id).status, "pending");
});

test("admin Approve grants the role, marks approved, edits the review message, best-effort DMs the applicant", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication, getApplication } = await import("../src/serviceChannels.js");
  const { application } = createApplication(db, { guildId: GUILD_ID, serviceKey: "water-seller", applicantId: "applicant-1", characterName: "A", proofLink: null });
  const { setApplicationReviewMessage } = await import("../src/serviceChannels.js");
  setApplicationReviewMessage(db, application.id, "review-msg-1");
  const granted = [];
  const dmsSent = [];
  const edits = [];
  const reviewChannel = { isTextBased: () => true, messages: { fetch: async () => ({ edit: async (payload) => edits.push(payload) }) } };
  const client = {
    channels: { fetch: async (id) => (id === "review-1" ? reviewChannel : fakeChannel()) },
    users: { fetch: async (id) => ({ id, send: async (payload) => dmsSent.push({ id, payload }) }) },
    guilds: { fetch: async () => ({ members: { fetch: async () => ({ roles: { add: async (roleId) => granted.push(roleId) } }) } }) }
  };
  const fakeInteraction = {
    isButton: () => true,
    customId: `service:approve:${application.id}`,
    user: { id: "admin-1" },
    guildId: GUILD_ID,
    member: { roles: { cache: { keys: () => ["some-admin-role"][Symbol.iterator]() } } },
    reply: async () => {}
  };
  process.env.DISCORD_ADMIN_ROLE_IDS = "some-admin-role";
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, client, fakeConfig());
  delete process.env.DISCORD_ADMIN_ROLE_IDS;
  assert.equal(handled, true);
  assert.deepEqual(granted, ["role-water-seller"]);
  assert.equal(getApplication(db, application.id).status, "approved");
  assert.equal(edits.length, 1);
  assert.equal(dmsSent.length, 1);
});

test("Approve/Deny for an application from a different guild is rejected -- cross-tenant guard", async () => {
  const db = fakeDb();
  stageService(db);
  const { createApplication, getApplication } = await import("../src/serviceChannels.js");
  const { application } = createApplication(db, { guildId: "other-guild", serviceKey: "water-seller", applicantId: "applicant-1", characterName: "A", proofLink: null });
  const replies = [];
  process.env.DISCORD_ADMIN_ROLE_IDS = "some-admin-role";
  const fakeInteraction = {
    isButton: () => true,
    customId: `service:approve:${application.id}`,
    user: { id: "admin-1" },
    guildId: GUILD_ID, // different guild than the application's own guild_id
    member: { roles: { cache: { keys: () => ["some-admin-role"][Symbol.iterator]() } } },
    reply: async (payload) => replies.push(payload)
  };
  const handled = await handleServiceButtonInteraction(fakeInteraction, db, fakeClient(), fakeConfig());
  delete process.env.DISCORD_ADMIN_ROLE_IDS;
  assert.equal(handled, true);
  assert.equal(getApplication(db, application.id).status, "pending");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/serviceComponent.test.js`
Expected: FAIL — `approve`/`deny` currently fall through `return false`.

- [ ] **Step 3: Write the implementation**

Add imports at the top of `src/serviceComponent.js`:

```javascript
import { resolveApplication } from "./serviceChannels.js";
import { isAdminActor } from "./commands.js";
```

Update `handleServiceButtonInteraction`'s signature to accept `config` (Task 10 will pass the bot's real `config` object, matching every other admin-gated handler in this codebase): `export async function handleServiceButtonInteraction(interaction, db, client, config) {`.

Add the `approve`/`deny` branch, right before the final `return false;`:

```javascript
  if (action === "approve" || action === "deny") {
    if (!isAdminActor(interaction, config, db, guildId)) {
      await interaction.reply({ content: "You are not authorized to review applications.", ephemeral: true });
      return true;
    }

    const applicationId = Number(identifier);
    // The guild_id !== interaction.guildId check happens inside
    // resolveApplication() itself -- it returns null for a cross-guild or
    // nonexistent ID, and we treat that the same way (Layer 1 Security hat
    // finding: never leak whether a differently-scoped row exists) --
    // there's no need to pre-fetch the application separately here.
    const status = action === "approve" ? "approved" : "denied";
    const resolved = resolveApplication(db, guildId, applicationId, { status, reviewedBy: interaction.user.id });
    if (!resolved) {
      await interaction.reply({ content: "That application could not be found.", ephemeral: true });
      return true;
    }

    const serviceChannel = getServiceChannel(db, guildId, resolved.service_key);
    let roleGrantFailed = false;
    if (action === "approve") {
      try {
        const guild = await interaction.client?.guilds?.fetch?.(guildId) ?? { members: { fetch: async () => { throw new Error("no guild"); } } };
        const member = await guild.members.fetch(resolved.applicant_id);
        await member.roles.add(serviceChannel.role_id);
      } catch {
        roleGrantFailed = true;
      }
    }

    // Edit the review message to remove the buttons and show the outcome.
    try {
      const reviewChannel = await client.channels.fetch(serviceChannel.review_channel_id);
      const reviewMessage = await reviewChannel.messages.fetch(resolved.review_message_id);
      const outcomeLine = action === "approve"
        ? (roleGrantFailed
          ? `Approved by <@${interaction.user.id}> — role grant FAILED, add \`@${serviceChannel.role_id}\` manually`
          : `Approved by <@${interaction.user.id}>`)
        : `Denied by <@${interaction.user.id}>`;
      await reviewMessage.edit({ content: outcomeLine, embeds: [], components: [] });
    } catch {
      // Stale/deleted review message -- the DB mutation above already
      // happened and is the source of truth; don't throw.
    }

    // Best-effort DM -- never blocks the transaction above.
    try {
      const applicantUser = await interaction.client.users.fetch(resolved.applicant_id);
      await applicantUser.send({ content: `Your \`${resolved.service_key}\` application was ${status}.` });
    } catch {
      // DMs closed or user unreachable -- swallow, per design.
    }

    return true;
  }
```

Update Task 10's `index.js` wiring to pass `config` as the 4th argument (already planned below).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/serviceComponent.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/serviceComponent.js test/serviceComponent.test.js
git commit -m "feat: Approve/Deny handler, admin gate + cross-tenant guard (mentat#372)"
```

---

### Task 10: Wire into `index.js` (button dispatch + new modal-submit branch)

**Files:**
- Modify: `src/index.js`
- Test: `test/index.test.js` (create if it doesn't already cover this dispatch chain; otherwise extend the existing file testing this fallthrough — check first with `grep -rn "handleOwnerConfirmationButtonInteraction" test/` to find where this chain is already exercised, and add alongside it rather than creating a duplicate test file)

**Interfaces:**
- Consumes: `handleServiceButtonInteraction`, `handleServiceModalSubmit` (Task 6-9).
- Produces: real end-to-end routing for both interaction types — this is the wiring QA's Layer 1 finding required.

- [ ] **Step 1: Write the failing test**

First run `grep -rn "handleOwnerConfirmationButtonInteraction\|isButton" /root/projects/repos/mentat/test/*.js` to confirm whether `index.js`'s dispatch chain is unit-tested directly (it may only be exercised indirectly via `ownerConfirmation.test.js` testing the handler function itself, not `index.js`'s wiring). If no test exists that imports and exercises `index.js`'s interaction-handling function directly, create `test/index.test.js`:

```javascript
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "../src/database.js";

// index.js's top-level interaction listener isn't itself exported for
// direct unit testing (it's registered via client.on("interactionCreate", ...)
// inside startBot()/main()) -- if that's confirmed true by reading index.js,
// this test instead targets the smallest exported unit that reproduces the
// exact routing-order bug this task exists to prevent: import
// handleServiceButtonInteraction and handleServiceModalSubmit directly and
// assert BOTH return false for an interaction shaped like the OTHER type,
// proving neither swallows an interaction meant for its sibling handler --
// the same "returns false for a customId it doesn't own" contract every
// other handler in this dispatch chain already has a test for.
import { handleServiceButtonInteraction } from "../src/serviceComponent.js";
import { handleServiceModalSubmit } from "../src/serviceComponent.js";

test("handleServiceButtonInteraction returns false (not throws) for a modal-submit-shaped interaction", async () => {
  const db = createDatabase(":memory:");
  const modalShapedInteraction = { isButton: () => false, isModalSubmit: () => true, customId: "service:applymodal:water-seller" };
  const handled = await handleServiceButtonInteraction(modalShapedInteraction, db, {});
  assert.equal(handled, false);
});

test("handleServiceModalSubmit returns false (not throws) for a button-shaped interaction", async () => {
  const db = createDatabase(":memory:");
  const buttonShapedInteraction = { isButton: () => true, isModalSubmit: () => false, customId: "service:onduty:water-seller" };
  const handled = await handleServiceModalSubmit(buttonShapedInteraction, db, {});
  assert.equal(handled, false);
});
```

If, after reading `src/index.js`, you find its interaction listener IS structured as an exported, directly-testable function (check for `export function handleInteraction` or similar near the `isButton?.()` block) — write the test against that exported function instead, asserting a real `isModalSubmit: () => true` interaction reaches `handleServiceModalSubmit` and a real `service:onduty:...` button interaction reaches `handleServiceButtonInteraction`, mirroring this task's Step 1 intent exactly (this is stronger than the fallback above and should be preferred if available).

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/index.test.js` (or wherever Step 1 landed)
Expected: PASS actually, if Task 6-9 are already correct in isolation — the point of this task is the *wiring*, so also manually trace `src/index.js` to confirm the new branch doesn't exist yet: `grep -n "isModalSubmit" src/index.js` should currently return nothing before Step 3.

- [ ] **Step 3: Wire the dispatch in `src/index.js`**

Add the import near the top of `src/index.js` alongside the existing `handleOwnerConfirmationButtonInteraction`/`handleWriteButtonInteraction` imports:

```javascript
import { handleServiceButtonInteraction, handleServiceModalSubmit } from "./serviceComponent.js";
```

Inside the existing `if (interaction.isButton?.()) { ... }` block (around line 288), add the new handler call right after the `ownerConfirmationHandled` check and before the closing comment:

```javascript
      const serviceButtonHandled = await handleServiceButtonInteraction(interaction, db, interaction.client, config);
      if (serviceButtonHandled) return;
```

Add a new branch for modal submits, right before the existing `if (interaction.isMessageComponent?.()) { return; }` block (this is the bot's first-ever `isModalSubmit?.()` branch):

```javascript
    // mentat#372: this bot's first-ever ModalSubmitInteraction branch.
    // Must be checked here, before the isMessageComponent?.() catch-all
    // below and before executeDuneCommand() at the bottom -- a modal
    // submission is neither a button nor a chat-input command, and
    // would otherwise reach neither dispatch path and silently no-op.
    if (interaction.isModalSubmit?.()) {
      const serviceModalHandled = await handleServiceModalSubmit(interaction, db, interaction.client);
      if (serviceModalHandled) return;
      return;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/index.test.js` (or wherever Step 1 landed), then `npm test` for the full suite.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/index.js test/index.test.js
git commit -m "feat: wire service button/modal handlers into index.js dispatch chain (mentat#372)"
```

---

### Task 11: `/dune admin service-setup` command

**Files:**
- Modify: `src/commands.js` (`buildDuneCommand()` SlashCommandBuilder, `executeDuneCommand()` dispatch)
- Test: `test/commands.test.js`

**Interfaces:**
- Consumes: `setServiceChannel`, `getServiceChannel`, `listServiceChannels` (Task 2); `buildServiceStatusEmbed` (Task 5); `isAdminActor` (`src/commands.js:971`).
- Produces: the `admin service-setup` subcommand, provisioning a channel end-to-end.

- [ ] **Step 1: Write the failing test**

Add to `test/commands.test.js`, using this file's existing `mockInteraction(group, subcommand, opts)`/`mockOptions(group, subcommand, overrides)` helpers (defined near the top of the file, already used by every other `admin:*` dispatch test — e.g. `admin:broadcast`) rather than a new fake-interaction shape:

```javascript
import { createDatabase } from "../src/database.js";
import { getServiceChannel } from "../src/serviceChannels.js";

function fakeServiceSetupInteraction({ serviceKey = "water-seller", channel = "chan-1", role = null, applicationsChannel = null, roles = ["admin-role"] } = {}) {
  const created = [];
  const sentMessages = [];
  const pinned = [];
  const interaction = mockInteraction("admin", "service-setup", {
    user: { id: "admin-1" },
    roles,
    options: mockOptions("admin", "service-setup", {
      getString: (name) => ({
        "service-key": serviceKey,
        channel,
        role,
        "applications-channel": applicationsChannel
      })[name] || null
    })
  });
  interaction.guild = {
    roles: { create: async ({ name }) => { const id = `role-${name}`; created.push(id); return { id }; } }
  };
  interaction.client = {
    channels: {
      fetch: async () => ({
        send: async (payload) => {
          sentMessages.push(payload);
          return { id: "status-msg-1", pin: async () => pinned.push("status-msg-1") };
        }
      })
    }
  };
  return { interaction, created, sentMessages, pinned };
}

function fakeConfigForAdmin({ multiTenant = false } = {}) {
  return {
    multiTenant,
    discord: { defaultEphemeral: true, rbac: { mode: "open" }, adminRoleIds: ["admin-role"] }
  };
}

test("admin:service-setup creates the role if missing, writes the registry row, posts and pins the status embed", async () => {
  const db = createDatabase(":memory:");
  const { interaction, created, sentMessages, pinned } = fakeServiceSetupInteraction({ applicationsChannel: "review-1" });
  const handled = await executeDuneCommand(interaction, {}, fakeConfigForAdmin(), db);
  assert.equal(handled, true);
  assert.equal(created.length, 1, "must create a role since none was passed");
  const row = getServiceChannel(db, interaction.guildId, "water-seller");
  assert.equal(row.channel_id, "chan-1");
  assert.equal(row.role_id, created[0]);
  assert.equal(row.review_channel_id, "review-1");
  assert.equal(sentMessages.length, 1);
  assert.deepEqual(pinned, ["status-msg-1"]);
});

test("admin:service-setup is blocked for a non-admin caller", async () => {
  // executeDuneCommand's isAdminActor throw is caught by its own top-level
  // try/catch (src/commands.js:343-751) and turned into a normal
  // interaction.editReply({embeds:[...]}) error embed via sendError() --
  // it does NOT propagate as a rejection. Every admin-gated subcommand in
  // this file follows this same pattern (confirmed by reading the catch
  // block directly), so assert against the edited reply, not a throw.
  const db = createDatabase(":memory:");
  const { interaction } = fakeServiceSetupInteraction({ applicationsChannel: "review-1", roles: [] });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  const handled = await executeDuneCommand(interaction, {}, fakeConfigForAdmin(), db);
  assert.equal(handled, true);
  const description = edited?.embeds?.[0]?.data?.description || "";
  assert.match(description, /admin or owner role/);
});

test("admin:service-setup reuses the prior applications-channel when the argument is omitted on a guild's second invocation", async () => {
  const db = createDatabase(":memory:");
  const first = fakeServiceSetupInteraction({ serviceKey: "water-seller", channel: "chan-1", applicationsChannel: "review-1" });
  await executeDuneCommand(first.interaction, {}, fakeConfigForAdmin(), db);

  const second = fakeServiceSetupInteraction({ serviceKey: "smuggler", channel: "chan-2", applicationsChannel: null });
  await executeDuneCommand(second.interaction, {}, fakeConfigForAdmin(), db);

  const row = getServiceChannel(db, second.interaction.guildId, "smuggler");
  assert.equal(row.review_channel_id, "review-1", "must reuse the guild's already-configured applications channel");
});

test("admin:service-setup fails with a clear error when applications-channel is omitted and no prior service_channels row exists for the guild", async () => {
  // Same throw-caught-by-sendError() pathway as the non-admin test above --
  // executeServiceSetup() throws here rather than returning an {ok:false}
  // payload, for consistency with every other admin:* error path in this
  // function (Step 3 below).
  const db = createDatabase(":memory:");
  const { interaction } = fakeServiceSetupInteraction({ applicationsChannel: null });
  let edited;
  interaction.editReply = async (payload) => { edited = payload; };
  const handled = await executeDuneCommand(interaction, {}, fakeConfigForAdmin(), db);
  assert.equal(handled, true);
  const description = edited?.embeds?.[0]?.data?.description || "";
  assert.match(description, /applications-channel is required/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/commands.test.js`
Expected: FAIL — `Unknown command: admin:service-setup` (the existing `else { payload = { ok: false, error: ... } }` fallback in `executeDuneCommand()`).

- [ ] **Step 3: Write the implementation**

In `buildDuneCommand()`, add to the `admin` subcommand group (right after the existing `.addSubcommand((c) => c.setName("broadcast")...)` line, inside the same `.addSubcommandGroup((g) => g.setName("admin")...)` chain):

```javascript
      .addSubcommand((c) => c.setName("service-setup").setDescription("Provision a service channel's duty/apply component (mentat#372).")
        .addStringOption((o) => o.setName("service-key").setDescription("Short key, e.g. water-seller").setRequired(true))
        .addStringOption((o) => o.setName("channel").setDescription("Channel ID for the service's pinned status embed").setRequired(true))
        .addStringOption((o) => o.setName("role").setDescription("Role ID to gate this service (created if omitted)").setRequired(false))
        .addStringOption((o) => o.setName("applications-channel").setDescription("Channel ID for staff application review (required on a guild's first call)").setRequired(false)))
```

In `executeDuneCommand()`, add a new `else if` branch alongside the existing `admin:broadcast` branch:

```javascript
    } else if (key === "admin:service-setup") {
      if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Service setup requires admin or owner role.");
      payload = await executeServiceSetup({ interaction, db, guildId });
    }
```

Add the import at the top of `src/commands.js`:

```javascript
import { setServiceChannel, getServiceChannel, listServiceChannels } from "./serviceChannels.js";
import { buildServiceStatusEmbed } from "./serviceComponent.js";
```

Add the new function (near the other `execute*` helpers in this file, e.g. near `executeBroadcast`):

```javascript
async function executeServiceSetup({ interaction, db, guildId }) {
  const serviceKey = interaction.options.getString("service-key");
  const channelId = interaction.options.getString("channel");
  let roleId = interaction.options.getString("role");
  let reviewChannelId = interaction.options.getString("applications-channel");

  if (!roleId) {
    const role = await interaction.guild.roles.create({ name: serviceKey });
    roleId = role.id;
  }

  if (!reviewChannelId) {
    const existing = listServiceChannels(db, guildId)[0];
    if (!existing) {
      // Thrown, not returned as {ok:false} -- consistent with every other
      // admin:* error path in this function (isAdminActor above, the
      // UNMERGED_ROUTES/MISSING_ROUTES branches elsewhere), which this
      // function's own top-level try/catch (src/commands.js:343-751)
      // catches and turns into a normal interaction.editReply() error
      // embed via sendError(), never a raw exception reaching the caller.
      throw new Error("applications-channel is required the first time this command is run for this guild -- pass it explicitly.");
    }
    reviewChannelId = existing.review_channel_id;
  }

  setServiceChannel(db, guildId, serviceKey, { channelId, roleId, reviewChannelId, requiresReview: true });

  const { embeds, components } = buildServiceStatusEmbed(db, guildId, serviceKey, serviceKey);
  const channel = await interaction.client.channels.fetch(channelId);
  const message = await channel.send({ embeds, components });
  await message.pin();

  return { ok: true, serviceKey, channelId, roleId, reviewChannelId, statusMessageId: message.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/commands.test.js`
Expected: PASS

- [ ] **Step 5: Update `getCommandRegistry()` and `helpPayload()`**

`src/commands.js`'s `getCommandRegistry()` display-only list and `helpPayload()`'s separately-hardcoded `all` array both need a new entry for `admin service-setup` — grep for how `admin broadcast` appears in each and add a matching line for `service-setup`. Update the `helpPayload` test's stale count comment (`test/commands.test.js` — search for the numeric comment near the `helpPayload` test, e.g. `// 57 commands total`, and bump it by 1), matching the exact pattern already established for the coriolis command addition (#378).

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/commands.js test/commands.test.js
git commit -m "feat: /dune admin service-setup command (mentat#372)"
```

---

### Task 12: Documentation

**Files:**
- Modify: `CHANGELOG.md`, `docs/user-guide.md`

**Interfaces:** none (docs only).

- [ ] **Step 1: Add a `CHANGELOG.md` entry**

Under the `[Unreleased]` heading (or today's date section, matching this repo's existing convention — check the top of the file), add:

```markdown
### Added
- `/dune admin service-setup` and the generalized service duty/apply button component (mentat#372): On Duty/Off Duty/Apply buttons per service channel, an application review flow posting to a staff channel with Approve/Deny, wired for two pilot channels (Water-Seller, Smuggler). See `docs/design/service-duty-apply-component-l1-design-2026-09-15.md` for the design and its Layer 1 audit findings.
```

- [ ] **Step 2: Add a `docs/user-guide.md` row**

Find the Command Groups table (same table `/dune server coriolis` was added to in #378) and add a row for `/dune admin service-setup`, matching that table's existing column format exactly.

- [ ] **Step 3: Run the docs-drift check**

Run: `npm run docs:check-architecture-drift`
Expected: PASS (this task doesn't touch `docs/architecture.md`'s claims about Postgres access, so it should be unaffected — run it anyway per Requirement 14, don't assume).

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md docs/user-guide.md
git commit -m "docs: document /dune admin service-setup and the service duty/apply component (mentat#372)"
```

---

### Task 13: Full suite, Requirement 20 Layer 2 audit, PR, pilot-channel manual QA

**Files:** none (process task).

- [ ] **Step 1: Run the full suite one more time**

Run: `npm test && npm run registry:validate && npm run docs:check-architecture-drift`
Expected: PASS

- [ ] **Step 2: Push the branch and open a PR**

```bash
git push -u origin issue/372-service-duty-apply-component
gh pr create --draft --title "feat: generalized service duty/apply button component (mentat#372)" --body "..."
```
PR body must reference the design doc, note this is mentat's first `ModalBuilder`/`isModalSubmit` usage, and list the pilot channels (Water-Seller, Smuggler) — follow this repo's own established PR-body conventions (see PR #378 for the template).

- [ ] **Step 3: Dispatch the Requirement 20 Layer 2 (implementation) audit**

Dispatch all eight hats (Network + Cloud Security may again be combined if judged low-risk, but state that judgment explicitly rather than skip) against the real diff — not the design doc this time, the actual code from Tasks 1-12. Post the findings register + STRIDE table as a comment on mentat#372, matching the format already used for the Layer 1 audit. Resolve CRITICAL/HIGH before proceeding; file MEDIUM/LOW as issues with justification, same as Layer 1.

- [ ] **Step 4: Manual QA in a test guild (never the live guild)**

Run `/dune admin service-setup` for both Water-Seller and Smuggler in a test guild. Walk every path named in the design doc's Testing Strategy section: apply as a test account, approve/deny as an admin account, verify role grant, the generic On Duty role toggle, pinned-embed roster refresh, the "no role, click On Duty" rejection, and a DM-closed test account's Approve flow.

- [ ] **Step 5: Mark the PR ready, wait for the Layer 3 (integration) audit**

Once Layer 2 findings are resolved and manual QA passes, mark the PR ready for review and either request `/code-review ultra` from the operator or run a local `/code-review high` pass per Requirement 20's Layer 3 gate, before merging.
