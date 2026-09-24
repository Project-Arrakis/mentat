import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { runSelfUpdate, __setSpawnImplForTests, __setHasCommandImplForTests, __resetHasCommandImplForTests } from "../src/writeSelfUpdate.js";

// [Audit fix: Security, HIGH round 3] systemd-run submits the unit to the
// systemd MANAGER over D-Bus -- Node's own spawn(..., { env }) only
// affects the systemd-run CLIENT process, never the scope it creates. The
// webhook URL itself must never appear in systemd-run's own argv either
// (that would leak it via ps/proc for systemd-run's own process lifetime).
// The real fix: write the URL to a short-lived 0600 temp file and pass
// only that file's PATH via --setenv -- this test proves both halves.
test("runSelfUpdate: invokes systemd-run with --setenv=DISCORD_WEBHOOK_URL_FILE=<path>, never the URL itself in argv or in options.env directly", async () => {
  let capturedCommand = null;
  let capturedArgs = null;
  let capturedOptions = null;
  __setSpawnImplForTests((command, args, options) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return { unref: () => {}, pid: 12345 };
  });
  __setHasCommandImplForTests(() => true);

  const result = runSelfUpdate({ interactionToken: "tok", applicationId: "app", channelId: "chan" });

  assert.equal(capturedCommand, "systemd-run");
  assert.ok(Array.isArray(capturedArgs));
  assert.ok(capturedArgs.some((a) => a === "--scope"));
  const setenvArg = capturedArgs.find((a) => a.startsWith("--setenv=DISCORD_WEBHOOK_URL_FILE="));
  assert.ok(setenvArg, "must pass the webhook-url file path via --setenv so it actually reaches the spawned scope");
  const argvString = capturedArgs.join(" ");
  assert.ok(!argvString.includes("tok"), "the interaction token must not appear anywhere in argv, including inside --setenv");
  assert.equal(capturedOptions.env.DISCORD_WEBHOOK_URL, undefined, "the raw URL must never be set directly as an env var passed to systemd-run's own argv-visible --setenv mechanism");
  const filePath = setenvArg.slice("--setenv=DISCORD_WEBHOOK_URL_FILE=".length);
  const fileContent = readFileSync(filePath, "utf8");
  assert.ok(fileContent.includes("tok"), "the real webhook URL must be recoverable from the temp file the path points at");
  assert.equal(result.pid, 12345);
  __resetHasCommandImplForTests();
});

// [Audit fix: Network, HIGH round 2] The design's prose described a
// systemd-run-unavailable fallback (plain detached spawn), but no round-1
// code actually implemented it. This test proves the fallback path is
// real, not just documented.
test("runSelfUpdate: falls back to a plain detached spawn when systemd-run is unavailable, still using the file-based webhook URL convention", async () => {
  let capturedCommand = null;
  let capturedArgs = null;
  let capturedOptions = null;
  __setSpawnImplForTests((command, args, options) => {
    capturedCommand = command;
    capturedArgs = args;
    capturedOptions = options;
    return { unref: () => {}, pid: 54321 };
  });
  __setHasCommandImplForTests(() => false);

  const result = runSelfUpdate({ interactionToken: "tok2", applicationId: "app", channelId: "chan" });

  assert.equal(capturedCommand, "bash");
  assert.ok(Array.isArray(capturedArgs));
  assert.ok(!capturedArgs.some((a) => a === "systemd-run"));
  assert.equal(capturedOptions.detached, true);
  // The plain-spawn fallback is a direct child (no D-Bus hop), so passing
  // the file path via env (not the raw URL -- same file-based convention
  // as the systemd-run path, for consistency) is sufficient here too.
  const filePath = capturedOptions.env.DISCORD_WEBHOOK_URL_FILE;
  assert.ok(filePath, "must pass the webhook-url file path via env");
  const fileContent = readFileSync(filePath, "utf8");
  assert.ok(fileContent.includes("tok2"));
  assert.equal(result.pid, 54321);
  __resetHasCommandImplForTests();
});

// [Audit fix: Security, MEDIUM round 4] If self-update.sh never actually
// starts (spawnImpl throws synchronously here, or the OS can't find the
// binary), self-update.sh's own trap-based cleanup never runs -- proves
// runSelfUpdate() itself cleans up the 0600 webhook secret file in that
// case, rather than orphaning it on disk.
test("runSelfUpdate: cleans up the webhook temp file if spawning self-update.sh fails synchronously", async () => {
  let capturedWebhookFile = null;
  __setSpawnImplForTests((command, args, options) => {
    capturedWebhookFile = options.env.DISCORD_WEBHOOK_URL_FILE;
    throw new Error("spawn ENOENT");
  });
  __setHasCommandImplForTests(() => true);

  assert.throws(() => runSelfUpdate({ interactionToken: "tok3", applicationId: "app", channelId: "chan" }), /ENOENT/);

  assert.ok(capturedWebhookFile, "the test must have actually captured a real file path before the throw");
  assert.throws(() => readFileSync(capturedWebhookFile, "utf8"), /ENOENT/, "the webhook temp file must be deleted after a synchronous spawn failure");
  __resetHasCommandImplForTests();
});

// [Final-review fix, IMPORTANT 5] Audit coverage for the SUCCESS outcome of
// a self-update. Only "triggered" (writeHandler.js) and "confirmed"
// (writeConfirmation.js) were audited before; whether the restart actually
// happened was not. Reaching reportSelfUpdateCompletionIfPending()'s
// post-staleness-check body is the only in-process proof it did -- the
// marker file is written by scripts/self-update.sh immediately before the
// restart and is only ever read by the NEW, healthy process.
//
// src/index.js has no exported, standalone entry point (importing it boots a
// real discord.js client and calls client.login), so this is pinned at the
// source level -- the same established precedent this repo already uses for
// index.js in test/interactionRouting.test.js. The FAILURE counterpart IS
// covered end-to-end, by running the real scripts/self-update.sh: see
// test/self-update.bats, "emits a self-update-aborted audit event".
test("src/index.js audits a completed self-update when it processes a valid, non-stale marker file", async () => {
  const src = await readFile(new URL("../src/index.js", import.meta.url), "utf8");

  assert.match(src, /import \{ writeAuditEvent \} from "\.\/writes\.js"/,
    "must import the shared writeAuditEvent() shape rather than hand-rolling a second audit format");

  const fnStart = src.indexOf("function reportSelfUpdateCompletionIfPending()");
  assert.ok(fnStart !== -1, "reportSelfUpdateCompletionIfPending() must still exist");
  const fnEnd = src.indexOf("\nconst config = loadConfig();", fnStart);
  assert.ok(fnEnd !== -1, "could not bound reportSelfUpdateCompletionIfPending()'s body");
  const body = src.slice(fnStart, fnEnd);

  assert.match(body, /console\.log\(JSON\.stringify\(writeAuditEvent\(\{/,
    "the completion path must emit a writeAuditEvent audit line");
  assert.match(body, /result: "self-update-completed"/,
    "the audit event must record the self-update's successful outcome");
  assert.match(body, /action: "bot\.self-update"/);

  // Ordering matters: the audit must come AFTER the staleness guard (a
  // >15min-old marker is not evidence of a completed restart) and BEFORE
  // the `if (!webhookUrl) return;` bail-out (a successful self-update with
  // no webhook URL is still a successful self-update worth auditing).
  const staleGuard = body.indexOf("webhook token has likely expired");
  const auditIdx = body.indexOf('result: "self-update-completed"');
  const webhookBail = body.indexOf("if (!webhookUrl) return;");
  assert.ok(staleGuard !== -1 && auditIdx !== -1 && webhookBail !== -1, "all three landmarks must be present");
  assert.ok(staleGuard < auditIdx, "a stale marker must never be audited as a completed self-update");
  assert.ok(auditIdx < webhookBail, "a completed self-update with no webhook URL must still be audited");
});
