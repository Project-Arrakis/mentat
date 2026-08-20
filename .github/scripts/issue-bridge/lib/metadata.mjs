// ACP Issue Bridge — metadata block builder/parser (spec sections 9/10/32/41/42).
//
// IMPORTANT TRUST BOUNDARY (section 42): a metadata block found inside
// PUBLIC-repository content (an issue body or comment authored by an
// untrusted public user) is NEVER authoritative proof of anything — a
// public user can freely type `<!-- ACP-ISSUE-BRIDGE origin: bridge -->`
// themselves. `extractMetadataBlocks()` is a pure, untrusted parser; it is
// safe to call on any text, but callers must combine its result with an
// independent trust signal (actor identity / bot login / which repository
// the content lives in) before treating anything it returns as authoritative
// — see `loopProtection.mjs`'s `isBridgeAuthored()`.

export const SCHEMA_VERSION = 1;

const BLOCK_PATTERN = /<!--\s*ACP-ISSUE-BRIDGE\r?\n([\s\S]*?)-->/g;

function renderFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
}

function parseFieldLines(block) {
  const fields = {};
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue; // malformed line inside the block — ignore, don't guess
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key.length === 0) continue;
    fields[key] = value;
  }
  return fields;
}

/** Build the metadata HTML comment embedded in a newly-created private mirror issue (section 9). */
export function buildIssueMetadata({ syncId, publicRepository, publicIssue, createdFromEvent }) {
  const fields = renderFields({
    schema_version: SCHEMA_VERSION,
    sync_id: syncId,
    public_repository: publicRepository,
    public_issue: publicIssue,
    created_from_event: createdFromEvent
  });
  return `<!-- ACP-ISSUE-BRIDGE\n${fields}\n-->`;
}

/** Build the metadata HTML comment embedded in a public->private mirrored comment (section 32). */
export function buildCommentMetadata({ syncId, sourceRepository, sourceIssue, sourceComment, direction = "public-to-private" }) {
  const fields = renderFields({
    schema_version: SCHEMA_VERSION,
    direction,
    sync_id: syncId,
    source_repository: sourceRepository,
    source_issue: sourceIssue,
    source_comment: sourceComment
  });
  return `<!-- ACP-ISSUE-BRIDGE\n${fields}\n-->`;
}

/** Build the metadata HTML comment embedded in a bridge-generated PUBLIC comment (loop protection, section 41). */
export function buildBridgePublicationMetadata({ syncId, privateRepository, privateIssue, privateComment, kind, sourceComment }) {
  const fields = renderFields({
    schema_version: SCHEMA_VERSION,
    origin: "bridge",
    kind,
    sync_id: syncId,
    private_repository: privateRepository,
    private_issue: privateIssue,
    private_comment: privateComment,
    // The PRIVATE comment id that TRIGGERED this publication (the `/public`,
    // `/public-status`, or `/public-resolution` comment itself) — used for
    // idempotency: before publishing, the bridge checks whether a prior
    // bridge comment already carries this exact (kind, source_comment) pair
    // (section 43).
    source_comment: sourceComment
  });
  return `<!-- ACP-ISSUE-BRIDGE\n${fields}\n-->`;
}

/**
 * Parse every ACP-ISSUE-BRIDGE metadata block found in arbitrary text.
 * Pure, untrusted parsing — see module doc comment above.
 * Returns an array (possibly empty, possibly >1 if content is adversarial).
 */
export function extractMetadataBlocks(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const blocks = [];
  let match;
  BLOCK_PATTERN.lastIndex = 0;
  while ((match = BLOCK_PATTERN.exec(text)) !== null) {
    blocks.push(parseFieldLines(match[1]));
  }
  return blocks;
}

/**
 * Find exactly one well-formed issue-creation metadata block (schema_version,
 * sync_id, public_repository, public_issue all present). Returns null if
 * zero or more-than-one candidate blocks are found — ambiguity must fail
 * closed (section 44), never guess which one is real.
 */
export function extractSingleIssueMetadata(text) {
  const blocks = extractMetadataBlocks(text).filter(
    (f) => f.schema_version && f.sync_id && f.public_repository && f.public_issue
  );
  if (blocks.length !== 1) return null;
  return blocks[0];
}
