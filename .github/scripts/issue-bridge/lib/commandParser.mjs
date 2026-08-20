// ACP Issue Bridge — private comment command parser (spec sections 16/17/21).
//
// "Commands are recognized only when they occur at the beginning of a
// private issue comment after optional leading whitespace." This is a
// strict, deterministic, single-pass parser (section 84): it looks ONLY at
// the first line of the comment. That single rule is also what makes
// command-like text inside a quoted block (`> /public`) or a fenced code
// block (` ```\n/public\n``` `) safe by construction — those always begin
// with `>` or a backtick, never with the literal command token, so they can
// never match. No separate "is this quoted/fenced" detection is needed.
//
// The absence of a recognized command is NOT an error — it means "ordinary
// comment, no public action" (section 19), which is the safe default. A
// line that clearly *attempts* a command (starts with `/`) but doesn't
// match anything recognized is reported separately as `unrecognized` so the
// caller may, at its option, post an internal-only acknowledgement — never
// a public one.

const VALID_STATUS_STATES = new Set([
  "confirmed",
  "planned",
  "in-progress",
  "blocked",
  "testing",
  "ready-for-release",
  "released"
]);

/**
 * @param {string} rawBody - the raw, unsanitized comment body.
 * @param {Record<string,string>} commandTokens - config.commands (name -> "/token").
 * @returns {{
 *   command: string | "unrecognized" | null,
 *   argument: string | null,
 *   argumentValid: boolean,
 *   body: string
 * }}
 */
export function parseCommand(rawBody, commandTokens) {
  if (typeof rawBody !== "string") {
    return { command: null, argument: null, argumentValid: true, body: "" };
  }

  const stripped = rawBody.replace(/^[ \t\r\n]+/, "");
  const newlineIdx = stripped.indexOf("\n");
  const firstLineRaw = newlineIdx === -1 ? stripped : stripped.slice(0, newlineIdx);
  const firstLine = firstLineRaw.replace(/[ \t\r]+$/, "");
  const rest = newlineIdx === -1 ? "" : stripped.slice(newlineIdx + 1);

  // Deliberately no dynamically-constructed RegExp here (even escaped) —
  // plain string operations avoid a ReDoS-shaped pattern entirely rather
  // than relying on `commandTokens` always being trusted config content.
  const statusToken = commandTokens.public_status;
  if (statusToken && firstLine.startsWith(statusToken)) {
    const remainder = firstLine.slice(statusToken.length);
    if (/^\s/.test(remainder)) {
      const trimmed = remainder.trim();
      const parts = trimmed.split(/\s+/);
      if (trimmed.length > 0 && parts.length === 1) {
        const argument = parts[0];
        return {
          command: "public_status",
          argument,
          argumentValid: VALID_STATUS_STATES.has(argument),
          body: rest
        };
      }
    }
  }

  for (const [name, token] of Object.entries(commandTokens)) {
    if (name === "public_status") continue;
    if (firstLine === token) {
      return { command: name, argument: null, argumentValid: true, body: rest };
    }
  }

  if (firstLine.startsWith("/")) {
    return { command: "unrecognized", argument: null, argumentValid: false, body: rest };
  }

  return { command: null, argument: null, argumentValid: true, body: rawBody };
}

export { VALID_STATUS_STATES };
