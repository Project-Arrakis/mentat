// ACP Issue Bridge — configuration loader.
//
// Loads and validates `.github/acp-issue-bridge.yml`. Fails closed: any
// missing required key, wrong type, or structurally invalid mapping throws
// ConfigValidationError (classified CONFIGURATION — see errors.mjs) rather
// than falling back to a guessed default for anything security-relevant.
//
// Defense in depth: labels that must never be exposed publicly are defined
// here in code (HARD_CODED_FORBIDDEN_PUBLIC_LABELS) and unioned with the
// config file's `never_expose_publicly` map. Config can only ADD to this
// set, never remove from it — see loadConfig()'s validation.

import { readFileSync } from "node:fs";
import { parseSimpleYaml, ConfigParseError } from "./miniYaml.mjs";

export class ConfigValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

// Security invariant, section 15/25: these labels carry bridge control
// state or reveal private-repo internals and must NEVER cross into the
// public repository under any code path. This set is authoritative and is
// not overridable by editing the YAML file down.
export const HARD_CODED_FORBIDDEN_PUBLIC_LABELS = Object.freeze([
  "visibility:internal",
  "visibility:security-sensitive",
  "sync:enabled",
  "sync:paused",
  "sync:error",
  "source:internal",
  "source:public"
]);

const REQUIRED_STRING_PATHS = [
  ["repositories", "public"],
  ["repositories", "private"],
  ["commands", "internal"],
  ["commands", "public"],
  ["commands", "public_status"],
  ["commands", "resolution"],
  ["commands", "security"],
  ["commands", "security_clear"],
  ["commands", "pause"],
  ["commands", "resume"],
  ["permissions", "publish"],
  ["permissions", "public_status"],
  ["permissions", "resolution"],
  ["permissions", "pause"],
  ["permissions", "resume"],
  ["permissions", "security"],
  ["permissions", "security_clear"],
  ["labels", "sync_enabled"],
  ["labels", "sync_paused"],
  ["labels", "sync_error"],
  ["labels", "security_sensitive"],
  ["labels", "source_public"],
  ["labels", "source_internal"],
  ["labels", "visibility_internal"],
  ["labels", "public_closed"]
];

const REQUIRED_BOOLEAN_PATHS = [
  ["sync", "public_issue_create"],
  ["sync", "public_issue_edit"],
  ["sync", "public_comment_create"],
  ["sync", "public_close"],
  ["sync", "public_reopen"],
  ["sync", "public_labels"],
  ["sync", "private_default_publish"],
  ["sync", "private_close_closes_public"],
  ["security", "fail_closed"],
  ["security", "secret_detection"],
  ["security", "block_private_urls"],
  ["security", "suppress_mentions"]
];

const VALID_PERMISSION_LEVELS = new Set(["write", "maintain", "admin"]);
const VALID_STATUS_STATES = new Set([
  "confirmed",
  "planned",
  "in-progress",
  "blocked",
  "testing",
  "ready-for-release",
  "released"
]);

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

// Semgrep false-positive documented here rather than in .semgrepignore
// (unlike the whole-file HTML-escaping exclusions elsewhere in this repo,
// this is a single line in an otherwise-scannable file, so a file-level
// exclusion would hide unrelated future findings in config.mjs). `path` is
// NEVER derived from parsed YAML/user input — every call site below passes
// one of the hardcoded REQUIRED_STRING_PATHS/REQUIRED_BOOLEAN_PATHS arrays
// defined in this same file. `__proto__`/`constructor`/`prototype` are
// explicitly blocked and only the object's OWN properties are ever read
// (Object.prototype.hasOwnProperty check), so even a hypothetical future
// caller passing an attacker-influenced path could not pollute or read the
// prototype chain. Verified 2026-08-19.
function getPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (UNSAFE_KEYS.has(key)) return undefined;
    if (cur == null || typeof cur !== "object" || !Object.prototype.hasOwnProperty.call(cur, key)) return undefined;
    // nosemgrep: javascript.lang.security.audit.prototype-pollution.prototype-pollution-loop.prototype-pollution-loop
    cur = cur[key];
  }
  return cur;
}

function assertRepoSlug(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(value)) {
    throw new ConfigValidationError(`${label} must be an "owner/repo" slug, got: ${JSON.stringify(value)}`);
  }
}

/**
 * Validate a parsed config object. Throws ConfigValidationError on the
 * first problem found. Returns nothing (validation only).
 */
export function validateConfig(doc) {
  if (doc.version !== 1) {
    throw new ConfigValidationError(`unsupported config schema_version: ${JSON.stringify(doc.version)}`);
  }

  for (const path of REQUIRED_STRING_PATHS) {
    const value = getPath(doc, path);
    if (typeof value !== "string" || value.length === 0) {
      throw new ConfigValidationError(`missing or invalid required string at ${path.join(".")}`);
    }
  }

  for (const path of REQUIRED_BOOLEAN_PATHS) {
    const value = getPath(doc, path);
    if (typeof value !== "boolean") {
      throw new ConfigValidationError(`missing or invalid required boolean at ${path.join(".")}`);
    }
  }

  assertRepoSlug(getPath(doc, ["repositories", "public"]), "repositories.public");
  assertRepoSlug(getPath(doc, ["repositories", "private"]), "repositories.private");

  for (const [cmdKey, token] of Object.entries(doc.commands || {})) {
    if (typeof token !== "string" || !token.startsWith("/")) {
      throw new ConfigValidationError(`commands.${cmdKey} must start with "/", got: ${JSON.stringify(token)}`);
    }
  }

  for (const [permKey, level] of Object.entries(doc.permissions || {})) {
    if (!VALID_PERMISSION_LEVELS.has(level)) {
      throw new ConfigValidationError(`permissions.${permKey} must be one of write/maintain/admin, got: ${JSON.stringify(level)}`);
    }
  }

  const statusLabels = doc.status_labels || {};
  for (const state of VALID_STATUS_STATES) {
    if (typeof statusLabels[state] !== "string" || statusLabels[state].length === 0) {
      throw new ConfigValidationError(`status_labels.${state} is required`);
    }
  }
  for (const state of Object.keys(statusLabels)) {
    if (!VALID_STATUS_STATES.has(state)) {
      throw new ConfigValidationError(`status_labels has unsupported state "${state}" — arbitrary states are not allowed`);
    }
  }

  const labelMapping = doc.label_mapping;
  if (labelMapping == null || typeof labelMapping !== "object" || Array.isArray(labelMapping)) {
    throw new ConfigValidationError("label_mapping must be a mapping object");
  }
  const forbidden = new Set(HARD_CODED_FORBIDDEN_PUBLIC_LABELS);
  for (const [pub, priv] of Object.entries(labelMapping)) {
    if (typeof priv !== "string" || priv.length === 0) {
      throw new ConfigValidationError(`label_mapping."${pub}" must map to a non-empty string`);
    }
    if (forbidden.has(priv) || forbidden.has(pub)) {
      throw new ConfigValidationError(
        `label_mapping must not reference a forbidden control label ("${pub}" -> "${priv}")`
      );
    }
    if (pub.startsWith("status:")) {
      throw new ConfigValidationError(
        `label_mapping must not include status:* labels ("${pub}") — status is command-driven only, see section 15/23`
      );
    }
  }

  // Defense in depth: config's declared denylist may only ADD to the
  // hard-coded minimum, never remove from it.
  const declared = new Set(Object.values(doc.never_expose_publicly || {}));
  for (const mustHave of HARD_CODED_FORBIDDEN_PUBLIC_LABELS) {
    if (!declared.has(mustHave)) {
      throw new ConfigValidationError(
        `never_expose_publicly is missing hard-coded control label "${mustHave}" — config may only extend this list, not shrink it`
      );
    }
  }
}

/**
 * Load and validate the bridge config from a YAML string.
 * Returns a deep-frozen, normalized config object.
 */
export function loadConfigFromString(text) {
  let doc;
  try {
    doc = parseSimpleYaml(text);
  } catch (err) {
    if (err instanceof ConfigParseError) {
      throw new ConfigValidationError(`config parse error: ${err.message}`);
    }
    throw err;
  }
  validateConfig(doc);
  return deepFreeze(doc);
}

/**
 * Load and validate the bridge config from a file path.
 */
export function loadConfig(path = ".github/acp-issue-bridge.yml") {
  const text = readFileSync(path, "utf8");
  return loadConfigFromString(text);
}

/** Compute the full forbidden-public-label set from a loaded config. */
export function forbiddenPublicLabels(config) {
  const set = new Set(HARD_CODED_FORBIDDEN_PUBLIC_LABELS);
  for (const value of Object.values(config.never_expose_publicly || {})) {
    set.add(value);
  }
  return set;
}

function deepFreeze(obj) {
  if (obj !== null && typeof obj === "object" && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const value of Object.values(obj)) deepFreeze(value);
  }
  return obj;
}
