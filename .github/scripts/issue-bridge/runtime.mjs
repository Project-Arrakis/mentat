// ACP Issue Bridge — shared orchestration bootstrap (private-repo copy).
//
// Thin glue between a GitHub Actions job (event payload on disk, secrets in
// env vars) and the pure, unit-tested lib/ modules. Kept deliberately small
// and side-effecting ONLY here, so lib/ stays pure and every orchestration
// script's actual decision logic can be exercised with a fake GitHubClient
// in tests (see *-orchestrate.test.js files).

import { readFileSync } from "node:fs";
import { GitHubClient } from "./lib/ghApi.mjs";
import { loadConfig } from "./lib/config.mjs";
import { validationError } from "./lib/errors.mjs";

export function readEventPayload(path = process.env.GITHUB_EVENT_PATH) {
  if (!path) {
    throw validationError("GITHUB_EVENT_PATH is not set and no explicit event path was provided");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

export function currentRepoSlug() {
  return process.env.GITHUB_REPOSITORY || null;
}

export function assertExpectedRepository(expectedSlug, actualSlug) {
  if (!actualSlug || actualSlug !== expectedSlug) {
    throw validationError(`workflow ran in "${actualSlug}" but config expects "${expectedSlug}"`);
  }
}

/**
 * Build a GitHubClient whose token is minted just-in-time from an env var
 * (populated by `actions/create-github-app-token` in production — see
 * docs/issue-bridge/github-app.md). Never reads the token eagerly, never
 * logs it.
 */
export function buildClient({ tokenEnvVar = "ACP_BRIDGE_TOKEN" } = {}) {
  return new GitHubClient({
    getToken: async () => {
      const token = process.env[tokenEnvVar];
      if (!token) throw validationError(`${tokenEnvVar} is not set`);
      return token;
    }
  });
}

export function botLogin() {
  return process.env.ACP_BRIDGE_BOT_LOGIN || "acp-issue-bridge[bot]";
}

export function loadBridgeConfig(path = ".github/acp-issue-bridge.yml") {
  return loadConfig(path);
}

export function workflowRunId() {
  return process.env.GITHUB_RUN_ID || null;
}
