import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_HEALTH_STATE_FILE = "/tmp/dune-discord-bot/health.json";

export function startHealthState({
  filePath = process.env.DUNE_BOT_HEALTH_STATE_FILE || DEFAULT_HEALTH_STATE_FILE,
  intervalMs = 30000,
  onError = () => {}
} = {}) {
  let ready = false;
  let readyAt;

  const write = (extra = {}) => {
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      const updatedAt = new Date().toISOString();
      writeFileSync(filePath, `${JSON.stringify({
        ready,
        readyAt,
        updatedAt,
        pid: process.pid,
        ...extra
      })}\n`, "utf8");
    } catch (error) {
      onError(error);
    }
  };

  write();
  const timer = setInterval(() => write(), intervalMs);
  timer.unref?.();

  return {
    filePath,
    markReady() {
      ready = true;
      readyAt ||= new Date().toISOString();
      write();
    },
    stop() {
      clearInterval(timer);
      ready = false;
      write({ stopping: true });
    }
  };
}
