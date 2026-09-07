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

// `exemptPaths` lets a specific route opt out (setupServer.js exempts
// /api/alerts/relay: Alertmanager calls it directly, never through the
// mentat-link proxy, and it already has its own bearer-token auth).
export function requireProxySecret({ exemptPaths = [] } = {}) {
  return function proxySecretMiddleware(req, res, next) {
    const expected = proxySharedSecret();
    if (!expected || exemptPaths.includes(req.path)) return next();

    const provided = req.get("x-mentat-proxy-secret") || "";
    if (!secretMatches(provided, expected)) {
      logError("reverse_proxy.unauthorized", new Error("Missing or invalid X-Mentat-Proxy-Secret header"), {
        remote: req.ip,
        path: req.path
      });
      return res.status(403).json({ error: "Forbidden — this endpoint must be accessed via mentat-link.darkdante.org" });
    }
    next();
  };
}
