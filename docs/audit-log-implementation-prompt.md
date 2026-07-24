# Implementation Prompt — Persistent Audit Log for Destructive Commands

**Status note:** unlike the Steam-link and calculator features' own
implementation prompts, this one describes work that is **already
implemented** in this same PR/branch. It is included for consistency with
this repo's established 5-doc package convention, and to serve as a
reference for exactly what changed and why, for a future reader who
wants the "if I had to redo this" version rather than reading the diff
directly. If you are starting fresh (e.g. reverting this feature and
reimplementing it differently), the steps below are still accurate and
sufficient to reproduce the same result.

**Read `docs/audit-log-design.md`, `docs/audit-log-architecture.md`, and
`docs/audit-log-security-review.md` in full first.**

## Single-repo change (`Arrakis-Control-Panel` only)

### 1. `src/database.js` — new table + CRUD functions

Bump `SCHEMA_VERSION` from `2` to `3`. Add to the `SCHEMA` template
string:

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'discord-command',
  guild_id TEXT NOT NULL DEFAULT '',
  discord_user_id TEXT NOT NULL DEFAULT '',
  discord_username TEXT NOT NULL DEFAULT '',
  channel_id TEXT NOT NULL DEFAULT '',
  command TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  capability TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL DEFAULT 'unknown' CHECK(result IN ('success', 'denied', 'failed', 'pending', 'unknown')),
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_guild ON audit_log(guild_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_command ON audit_log(command);
```

**Do not omit `'unknown'` from the CHECK constraint's allowed set** — the
column's own `DEFAULT` value must be a member of its own CHECK set, or
any insert relying on the default (rather than specifying `result`
explicitly) will fail. This was caught via a real test failure during
this feature's original implementation, not by inspection — write a test
that inserts a row with no explicit `result` and asserts it succeeds,
before considering this table done.

Do NOT add a foreign key from `audit_log.guild_id` to `guilds(guild_id)`
— single-tenant mode never populates the `guilds` table, and an FK here
would make every single-tenant audit write fail.

In `createDatabase()`'s migration block, add a `version < 3` branch that
only advances `schema_version` (no `ALTER TABLE` needed — `audit_log` is
a brand-new table, already handled idempotently by `CREATE TABLE IF NOT
EXISTS` above).

Add three functions near the existing `getGuildFaction`/`setGuildFaction`
pair:

- `insertAuditLog(db, { source, guildId, discordUserId, discordUsername, channelId, command, action, capability, idempotencyKey, result, detail })` —
  `JSON.stringify(detail)` before storage. Caller is responsible for
  redacting `detail` before calling this — this function does not redact
  on your behalf.
- `getAuditLog(db, { guildId = null, limit = 50 })` — newest-first
  (`ORDER BY id DESC`), `guildId` filters when provided, capped at 200 /
  floored at 1. **Do not clamp with `Number(limit) || 50`** — `0` is
  falsy in JS and would silently become `50` instead of being floored to
  `1`. Use `Number.isFinite()` explicitly instead. `JSON.parse` each
  row's `detail` on the way out, falling back to `{}` on malformed JSON
  rather than throwing.
- `pruneAuditLog(db, maxAgeMs = 14 * 24 * 60 * 60 * 1000)` — deletes rows
  older than `maxAgeMs`, returns the number of rows deleted. **Convert
  the cutoff timestamp to match SQLite's `datetime('now')` storage
  format** (`"YYYY-MM-DD HH:MM:SS"`, no `Z`/timezone suffix) before
  comparing — a raw `.toISOString()` cutoff (which includes a trailing
  `Z` and milliseconds) will not sort/compare correctly against the
  stored format. `cutoffIso.replace("T", " ").replace(/\.\d+Z$/, "")` is
  sufficient.

### 2. `src/auditLog.js` — new module

```js
import { insertAuditLog, getAuditLog, pruneAuditLog } from "./database.js";
import { redactSecrets } from "./format.js";
import { logError, logInfo } from "./logger.js";

const COMMAND_ACTIONS = Object.freeze({
  "player:link": { action: "player:link", capability: "ACCOUNT_LINK_WRITE" },
  "player:unlink": { action: "player:unlink", capability: "ACCOUNT_LINK_WRITE" },
  "player:enable": { action: "player:enable", capability: "ACCOUNT_LINK_WRITE" },
  "player:disable": { action: "player:disable", capability: "ACCOUNT_LINK_WRITE" },
  "player:default": { action: "player:default", capability: "ACCOUNT_LINK_WRITE" },
  "player:faction": { action: "player:faction", capability: "ACCOUNT_LINK_WRITE" }
});

export function actionForCommand(key) {
  return COMMAND_ACTIONS[key] || null;
}

export function recordAuditEvent({
  db, source = "discord-command", guildId = "", discordUserId = "", discordUsername = "",
  channelId = "", command = "", action = "", capability = "", idempotencyKey = "",
  result = "unknown", detail = {}
} = {}) {
  const redactedDetail = redactSecrets(detail || {});
  if (!db) {
    logInfo("audit.unpersisted", { source, guildId, discordUserId, command, action, capability, idempotencyKey, result, detail: redactedDetail });
    return;
  }
  try {
    insertAuditLog(db, { source, guildId, discordUserId, discordUsername, channelId, command, action, capability, idempotencyKey, result, detail: redactedDetail });
  } catch (error) {
    logError("audit.write_failed", error, { command, action, result });
  }
}

export function recordAuditEventForCommand({ db, interaction, key, idempotencyKey = "", result, detail = {} } = {}) {
  const mapping = actionForCommand(key);
  if (!mapping) return;
  recordAuditEvent({
    db,
    guildId: interaction?.guildId || "",
    discordUserId: interaction?.user?.id || "",
    discordUsername: interaction?.user?.username || "",
    channelId: interaction?.channelId || "",
    command: key, action: mapping.action, capability: mapping.capability,
    idempotencyKey, result, detail
  });
}

export function queryAuditLog(db, options = {}) {
  if (!db) return [];
  return getAuditLog(db, options);
}

export function runAuditLogPruning(db, maxAgeMs) {
  if (!db) return 0;
  try {
    return pruneAuditLog(db, maxAgeMs);
  } catch (error) {
    logError("audit.prune_failed", error);
    return 0;
  }
}
```

**`recordAuditEvent()` and `runAuditLogPruning()` must never throw** —
wrap the actual database call in `try`/`catch`, log via `logError()` on
failure. A failure to write an audit record must never fail the
underlying command it's describing (see Security Review FINDING-AUDIT-3).

### 3. `src/writeHandler.js` — wire in real calls

Replace the unused `writeAuditEvent` import with
`import { recordAuditEvent } from "./auditLog.js";`. Add a `db = null`
parameter to `handleWriteCommand()`. Call `recordAuditEvent()` at each of
its three early-return points (writes disabled → `result: "denied"`,
unknown command → `result: "failed"`, not authorized → `result: "denied"`)
and once more just before the final scaffolded return (`result: "pending"`,
since this function never actually executes the write yet — see Design
doc's explanation of why "pending" is correct here, not "success").

### 4. `src/broadcast.js` — wire in real calls

Same pattern as `writeHandler.js`: replace the unused `writeAuditEvent`
import, add a `db = null` parameter to `executeBroadcast()`, call
`recordAuditEvent()` at the disabled/not-authorized early returns
(`result: "denied"`) and once more before the final
confirmation-required return (`result: "pending"`, for the same "never
actually reaches the adapter yet" reason). Remove the `audit:` field from
the function's own return value — it served no purpose once the event is
actually persisted rather than discarded.

### 5. `src/commands.js` — wire everything together

- Update the two call sites (`handleWriteCommand({...})`,
  `executeBroadcast({...})`) to pass `db` through.
- Add `import { recordAuditEventForCommand, queryAuditLog } from "./auditLog.js";`.
- Add a `recordAuditEventForCommand({ db, interaction, key, result:
  payload?.ok === false ? "failed" : "success", detail: { subcommand } })`
  call immediately after the main dispatch `if/else if` chain, before
  `redactSecrets(payload)`. This is a no-op for every command not in
  `COMMAND_ACTIONS`, so it's safe to call unconditionally.
- Add the same call (with `result: "failed"`) inside the outer `catch`
  block, so commands that throw before reaching the point above are still
  recorded.
- Inside `player:link`'s Steam-connections branch (the one that shows a
  "Link via Steam" button and returns early), add a
  `recordAuditEventForCommand({ db, interaction, key, result: "pending",
  detail: { characterName, path: "steam-offered" } })` call before the
  `return true` — this branch returns before reaching the generic
  post-dispatch call above, so it needs its own.
- Add a new `admin` subcommand:
  ```js
  .addSubcommand((c) => c.setName("audit").setDescription("Show recent audit log entries for destructive commands.")
    .addIntegerOption((o) => o.setName("limit").setDescription("Number of entries (default 20, max 200)").setMinValue(1).setMaxValue(200)))
  ```
- Add the dispatch case (gated by the existing `isAdminActor()` check,
  matching `admin:doctor`/`admin:cooldowns`):
  ```js
  } else if (key === "admin:audit") {
    if (!isAdminActor(interaction, config, db, guildId)) throw new Error("Audit log viewer requires admin or owner role.");
    const limit = interaction.options.getInteger("limit") || 20;
    payload = { entries: queryAuditLog(db, { guildId: config.multiTenant ? guildId : null, limit }) };
  }
  ```
- Add `admin:audit` to the `helpPayload()` command list and to the
  embed-selection `if/else if` chain (`formatAuditLogEmbed(payload)`).

### 6. `src/embedFormat.js` — new formatter

```js
const AUDIT_RESULT_ICON = { success: "✅", denied: "🚫", failed: "❌", pending: "⏳" };
export function formatAuditLogEmbed(payload) {
  const entries = payload?.entries || [];
  const desc = entries.length === 0
    ? "— No audit entries recorded —"
    : entries.slice(0, 15).map((e) => {
      const icon = AUDIT_RESULT_ICON[e.result] || "❔";
      const who = e.discord_username ? `**${e.discord_username}**` : (e.discord_user_id ? `\`${e.discord_user_id}\`` : "unknown");
      const when = e.created_at ? `_${e.created_at}_` : "";
      return `${icon} ${who} → \`${e.command || e.action}\` (${e.result}) ${when}`;
    }).join("\n");
  return duneEmbed({
    title: "🔍 Audit Log",
    color: entries.length > 0 ? "warning" : "success",
    description: desc.slice(0, 2048),
    fields: [{ name: "📝 Entries Shown", value: fmtCount(entries.length), inline: true }]
  });
}
```

### 7. `src/index.js` — open SQLite unconditionally + pruning timer

Replace `const db = config.multiTenant ? createDatabase(config.dbPath) :
null; if (db) initBotStats(db);` with:

```js
const db = createDatabase(config.dbPath);
initBotStats(db);
```

Add, at module scope (not inside the `ClientReady` callback — pruning has
no Discord dependency and should run immediately at startup):

```js
import { runAuditLogPruning } from "./auditLog.js";

const AUDIT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
function pruneAuditLogNow() {
  const deleted = runAuditLogPruning(db);
  if (deleted > 0) logInfo("audit.pruned", { deleted });
}
pruneAuditLogNow();
const auditPruneTimer = setInterval(pruneAuditLogNow, AUDIT_PRUNE_INTERVAL_MS);
auditPruneTimer.unref?.();
```

Add `clearInterval(auditPruneTimer);` to the `SIGINT`/`SIGTERM` shutdown
handler, alongside the existing `statsPusher.stop()`/`alerts.stop()` calls.

**Before making this change**, verify (by reading, not assuming) that
every other table this `db` object serves (`guilds`, `guild_roles`,
`guild_settings`, `oauth_sessions`, `player_links`) is only ever
*written* from code paths already gated behind `if (config.multiTenant)`
elsewhere in `index.js` — if that's ever no longer true (e.g. a future
change adds a single-tenant write path to one of those tables), this
unconditional-open change's "no behavioral effect on other tables"
justification needs to be re-verified, not assumed to still hold.

### 8. Tests

- `test/database.test.js` (new) — direct unit tests for
  `insertAuditLog()`/`getAuditLog()`/`pruneAuditLog()` against a real
  in-memory (`":memory:"`) SQLite instance via `createDatabase()`. Cover:
  schema/version creation, full-field insert + readback, defaulted-field
  insert (this is the test that catches the CHECK-constraint-default bug
  if it regresses), CHECK constraint rejection of an invalid `result`,
  newest-first ordering, guild-scoped vs. cross-guild reads, limit
  clamping at both ends (including the `limit: 0` edge case), malformed
  JSON in `detail` not throwing, and pruning (deletes old rows, keeps
  recent ones, returns 0 when nothing qualifies).
- `test/auditLog.test.js` (new) — unit tests for
  `actionForCommand()`/`recordAuditEvent()`/`recordAuditEventForCommand()`/
  `queryAuditLog()`/`runAuditLogPruning()`. Cover: tracked vs. untracked
  command keys, successful persistence, redaction-before-persistence
  (assert a `steamId`-keyed detail field is NOT present in its original
  form after a round-trip), never-throws behavior with `db: null` and
  with a `db` whose `.prepare()` always throws, and actor-field
  derivation from a Discord interaction object (including a
  null/partial interaction).
- `test/discord-bot-test-harness.js` — extend the existing "Audit
  Logging" describe block with real persistence assertions (not just
  response-shape checks): `player:unlink`/`player:faction` write exactly
  one row each to a real in-memory `db` passed into
  `executeDuneCommand()`; `server:status` (a read command) writes zero
  rows; `admin:audit` returns persisted entries to an admin and is denied
  to an observer.
- `test/fixtures/mockConfig.js` — add an `admin:audit` entry to
  `commandRoleIds` (admin-only) — without it, the mock's RBAC fallback
  logic would incorrectly allow observers through for this specific
  command in tests, even though the real `isAdminActor()` check inside
  the dispatch case would still separately reject them (the RBAC gate and
  the dispatch-level `isAdminActor()` check are two independent layers —
  both need to be correctly configured for a test to actually exercise
  the intended-denied path via the intended mechanism).

### Verification before considering this feature done

```bash
npm run check
npm audit --audit-level=moderate
semgrep scan --config p/default --config p/secrets --error --severity ERROR --severity WARNING --exclude node_modules --exclude .git --exclude package-lock.json .
gitleaks detect --no-git
```

If pre-commit is installed, `pre-commit run --all-files` should also
pass. Add a `docs/changes/PR-####-audit-log.md` change note following
`docs/changes/PR-0091-upstream-feedback-resolution.md`'s exact format,
and a row in `docs/changes/README.md`'s index table.

## PR Requirements

- Open against `main` from a new feature branch (`feat/audit-log` or
  equivalent) — confirm this repo is not a fork with an upstream to worry
  about leaking into (already confirmed true earlier in this project's
  history for `Arrakis-Control-Panel`).
- Reference all four companion docs
  (`docs/audit-log-design.md`/`-architecture.md`/`-security-review.md`/`-grc.md`)
  in the PR description.
- Mark `docs/additional-features-roadmap.md`'s R2.x-FEAT-8 entry as
  implemented (not just rescoped) once this PR merges.

## Sources

- `docs/audit-log-design.md`
- `docs/audit-log-architecture.md`
- `docs/audit-log-security-review.md`
- `docs/audit-log-grc.md`
- `src/writes.js` — the pre-existing `writeAuditEvent()` shape this feature's persistence layer mirrors
