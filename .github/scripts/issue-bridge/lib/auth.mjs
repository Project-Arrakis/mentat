// ACP Issue Bridge — command authorization matrix (spec sections 30/31).
//
// IMPORTANT: GitHub's `GET /repos/{owner}/{repo}/collaborators/{username}/permission`
// endpoint's top-level `permission` field collapses the 5-tier role model
// down to 4 legacy buckets (admin/write/read/none) — `maintain` is reported
// as `write` there for backward compatibility. The precise tier (including
// `maintain`/`triage`) is only available in that same response's
// `role_name` field. Callers MUST pass `role_name` into `isAuthorized()`,
// not `permission` — see ghApi.mjs `getUserRole()`, which returns
// `role_name` for exactly this reason. Getting this wrong would silently
// require only `write` everywhere a `maintain` gate was intended — a real
// privilege-boundary bug, not a cosmetic one.

import { validationError } from "./errors.mjs";

const LEVEL_RANK = Object.freeze({
  none: 0,
  read: 1,
  triage: 1,
  write: 2,
  maintain: 3,
  admin: 4
});

// command (as returned by commandParser.parseCommand) -> permissions config key.
// `internal` is intentionally absent: it never performs any privileged
// action (section 18: "No public action"), so there is nothing to
// authorize — any actor able to comment on the private issue may use it.
export const COMMAND_PERMISSION_KEY = Object.freeze({
  public: "publish",
  public_status: "public_status",
  resolution: "resolution",
  security: "security",
  security_clear: "security_clear",
  pause: "pause",
  resume: "resume"
});

/**
 * @param {string} actorRoleName - GitHub `role_name` for the actor on the
 *   private repo (e.g. "read", "triage", "write", "maintain", "admin", or a
 *   custom role slug).
 * @param {string} requiredLevel - one of "write"|"maintain"|"admin".
 */
export function isAuthorized(actorRoleName, requiredLevel) {
  const requiredRank = LEVEL_RANK[requiredLevel];
  if (requiredRank === undefined) {
    throw validationError(`unknown required permission level: ${JSON.stringify(requiredLevel)}`);
  }
  // An actor role we don't recognize (e.g. a custom role name GitHub added)
  // fails closed to "insufficient" rather than being treated as privileged.
  const actorRank = LEVEL_RANK[actorRoleName] ?? -1;
  return actorRank >= requiredRank;
}

/**
 * Resolve the required permission level for a parsed command, then check
 * the actor against it. Returns `{ requiresAuth: boolean, authorized: boolean, requiredLevel: string|null }`.
 */
export function checkCommandAuthorization(config, command, actorRoleName) {
  if (command === "internal" || command === "unrecognized" || command === null) {
    return { requiresAuth: false, authorized: true, requiredLevel: null };
  }
  const permKey = COMMAND_PERMISSION_KEY[command];
  if (!permKey) {
    throw validationError(`no permission mapping for command: ${JSON.stringify(command)}`);
  }
  const requiredLevel = config.permissions[permKey];
  return {
    requiresAuth: true,
    authorized: isAuthorized(actorRoleName, requiredLevel),
    requiredLevel
  };
}
