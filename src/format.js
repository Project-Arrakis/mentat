const REDACTED = "[REDACTED]";
const CREDENTIAL_KEY_PATTERN = /(authorization|cookie|password|secret|token|api[_-]?key|credential)/i;
const KEY_NORMALIZER_PATTERN = /[^a-z0-9]/gi;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const STEAM_ID64_PATTERN = /\b7656119\d{10}\b/g;
const STEAM_ID2_PATTERN = /\bSTEAM_[0-5]:[01]:\d+\b/gi;
const STEAM_ID3_PATTERN = /\[U:1:\d+\]/gi;
const LABELED_CREDENTIAL_PATTERN = /\b((?:authorization|cookie|password|secret|token|api[_-]?key|credential)\s*[:=]\s*)(?:"[^"]+"|'[^']+'|[^\s,;]+)/gi;
const LABELED_STEAM_ID_PATTERN = /\b((?:steam[\s_-]*(?:id|id64|64|account(?:[\s_-]*id)?))\s*[:=#]\s*)(?:"[^"]+"|'[^']+'|[A-Za-z0-9._:-]{3,})/gi;
const LABELED_FUNCOM_ID_PATTERN = /\b((?:funcom[\s_-]*(?:id|user(?:[\s_-]*id)?|account(?:[\s_-]*id)?))\s*[:=#]\s*)(?:"[^"]+"|'[^']+'|[A-Za-z0-9._:-]{3,})/gi;
const REAL_NAME_KEY_SUFFIXES = [
  "firstname",
  "lastname",
  "fullname",
  "realname",
  "legalname",
  "givenname",
  "familyname",
  "surname",
  "birthname"
];
const DISCORD_MESSAGE_LIMIT = 2000;
const JSON_BODY_LIMIT = 1800;

export function formatPayload(title, value) {
  const body = JSON.stringify(redactSecrets(value), null, 2);
  const clipped = body.length > JSON_BODY_LIMIT ? `${body.slice(0, JSON_BODY_LIMIT)}\n... truncated` : body;
  return limitDiscordContent(`**${title}**\n~~~json\n${clipped}\n~~~`);
}

export function formatError(error) {
  const status = error?.status ? ` HTTP ${error.status}` : "";
  const body = error?.body ? `\n${JSON.stringify(redactSecrets(error.body), null, 2).slice(0, 1200)}` : "";
  return limitDiscordContent(`Adapter request failed${status}: ${error?.message || "Unknown error."}${body}`);
}

export function redactSecrets(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactSensitiveString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, seen));

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (shouldRedactKey(key)) return [key, REDACTED];
    return [key, redactSecrets(item, seen)];
  }));
}

function shouldRedactKey(key) {
  if (CREDENTIAL_KEY_PATTERN.test(key)) return true;

  const normalized = String(key).replace(KEY_NORMALIZER_PATTERN, "").toLowerCase();
  if (normalized.includes("email") || normalized.includes("mailaddress")) return true;
  if (normalized.includes("steamid") || normalized.includes("steam64") || normalized.includes("steamaccountid")) return true;
  if (normalized.includes("funcomid") || normalized.includes("funcomuserid") || normalized.includes("funcomaccountid")) return true;

  return REAL_NAME_KEY_SUFFIXES.some((suffix) => normalized === suffix || normalized.endsWith(suffix));
}

function redactSensitiveString(value) {
  return value
    .replace(LABELED_CREDENTIAL_PATTERN, `$1${REDACTED}`)
    .replace(LABELED_STEAM_ID_PATTERN, `$1${REDACTED}`)
    .replace(LABELED_FUNCOM_ID_PATTERN, `$1${REDACTED}`)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(STEAM_ID64_PATTERN, REDACTED)
    .replace(STEAM_ID2_PATTERN, REDACTED)
    .replace(STEAM_ID3_PATTERN, REDACTED);
}

function limitDiscordContent(value) {
  if (value.length <= DISCORD_MESSAGE_LIMIT) return value;
  return `${value.slice(0, DISCORD_MESSAGE_LIMIT - 16)}\n... truncated`;
}
