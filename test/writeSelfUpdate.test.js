import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
