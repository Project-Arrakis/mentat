// mentat-link#121: mentat-backend.darkdante.org's "internal-only, never
// advertised" posture is obscurity, not access control -- its Cloudflare
// Tunnel TLS cert is logged to public Certificate Transparency logs by
// design, so the hostname is discoverable by anyone who checks. This is the
// backend half of the fix; mentat-link's reverseProxy.js sends the header
// this checks. Shared by setupServer.js (port 3100) and steamLinkServer.js
// (port 3101) -- two separate Express apps, one gate.
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { logError } from "./logger.js";

// Opt-in/backward-compatible, matching setupServer.js's alertRelayToken()
// pattern: unset means every request is allowed (fail-open), so this ships
// safely before MENTAT_PROXY_SHARED_SECRET exists anywhere, and enforcement
// only turns on once the same value is set here and on the Pages project --
// a deliberate two-phase rollout, not an oversight. The _FILE variant
// follows Project-Arrakis Requirement 24's preference for file-based
// secrets over bare env vars.
export function proxySharedSecret(env = process.env) {
  const direct = env.MENTAT_PROXY_SHARED_SECRET || "";
  if (direct.trim()) return direct.trim();
  const file = env.MENTAT_PROXY_SHARED_SECRET_FILE || "";
  if (!file) return "";
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

// Constant-time comparison guards against a timing side-channel that would
// otherwise let an attacker recover the secret byte-by-byte by measuring
// response latency across many requests.
function secretMatches(provided, expected) {
  const providedBuf = Buffer.from(String(provided || ""), "utf8");
  const expectedBuf = Buffer.from(String(expected || ""), "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// mentat#283 (UI/UX + Security Architect hat findings): the one scenario a
// real person ever sees this 403 is a misconfigured rollout (secret set on
// one side, not yet matching on the other) -- and they're already ON
// mentat-link.darkdante.org when they see it, so the original bare
// "must be accessed via mentat-link.darkdante.org" message was a genuine
// dead end (tells them to do the thing they're already doing). This is
// reused by both `errorPage()` implementations (setupServer.js's imported
// one, steamLinkServer.js's local one -- same `(res, status, title,
// message)` signature in both), passed in as `renderError` so a browser
// navigation gets an actionable page instead of a raw JSON blob; an API
// caller (fetch/XHR, no Accept: text/html) still gets JSON.
const MISCONFIGURATION_MESSAGE =
  "This request didn't come through the expected path. If you're the operator and just " +
  "rotated MENTAT_PROXY_SHARED_SECRET, confirm the SAME value is set on both this bot and the " +
  "mentat-link Pages project -- a mismatch here (not just a missing header) blocks every " +
  "request until both sides agree. If you're a guild admin mid-setup, wait a minute and retry " +
  "the link that brought you here.";

// `exemptPaths` lets a specific route opt out (setupServer.js exempts
// /api/alerts/relay: Alertmanager calls it directly, never through the
// mentat-link proxy, and it already has its own bearer-token auth; both
// apps exempt /health for the same never-through-the-proxy reason).
export function requireProxySecret({ exemptPaths = [], renderError } = {}) {
  return function proxySecretMiddleware(req, res, next) {
    const expected = proxySharedSecret();
    if (!expected || exemptPaths.includes(req.path)) return next();

    const provided = req.get("x-mentat-proxy-secret") || "";
    if (!secretMatches(provided, expected)) {
      logError("reverse_proxy.unauthorized", new Error("Missing or invalid X-Mentat-Proxy-Secret header"), {
        remote: req.ip,
        path: req.path
      });
      if (renderError && req.accepts(["html", "json"]) === "html") {
        return renderError(res, 403, "Access Blocked", MISCONFIGURATION_MESSAGE);
      }
      return res.status(403).json({ error: "Forbidden", detail: MISCONFIGURATION_MESSAGE });
    }
    next();
  };
}
