// htmlEscape.js — shared HTML-escaping helper for this bot's small web
// surfaces (setupServer.js's multi-tenant OAuth setup pages,
// steamLinkServer.js's Steam-linking callback pages). Extracted from
// setupServer.js's original inline esc() so both modules share exactly one
// implementation instead of two copies that could silently drift apart.
export function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
