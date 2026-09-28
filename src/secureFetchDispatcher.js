// secureFetchDispatcher.js -- mentat#393: closes the DNS-rebinding gap
// consoleUrlValidation.js's own header comment already disclosed.
//
// validateConsoleUrl() only ever runs once, at registration time. The
// stored consoleUrl is then re-read on every single adapterClient.js
// request for as long as the guild stays registered -- a hostname that
// resolves publicly at registration and gets repointed at a private/
// metadata address any time afterward would otherwise bypass that check
// completely and indefinitely (not a narrow race window; see the issue's
// own writeup for the full exploit trace).
//
// The fix is a connect-time guard, not a periodic re-validate-then-fetch:
// re-running validateConsoleUrl() immediately before each request would
// only shrink the bypass window to one DNS TTL, since the attacker's
// record could still change in the gap between that check and the actual
// TCP connect. Hooking undici's own connector -- the function that
// resolves DNS immediately before opening the socket -- means the address
// actually connected to is the SAME one just checked, with no gap at all.
//
// Verified directly (not assumed) against this repo's real undici version
// (6.28.0): a custom `connect.lookup` function on an `Agent` receives
// `(hostname, options, callback)` with `options.all === true` for every
// real fetch(), and calling `callback(new Error(...))` causes the fetch
// itself to reject with a `fetch failed` error carrying that error as
// `.cause` -- confirmed with a real local HTTP server, not a mock.
//
// Layer 2 audit finding (Security Architect hat, second pass): `options.all`
// being true is NOT structurally guaranteed by undici -- undici's connector
// delegates to Node's own net.connect()/tls.connect(), which decides
// `options.all` based on the process-wide `autoSelectFamily` setting
// (Happy Eyeballs), not anything this module controls. Verified directly:
// with `net.setDefaultAutoSelectFamily(false)` simulating a flipped global
// default, `options.all` becomes falsy and this function would previously
// have replied with an array in single-address mode, which Node rejects
// outright ("Invalid IP address"). That failed CLOSED (no bypass), but as
// an unexplained full outage of every adapter request, not a graceful
// degradation -- and depended on a global Node default this module never
// asserted. Fixed two ways, defense in depth: (1) `autoSelectFamily: true`
// is now forced explicitly in createSecureDispatcher()'s connect options,
// confirmed directly to override the global default and keep `options.all`
// true regardless of it; (2) createSecureLookup() itself now branches on
// `options.all` and replies in the correct shape either way, so a future
// undici/Node change to how `all` gets decided can't silently break this
// again even if (1) is ever removed.

import dns from "node:dns/promises";
import { Agent } from "undici";

import { isDisallowedIP } from "./consoleUrlValidation.js";

// `lookupImpl` matches consoleUrlValidation.js's own DI convention (a
// promise-returning function shaped like dns.promises.lookup) so tests can
// inject the same kind of fake resolver already used there, rather than a
// second, differently-shaped test seam. Exported so the callback contract
// itself (what gets passed to `callback` for each outcome) can be unit
// tested directly, in addition to the real-network integration tests that
// exercise it through an actual Agent/fetch().
export function createSecureLookup(lookupImpl) {
  return function secureLookup(hostname, options, callback) {
    lookupImpl(hostname, { all: true, verbatim: true }).then((addresses) => {
      if (!Array.isArray(addresses) || addresses.length === 0) {
        callback(new Error(`Destination hostname "${hostname}" could not be resolved.`));
        return;
      }
      if (addresses.some((a) => isDisallowedIP(a.address))) {
        callback(new Error(`Destination "${hostname}" resolved to a private, loopback, or link-local address.`));
        return;
      }
      // Every one of these addresses has already individually passed the
      // check above, so which shape/which one gets used doesn't matter
      // for safety -- only for matching what the caller (Node's net
      // internals) actually asked for.
      if (options?.all) {
        callback(null, addresses);
      } else {
        callback(null, addresses[0].address, addresses[0].family);
      }
    }, (err) => {
      callback(err);
    });
  };
}

// One shared Agent per lookupImpl, not one per request -- undici's own
// documented usage pattern (an Agent pools/reuses connections across
// requests). Production code always uses the default (real dns.lookup);
// the parameter exists so tests can inject a fake resolver, same reason
// validateConsoleUrl() takes one.
export function createSecureDispatcher({ lookupImpl = dns.lookup } = {}) {
  return new Agent({ connect: { autoSelectFamily: true, lookup: createSecureLookup(lookupImpl) } });
}

// Shared, lazily-created default-config instance -- adapterClient.js calls
// this on every request; constructing a fresh Agent (and losing connection
// pooling) per call would defeat the point of using an Agent at all.
let defaultDispatcher = null;
export function getDefaultSecureDispatcher() {
  if (!defaultDispatcher) defaultDispatcher = createSecureDispatcher();
  return defaultDispatcher;
}
