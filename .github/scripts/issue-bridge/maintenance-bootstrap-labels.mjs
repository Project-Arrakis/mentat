#!/usr/bin/env node
// ACP Issue Bridge — idempotent label bootstrap (spec sections 12/13/55/80).
// Creates any missing labels from the taxonomy; never modifies an existing
// label's color/description (a maintainer may have deliberately customized
// it — this script's job is "make sure it exists", not "make it match").
//
// Usage: node maintenance-bootstrap-labels.mjs <public|private>
// Runs with the repo's OWN default GITHUB_TOKEN — no cross-repo App token
// needed, since each side only ever creates labels on itself.

import { fileURLToPath } from "node:url";
import { PRIVATE_LABELS, PUBLIC_LABELS } from "./lib/labelDefinitions.mjs";
import { validationError } from "./lib/errors.mjs";
import { buildClient, currentRepoSlug, loadBridgeConfig } from "./runtime.mjs";

export async function bootstrapLabels({ client, repoSlug, taxonomy, sink = console.log }) {
  const existing = await client.listLabels(repoSlug);
  const existingNames = new Set((existing || []).map((l) => l.name));
  const created = [];
  const skipped = [];

  for (const label of taxonomy) {
    if (existingNames.has(label.name)) {
      skipped.push(label.name);
      continue;
    }
    await client.createLabel(repoSlug, label);
    created.push(label.name);
  }

  sink(JSON.stringify({ repo: repoSlug, created, skipped }));
  return { created, skipped };
}

async function main() {
  const side = process.argv[2];
  if (side !== "public" && side !== "private") {
    throw validationError('usage: maintenance-bootstrap-labels.mjs <public|private>');
  }
  const config = loadBridgeConfig();
  const repoSlug = side === "public" ? config.repositories.public : config.repositories.private;
  const taxonomy = side === "public" ? PUBLIC_LABELS : PRIVATE_LABELS;

  const actualRepo = currentRepoSlug();
  if (actualRepo !== repoSlug) {
    throw validationError(`refusing to bootstrap "${side}" labels: running in "${actualRepo}", expected "${repoSlug}"`);
  }

  // Uses GITHUB_TOKEN (the workflow's own automatic token), not the App —
  // same-repo label management needs no cross-repo access.
  const client = buildClient({ tokenEnvVar: "GITHUB_TOKEN" });
  await bootstrapLabels({ client, repoSlug, taxonomy });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.name === "BridgeError" ? `${err.errorClass}: ${err.message}` : err);
    process.exit(1);
  });
}
