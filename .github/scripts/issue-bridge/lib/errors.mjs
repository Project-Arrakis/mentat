// ACP Issue Bridge — error classification (spec section 63).
//
// Every failure the bridge produces is classified into exactly one of these
// classes so audit events (section 64/65) and retry policy (section 62) can
// treat them consistently. Never throw a bare Error from orchestration code
// — wrap it in one of these so callers can make a fail-closed decision
// without guessing what went wrong.

export const ErrorClass = Object.freeze({
  TRANSIENT: "TRANSIENT",
  AUTHORIZATION: "AUTHORIZATION",
  VALIDATION: "VALIDATION",
  CORRELATION: "CORRELATION",
  SECURITY: "SECURITY",
  RATE_LIMIT: "RATE_LIMIT",
  CONFIGURATION: "CONFIGURATION",
  UNKNOWN: "UNKNOWN"
});

export class BridgeError extends Error {
  /**
   * @param {string} message
   * @param {keyof typeof ErrorClass} errorClass
   * @param {object} [details] structured, non-sensitive context for audit logs
   */
  constructor(message, errorClass, details = {}) {
    super(message);
    this.name = "BridgeError";
    if (!Object.values(ErrorClass).includes(errorClass)) {
      throw new Error(`invalid ErrorClass: ${errorClass}`);
    }
    this.errorClass = errorClass;
    this.details = details;
  }
}

export function transientError(message, details) {
  return new BridgeError(message, ErrorClass.TRANSIENT, details);
}
export function authorizationError(message, details) {
  return new BridgeError(message, ErrorClass.AUTHORIZATION, details);
}
export function validationError(message, details) {
  return new BridgeError(message, ErrorClass.VALIDATION, details);
}
export function correlationError(message, details) {
  return new BridgeError(message, ErrorClass.CORRELATION, details);
}
export function securityError(message, details) {
  return new BridgeError(message, ErrorClass.SECURITY, details);
}
export function rateLimitError(message, details) {
  return new BridgeError(message, ErrorClass.RATE_LIMIT, details);
}
export function configurationError(message, details) {
  return new BridgeError(message, ErrorClass.CONFIGURATION, details);
}

/**
 * Classify an arbitrary thrown value (e.g. from ghApi) into a BridgeError.
 * Never re-throws the original unwrapped — always returns a BridgeError so
 * callers get a consistent .errorClass to make fail-closed decisions on.
 */
export function classifyError(err) {
  if (err instanceof BridgeError) return err;

  const status = err && typeof err === "object" ? err.status : undefined;
  const message = err && err.message ? err.message : String(err);

  if (status === 401 || status === 403) {
    return authorizationError(message, { status });
  }
  if (status === 429) {
    return rateLimitError(message, { status });
  }
  if (status === 502 || status === 503 || status === 504) {
    return transientError(message, { status });
  }
  if (err && (err.code === "ETIMEDOUT" || err.code === "ECONNRESET" || err.name === "AbortError")) {
    return transientError(message, { code: err.code });
  }
  return new BridgeError(message, ErrorClass.UNKNOWN, { status, originalName: err && err.name });
}
