// ACP Issue Bridge — config drift detection helpers (spec section 75's
// "byte-for-byte identical" requirement + section 61 CONFIGURATION errors).
//
// Design note (see docs/issue-bridge/synchronization-policy.md): comparing
// the two repos' `acp-issue-bridge.yml` files directly would require
// granting the GitHub App `contents:read` on BOTH repos — a real scope
// increase beyond `metadata:read` + `issues:read/write` (section 5) just to
// diff one small file. Instead, each repo publishes a SHA-256 checksum of
// its own local file into a single well-known bookkeeping issue **in its
// own repository**, written with that repo's native, same-repo
// `GITHUB_TOKEN` (which every Actions workflow already has for its own
// repo — no elevated scope). The private repo's maintenance workflow then
// reads the public repo's bookkeeping issue using the App's already-
// justified `issues:read` scope and compares hashes. No `contents` access
// to the other repository is ever required.

import { createHash } from "node:crypto";

export const CHECKSUM_ISSUE_TITLE = "ACP Issue Bridge: Config Checksum (automated, do not edit)";

export function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function renderChecksumIssueBody(sha256, generatedAt) {
  return [
    "This issue is maintained automatically by the ACP Issue Bridge maintenance workflow.",
    "",
    "Do not edit or close it — it exists solely so the other repository can verify",
    "`.github/acp-issue-bridge.yml` has not drifted out of sync.",
    "",
    `sha256: ${sha256}`,
    `generated_at: ${generatedAt}`
  ].join("\n");
}

/** Extract the sha256 hex value from a rendered checksum issue body, or null if malformed. */
export function parseChecksumIssueBody(body) {
  if (typeof body !== "string") return null;
  const match = /^sha256:\s*([0-9a-f]{64})\s*$/m.exec(body);
  return match ? match[1] : null;
}
