#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

function formatDuration(ms) {
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = ((ms % 60000) / 1000).toFixed(0);
  return `${minutes}m ${seconds}s`;
}

async function runTests(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["--test", "--test-reporter=spec", ...args], {
      stdio: ["inherit", "pipe", "inherit"]
    });

    const rl = createInterface({ input: child.stdout });

    rl.on("line", (line) => {
      const formatted = line.replace(/duration_ms\s+([\d.]+)/g, (_, ms) => {
        return `duration ${formatDuration(Number(ms))}`;
      });
      process.stdout.write(formatted + "\n");
    });

    child.on("exit", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", reject);
  });
}

function runBats() {
  return new Promise((resolve) => {
    const child = spawn("bats", ["test/deploy-hook.bats"], {
      stdio: "inherit"
    });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", (err) => {
      console.error(`bats unavailable: ${err.message}`);
      resolve(1);
    });
  });
}

async function main() {
  const exitCode1 = await runTests(process.argv.slice(2).filter(a => a !== "test/discord-bot-test-harness.js"));
  const exitCode2 = await runTests(["test/discord-bot-test-harness.js"]);
  const exitCode3 = await runBats();
  process.exit(exitCode1 === 0 && exitCode2 === 0 && exitCode3 === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
