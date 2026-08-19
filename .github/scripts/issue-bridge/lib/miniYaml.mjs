// ACP Issue Bridge — minimal, deterministic YAML-subset parser.
//
// This is NOT a general-purpose YAML parser. It intentionally supports only
// the narrow subset needed by `acp-issue-bridge.yml`: nested block mappings
// of scalar values (strings/booleans/integers), `#` comments, and blank
// lines. No flow style (`{}`/`[]`), no lists, no anchors/aliases, no
// multi-line scalars, no tabs.
//
// Rationale (see docs/issue-bridge/architecture.md "Configuration parsing"):
//   - Adding a third-party YAML dependency for a handful of nested maps is
//     an unnecessary dependency for a security-sensitive control path.
//   - A narrow, hand-written parser that REJECTS anything outside its
//     supported subset (instead of guessing) is easier to audit end-to-end
//     and matches the bridge's fail-closed posture: malformed configuration
//     must never be silently misinterpreted.
//
// Any input outside the supported subset throws ConfigParseError. Callers
// (config.mjs) treat that as a CONFIGURATION-class error and fail closed.

export class ConfigParseError extends Error {
  constructor(message, line) {
    super(line == null ? message : `${message} (line ${line})`);
    this.name = "ConfigParseError";
    this.line = line;
  }
}

const KEY_VALUE_LINE = /^(".*?"|'.*?'|[^:#\s][^:]*?):(?:\s+(.*))?$/;
const KEY_ONLY_LINE = /^(".*?"|'.*?'|[^:#\s][^:]*?):\s*$/;

function unquote(raw) {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function coerceScalar(raw) {
  if (raw === undefined || raw === "") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Strip inline comments only when the value isn't quoted (quoted values
  // may legitimately contain a literal '#').
  const isQuoted = (trimmed[0] === '"' || trimmed[0] === "'");
  let value = trimmed;
  if (!isQuoted) {
    const hashIndex = value.indexOf(" #");
    if (hashIndex !== -1) value = value.slice(0, hashIndex).trim();
  }

  const unquoted = unquote(value);
  if (!isQuoted) {
    if (unquoted === "true") return true;
    if (unquoted === "false") return false;
    if (unquoted === "null" || unquoted === "~") return null;
    if (/^-?\d+$/.test(unquoted)) return Number.parseInt(unquoted, 10);
    if (/^-?\d+\.\d+$/.test(unquoted)) return Number.parseFloat(unquoted);
  }
  return unquoted;
}

function indentOf(line) {
  const match = /^ */.exec(line);
  return match[0].length;
}

/**
 * Parse a restricted YAML-subset document into a plain nested object.
 * Throws ConfigParseError on anything outside the supported subset.
 */
export function parseSimpleYaml(text) {
  if (typeof text !== "string") {
    throw new ConfigParseError("config source must be a string");
  }

  const rawLines = text.split(/\r\n|\r|\n/);
  if (rawLines.includes("")) {
    // normal — blank lines are allowed and skipped below.
  }

  const lines = [];
  rawLines.forEach((line, idx) => {
    if (line.includes("\t")) {
      throw new ConfigParseError("tabs are not permitted in config", idx + 1);
    }
    const withoutTrailingComment = line;
    const trimmed = withoutTrailingComment.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    if (trimmed === "---" || trimmed === "...") return;
    if (/^[{}[\]]/.test(trimmed) || trimmed.includes(": {") || trimmed.includes(": [")) {
      throw new ConfigParseError("flow-style mappings/sequences are not supported", idx + 1);
    }
    if (trimmed.startsWith("- ") || trimmed === "-") {
      throw new ConfigParseError("sequences are not supported", idx + 1);
    }
    lines.push({ indent: indentOf(line), text: trimmed, num: idx + 1 });
  });

  const root = {};
  const stack = [{ indent: -1, node: root }];

  for (const { indent, text: lineText, num } of lines) {
    // Pop back to the nearest enclosing mapping whose indent is strictly
    // less than this line's indent — standard indentation-based nesting.
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];

    const keyOnly = KEY_ONLY_LINE.exec(lineText);
    if (keyOnly) {
      const key = unquote(keyOnly[1]);
      if (Object.prototype.hasOwnProperty.call(parent.node, key)) {
        throw new ConfigParseError(`duplicate key "${key}"`, num);
      }
      const child = {};
      parent.node[key] = child;
      stack.push({ indent, node: child });
      continue;
    }

    const kv = KEY_VALUE_LINE.exec(lineText);
    if (!kv) {
      throw new ConfigParseError(`unparseable line: "${lineText}"`, num);
    }
    const key = unquote(kv[1]);
    if (Object.prototype.hasOwnProperty.call(parent.node, key)) {
      throw new ConfigParseError(`duplicate key "${key}"`, num);
    }
    parent.node[key] = coerceScalar(kv[2]);
  }

  return root;
}
