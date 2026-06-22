# Change Note: Structured Redacted Logs

## Summary

PR #15 adds structured JSON logging for runtime startup, shutdown, interaction
failure handling, and command registration.

## Security Impact

- Replaces plain string runtime logs with structured events.
- Uses shared redaction for log fields and error messages.
- Logs bounded error metadata only: name, message, status, and route.
- Avoids logging raw error bodies, stack traces, Discord tokens, adapter tokens,
  and Discord user tags.
- Extends shared string redaction for bearer-token values.
- Does not add commands, adapter routes, write actions, persistence, network
  exposure, or additional Discord permissions.

## Tests

- Added unit coverage for structured info logs.
- Added unit coverage for structured error logs without raw bodies.
- Added unit coverage for bearer-token string redaction.

## Evidence

- Roadmap item: Phase 4 structured logs without tokens or Discord secrets.
- Primary files: `src/logger.js`, `src/index.js`,
  `scripts/register-commands.js`, `test/logger.test.js`

## Known Limitations

The logger intentionally omits stack traces by default. Operators who need stack
traces for a private debugging session should add a separate, reviewed debug
mode that preserves the same redaction guarantees.
