import { spawn as realSpawn, execFileSync } from "node:child_process";
import { openSync, mkdtempSync, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

let spawnImpl = realSpawn;
export function __setSpawnImplForTests(fn) { spawnImpl = fn; }
export function __resetSpawnImplForTests() { spawnImpl = realSpawn; }

function realHasCommand(cmd) {
  try {
    execFileSync("bash", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
let hasCommandImpl = realHasCommand;
export function __setHasCommandImplForTests(fn) { hasCommandImpl = fn; }
export function __resetHasCommandImplForTests() { hasCommandImpl = realHasCommand; }

const __dirname = dirname(fileURLToPath(import.meta.url));

// [Audit fix: Network, HIGH round 2] Round 1's design described a
// systemd-run-unavailable fallback (plain spawn) only in prose -- no code
// implemented it, and this exact scenario is plausible: systemd-run (no
// --user flag, deliberately -- it targets the SYSTEM manager instance so
// the escaped scope survives the bot's own process dying) may require
// root/polkit authorization the "bot" user does not have. That specific
// privilege question is still an open pre-implementation checklist item
// in the design doc (section 4a) -- this fallback exists so a missing or
// unauthorized systemd-run degrades to "self-update still runs, with a
// weaker report-back guarantee" rather than "self-update silently does
// nothing."
export function runSelfUpdate({ interactionToken, applicationId, channelId }) {
  const scriptPath = join(__dirname, "..", "scripts", "self-update.sh");
  const logPath = join(__dirname, "..", "runtime", `self-update-${Date.now()}.log`);
  // runtime/ is gitignored and not guaranteed to exist yet at this point --
  // nothing else in this bot's startup path is guaranteed to have created
  // it before the first self-update trigger (database.js's own mkdirSync
  // only fires for a runtime/-rooted ACP_DB_PATH, which isn't the default).
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");

  const webhookUrl = applicationId && interactionToken
    ? `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`
    : "";

  // [Audit fix: Security, HIGH round 3] `systemd-run` submits the unit to
  // the systemd MANAGER over D-Bus -- an env var set on the spawn() call
  // below only affects the systemd-run CLIENT process itself, never the
  // scope it creates, so a plain `env: { DISCORD_WEBHOOK_URL }` would
  // never actually reach self-update.sh on this path. The correct
  // mechanism is `--setenv=KEY=VALUE` on systemd-run's own argv -- but
  // putting the raw URL (which embeds a bearer-style interaction token)
  // there would leak it via `ps auxww`/`/proc/<pid>/cmdline` for
  // systemd-run's own process lifetime, the exact leak already closed for
  // curl (see scripts/self-update.sh's report()). Instead: write the URL
  // to a short-lived, 0600 temp file and pass only that file's PATH
  // (never sensitive) via --setenv/env -- matching this codebase's own
  // established _FILE secret-handling convention (Requirement 24).
  // [Audit fix: Architect, LOW round 4] Deliberately under OS tmpdir(),
  // NOT $WORK_DIR/runtime/ (where the deploy lock and the self-update
  // marker file live) -- those two need repo-relative, predictable paths
  // because the marker specifically must survive a process restart and be
  // found again at a known location by the NEW process. This file's
  // entire lifetime is from this line to self-update.sh reading and
  // deleting it moments later, before any restart happens -- it has no
  // reason to live inside the deployed repo tree at all.
  const webhookFile = join(mkdtempSync(join(tmpdir(), "mentat-self-update-")), "webhook-url");
  writeFileSync(webhookFile, webhookUrl, { mode: 0o600 });
  const env = { ...process.env, DISCORD_WEBHOOK_URL_FILE: webhookFile };

  // [Audit fix: Security, MEDIUM round 4] self-update.sh's own trap-based
  // cleanup (scripts/self-update.sh) only runs if that script actually
  // starts executing. If spawnImpl throws synchronously (e.g. the "bash"
  // or "systemd-run" binary is missing) or the spawned process fails to
  // launch at all (an async "error" event -- e.g. ENOENT, or systemd-run
  // rejected by polkit before ever invoking bash), self-update.sh never
  // runs and never reaches its own cleanup -- the 0600 secret file would
  // otherwise be orphaned indefinitely with no reaper.
  function cleanupWebhookFileQuietly() {
    try { unlinkSync(webhookFile); } catch { /* already gone or never existed */ }
    try { rmdirSync(dirname(webhookFile)); } catch { /* not empty or already gone */ }
  }

  const useSystemdRun = hasCommandImpl("systemd-run");
  let child;
  try {
    if (useSystemdRun) {
      // systemd-run --scope: escapes acp-bot.service's own cgroup (see
      // scripts/self-update.sh's header for why this matters -- KillMode=
      // control-group would otherwise kill this script in the same signal
      // that kills the process it's restarting). --setenv carries only the
      // temp-file PATH into the spawned scope's real environment, not the
      // secret itself.
      child = spawnImpl("systemd-run", ["--uid", String(process.getuid?.() ?? "bot"), "--scope", `--setenv=DISCORD_WEBHOOK_URL_FILE=${webhookFile}`, "--", "bash", scriptPath], {
        stdio: ["ignore", logFd, logFd],
        env
      });
    } else {
      console.warn("writeSelfUpdate: systemd-run is unavailable -- falling back to a plain detached spawn. The fast-path webhook report-back in scripts/self-update.sh may be lost if this process is killed alongside the bot during its own restart; the startup marker-file check (src/index.js) is the fallback reporting path for this case.");
      // A plain, directly-spawned child inherits `env` normally (no D-Bus
      // hop), so this path already worked correctly even before this fix --
      // kept on the same file-based convention for consistency, not because
      // it was broken here too.
      child = spawnImpl("bash", [scriptPath], {
        stdio: ["ignore", logFd, logFd],
        env,
        detached: true
      });
    }
  } catch (error) {
    cleanupWebhookFileQuietly();
    throw error;
  }
  child.on?.("error", cleanupWebhookFileQuietly);
  child.unref?.();
  return { pid: child.pid, logPath };
}
