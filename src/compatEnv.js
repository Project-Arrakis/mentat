import { logWarn } from "./logger.js";

// Precedence order for legacy prefixes, most-recently-deprecated first.
// Per the Phase 3 compatibility strategy: MENTAT_* is canonical; when it's
// absent, SENTINEL_* wins over ACP_* if both are set to different values.
const LEGACY_PREFIXES = ["SENTINEL", "ACP"];

function isNonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidUrl(value) {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// resolveCompatEnv: given a canonical suffix (e.g. "DB_PATH"), resolves
// MENTAT_<suffix> against its deprecated SENTINEL_<suffix>/ACP_<suffix>
// aliases per the Phase 3 precedence rules. Returns the resolved string
// value (untrimmed callers should trim themselves if needed) or undefined
// if nothing is set. Never logs a value -- only variable names.
//
// options.urlShaped: shorthand for options.validate = isValidUrl.
// options.validate(trimmedValue): when given (directly, or via urlShaped),
// a present-but-invalid MENTAT_* value does not silently win -- it falls
// back to a working legacy value (with a loud warning) if one exists, or
// resolves to undefined (letting the caller's own required-value check
// fail closed) if not. Credential-bearing vars must pass a real validator
// here (e.g. a hex-length regex) -- there is no generic "credential shape"
// this module can check on its own; a caller that wants fail-closed
// behavior for a credential MUST supply options.validate, or every
// non-empty value is accepted (a Layer 2 audit finding on an earlier
// version of this file: a bare `credential: true` flag with no validator
// silently validated everything).
export function resolveCompatEnv(env, suffix, options = {}) {
  const { urlShaped = false, validate } = options;
  const validator = validate || (urlShaped ? isValidUrl : null);
  const canonicalName = `MENTAT_${suffix}`;
  const legacyNames = LEGACY_PREFIXES.map((prefix) => `${prefix}_${suffix}`);

  const canonicalValue = env[canonicalName];
  if (isNonEmpty(canonicalValue)) {
    const valid = !validator || validator(canonicalValue.trim());
    if (valid) {
      const ignoredLegacy = legacyNames.filter((name) => isNonEmpty(env[name]));
      if (ignoredLegacy.length) {
        logWarn("compat-env-ignored-legacy", { canonical: canonicalName, ignored: ignoredLegacy });
      }
      return canonicalValue.trim();
    }
    logWarn("compat-env-invalid-canonical", { canonical: canonicalName, note: "present but invalid; falling back to a legacy value if one is set" });
  }

  const setLegacy = legacyNames.filter((name) => isNonEmpty(env[name]));
  if (setLegacy.length === 0) return undefined;

  const winner = setLegacy[0];
  if (setLegacy.length > 1) {
    const distinctValues = new Set(setLegacy.map((name) => env[name].trim()));
    if (distinctValues.size > 1) {
      logWarn("compat-env-conflict", { winner, ignored: setLegacy.filter((name) => name !== winner), canonical: canonicalName });
      return env[winner].trim();
    }
  }
  logWarn("compat-env-deprecated", { deprecated: winner, canonical: canonicalName });
  return env[winner].trim();
}
