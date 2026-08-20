// ACP Issue Bridge — public input sanitization (spec section 33).
//
// Public issue/comment bodies are attacker-controlled. This neutralizes
// dangerous control characters and Unicode bidi overrides, and caps size,
// while deliberately PRESERVING normal Markdown, code blocks, stack traces,
// and URLs (those are only a security risk in combination with the specific
// things this module targets, not in general).

const C0_C1_CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F\u0080-\u009F]/g;

// Unicode bidirectional control/override characters — used in real-world
// "Trojan Source" style attacks to make text render differently than its
// underlying byte sequence. No legitimate bug report / feature request
// needs these.
const BIDI_CONTROL_CHARS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const DEFAULT_MAX_BYTES = 60000;

function byteLength(str) {
  return Buffer.byteLength(str, "utf8");
}

function truncateToBytes(str, maxBytes) {
  if (byteLength(str) <= maxBytes) return { text: str, truncated: false };
  // Binary-search the largest prefix (in UTF-16 code units) whose UTF-8
  // byte length fits, so we never split a multi-byte character.
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (byteLength(str.slice(0, mid)) <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  return { text: str.slice(0, lo), truncated: true };
}

/**
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.maxBytes]
 * @returns {string}
 */
export function sanitizeInboundContent(text, options = {}) {
  if (typeof text !== "string" || text.length === 0) return "";
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let sanitized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(C0_C1_CONTROL_CHARS, "")
    .replace(BIDI_CONTROL_CHARS, "");

  const { text: truncated, truncated: wasTruncated } = truncateToBytes(sanitized, maxBytes);
  sanitized = truncated;
  if (wasTruncated) {
    sanitized += `\n\n_[ACP Issue Bridge: content truncated — original was ${byteLength(text)} bytes, limit is ${maxBytes} bytes]_`;
  }

  return sanitized;
}
