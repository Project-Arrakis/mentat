// ACP Issue Bridge — Markdown code-segment splitter.
//
// Used so mention suppression (mentions.mjs) never mutates the contents of
// a fenced code block or inline code span (section 33: "preserve ... code
// blocks; stack traces" — inserting a zero-width character into copyable
// code would silently corrupt it, and GitHub does not linkify/notify
// mentions found inside code spans anyway, so suppressing them there
// serves no purpose).

const FENCE_OR_INLINE = /(```[\s\S]*?```)|(`[^`\n]+`)/g;

/** Split text into alternating {type:'text'|'code', value} segments. */
export function splitMarkdownSegments(text) {
  if (typeof text !== "string" || text.length === 0) {
    return [{ type: "text", value: text || "" }];
  }
  const segments = [];
  let lastIndex = 0;
  let match;
  FENCE_OR_INLINE.lastIndex = 0;
  while ((match = FENCE_OR_INLINE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "code", value: match[0] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  return segments;
}

/** Apply `fn` to only the non-code segments of `text`, then rejoin. */
export function transformTextSegments(text, fn) {
  return splitMarkdownSegments(text)
    .map((segment) => (segment.type === "text" ? fn(segment.value) : segment.value))
    .join("");
}
