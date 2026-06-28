import { readFileSync } from "node:fs";
import { DEFAULT_HEALTH_STATE_FILE } from "./healthState.js";

const DEFAULT_MAX_AGE_MS = 120000;

export function checkHealthState({
  filePath = process.env.DUNE_BOT_HEALTH_STATE_FILE || DEFAULT_HEALTH_STATE_FILE,
  maxAgeMs = parsePositiveInteger(process.env.DUNE_BOT_HEALTH_MAX_AGE_MS, DEFAULT_MAX_AGE_MS),
  now = Date.now,
  readFile = readFileSync
} = {}) {
  const state = JSON.parse(readFile(filePath, "utf8"));
  if (state.ready !== true) throw new Error("Bot health state is not ready.");

  const updatedAt = Date.parse(state.updatedAt);
  if (!Number.isFinite(updatedAt)) throw new Error("Bot health state timestamp is invalid.");
  if (now() - updatedAt > maxAgeMs) throw new Error("Bot health state is stale.");

  return state;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer value: ${value}`);
  return parsed;
}
