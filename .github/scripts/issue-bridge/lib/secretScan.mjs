// ACP Issue Bridge — outbound sensitive-content scanner (spec section 45/46).
//
// Bias intentionally toward false positives over false negatives: per the
// bridge's core invariant, "a missed public update is acceptable; accidental
// private disclosure is a security incident" — so every pattern here errs
// on the side of blocking. Callers must never echo the matched substring
// anywhere (logs, audit events, the blocked-publication comment) — this
// module deliberately returns only category names, never the match text.

const MANDATORY_PATTERNS = [
  { category: "github-pat", regex: /\bgh[oprsu]_[A-Za-z0-9]{10,}\b/ },
  { category: "github-fine-grained-pat", regex: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { category: "jwt", regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/ },
  { category: "pem-private-key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/ },
  { category: "aws-access-key-id", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { category: "aws-secret-key-assignment", regex: /aws_secret_access_key\s*[:=]\s*['"]?[A-Za-z0-9/+=]{30,}/i },
  { category: "bearer-token", regex: /\bBearer\s+[A-Za-z0-9\-_.=]{10,}/i },
  { category: "authorization-header", regex: /\bAuthorization\s*:\s*\S+/i },
  { category: "cookie-or-session-token", regex: /\b(set-cookie|cookie|connect\.sid|sessionid|session_token|auth_token|csrftoken)\s*[:=]\s*\S+/i },
  { category: "credentials-in-url", regex: /https?:\/\/[^\s\/@:]+:[^\s\/@:]+@[^\s\/]+/i },
  {
    // Deliberately not anchored to a word boundary before the keyword: real
    // secrets are usually held in env-var-style names like
    // DUNE_DISCORD_ADAPTER_TOKEN, where "_TOKEN" has no \b before it
    // (underscore is a word character) — matching the keyword as a suffix
    // of a longer identifier is intentional, not a bug.
    category: "generic-secret-assignment",
    regex: /(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret)[A-Za-z0-9_-]*\s*[:=]\s*['"]?[A-Za-z0-9\-_/+=]{8,}['"]?/i,
    exclude: /\b(none|null|changeme|example|xxxx+|redacted|\*+|placeholder|<[^>]+>|\$\{[^}]+\})\b/i
  }
];

const CONFIGURABLE_PATTERNS = [
  {
    category: "rfc1918-address",
    regex: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/
  },
  { category: "internal-dns-name", regex: /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(internal|local|corp|lan)\b/i },
  { category: "local-filesystem-path", regex: /(^|\s)(\/(?:home|root)\/\S+|[A-Za-z]:\\Users\\\S+)/m },
  { category: "internal-stack-trace", regex: /\bat\s+[\w.$<>]+\s+\(\/[^)\s]+:\d+:\d+\)/ }
];

/**
 * @param {string} text
 * @param {object} [options]
 * @param {boolean} [options.configurable=true] - run the lower-confidence,
 *   configurable checks (RFC1918/internal DNS/stack traces/local paths) too.
 * @param {string[]} [options.privateRepoSlugs] - private repository slugs
 *   ("owner/repo") whose URLs must never be published.
 * @returns {{ blocked: boolean, categories: string[] }}
 */
export function scanForSensitiveContent(text, options = {}) {
  const { configurable = true, privateRepoSlugs = [] } = options;
  if (typeof text !== "string" || text.length === 0) return { blocked: false, categories: [] };

  const categories = new Set();

  for (const { category, regex, exclude } of MANDATORY_PATTERNS) {
    const match = regex.exec(text);
    if (match && !(exclude && exclude.test(match[0]))) {
      categories.add(category);
    }
  }

  if (configurable) {
    for (const { category, regex } of CONFIGURABLE_PATTERNS) {
      if (regex.test(text)) categories.add(category);
    }
  }

  for (const slug of privateRepoSlugs) {
    const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`github\\.com[:/]${escaped}\\b`, "i").test(text)) {
      categories.add("private-repository-url");
    }
    if (new RegExp(`${escaped}/(files|blob|raw|actions|runs)/`, "i").test(text)) {
      categories.add("private-repository-attachment");
    }
  }

  return { blocked: categories.size > 0, categories: [...categories].sort() };
}
