// consoleUrlValidation.js — SSRF prevention for operator-submitted consoleUrl values.
//
// mentat is a shared, multi-tenant service: any Discord user who owns (or
// creates, for free) a guild can submit a consoleUrl that this process will
// later make real, authenticated, server-side outbound requests to (see
// adapterClient.js). Without a destination check, "own a free Discord
// account" is a sufficient bar to turn mentat's own host into an SSRF proxy
// against its own internal network or any other address it can reach.
//
// This check runs at registration time. It does not defend against DNS
// rebinding between registration and later use — a hostname that resolves
// to a public IP now could be repointed at a private address later. Treat
// this as the first layer, not a complete guarantee; request-time
// revalidation in adapterClient.js is a valuable follow-up, not yet done.

import dns from "node:dns/promises";
import net from "node:net";

// RFC 1918 / RFC 5735 / RFC 3927 / RFC 6598 style private, loopback,
// link-local, and shared-address-space ranges, plus common cloud metadata
// endpoints. Deliberately conservative — reject anything that isn't clearly
// a public address rather than trying to enumerate every attack vector.
function isDisallowedIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 169 && b === 254) return true; // link-local incl. cloud metadata (169.254.169.254)
  if (a === 100 && b >= 64 && b <= 127) return true; // RFC 6598 (carrier-grade NAT)
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isDisallowedIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower.startsWith("::ffff:")) return isDisallowedIPv4(lower.slice(7)); // IPv4-mapped
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower === "::") return true;
  return false;
}

function isDisallowedIP(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isDisallowedIPv4(ip);
  if (family === 6) return isDisallowedIPv6(ip);
  return true; // not a recognizable IP at all — reject rather than guess
}

/**
 * Validates a console URL is well-formed https:// and does not resolve to
 * a private/loopback/link-local/metadata address. Throws an Error with a
 * caller-safe message on rejection; returns nothing on success.
 *
 * `lookupImpl` is injectable (defaults to dns.promises.lookup) so tests can
 * exercise this without depending on real DNS resolution for test hostnames.
 */
export async function validateConsoleUrl(consoleUrl, { lookupImpl = dns.lookup } = {}) {
  if (typeof consoleUrl !== "string" || consoleUrl.trim().length === 0) {
    throw new Error("Console URL is required.");
  }

  let parsed;
  try {
    parsed = new URL(consoleUrl);
  } catch {
    throw new Error("Console URL must be a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Console URL must use https://.");
  }

  const hostname = parsed.hostname;

  // If the hostname is itself a literal IP, check it directly.
  if (net.isIP(hostname)) {
    if (isDisallowedIP(hostname)) {
      throw new Error("Console URL must not point at a private, loopback, or link-local address.");
    }
    return;
  }

  if (hostname === "localhost") {
    throw new Error("Console URL must not point at localhost.");
  }

  // Resolve and check every address the hostname maps to — reject if any
  // one of them is disallowed, since DNS can return multiple records.
  let addresses;
  try {
    addresses = await lookupImpl(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Console URL's hostname could not be resolved.");
  }

  if (addresses.length === 0 || addresses.some((a) => isDisallowedIP(a.address))) {
    throw new Error("Console URL must not point at a private, loopback, or link-local address.");
  }
}
