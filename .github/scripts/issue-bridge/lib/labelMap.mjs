// ACP Issue Bridge — label allowlist mapping (spec sections 12/13/14/15).
//
// Only allowlisted labels may cross repositories, and only in the
// public -> private direction (status labels are command-driven only, never
// generic label-sync — see config.mjs's rejection of status:* in
// label_mapping). This module also provides the hard negative-test surface
// for "never expose these private labels publicly".

import { forbiddenPublicLabels } from "./config.mjs";

/**
 * Map a public label to its allowlisted private equivalent, or null if the
 * label is not on the allowlist (caller must ignore it, per section 59:
 * "Only process allowlisted labels. Ignore all others.").
 */
export function mapPublicLabelToPrivate(config, publicLabel) {
  const mapped = config.label_mapping[publicLabel];
  return typeof mapped === "string" ? mapped : null;
}

/** The fixed set of labels every private mirror receives on creation (section 14). */
export function defaultPrivateMirrorLabels(config) {
  return [config.labels.source_public, config.labels.visibility_internal, config.labels.sync_enabled];
}

/**
 * Defense-in-depth guard: true if `label` must NEVER be applied to (or
 * allowed to remain readable from) the public repository. Used both by
 * orchestration code before any public-facing label/write operation and by
 * the SEC negative-test suite (section 15: "Write automated negative tests
 * for each one").
 */
export function isForbiddenPublicLabel(config, label) {
  return forbiddenPublicLabels(config).has(label);
}

/**
 * Filter a list of label names added/removed on the public issue down to
 * only the ones that are allowlisted for inward sync, translated to their
 * private equivalents. Anything not on the allowlist is silently ignored
 * (not an error — most public labels a maintainer applies, e.g. GitHub's
 * default `bug`/`enhancement`, simply aren't part of the bridge's taxonomy).
 */
export function translateAllowlistedLabels(config, publicLabels) {
  const result = [];
  for (const label of publicLabels) {
    const mapped = mapPublicLabelToPrivate(config, label);
    if (mapped && !isForbiddenPublicLabel(config, mapped)) result.push(mapped);
  }
  return result;
}
