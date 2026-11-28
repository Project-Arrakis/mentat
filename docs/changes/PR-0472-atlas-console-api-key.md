# Change Note: #the-atlas from a Console API key

## Executive Summary

The self-refreshing atlas message can be built from a console's own API, so it
works with a console that has no Discord adapter atlas route. Off unless
configured.

## Technical Summary

- New `src/consoleAtlas.js`: reads `GET /api/maps/combat-state` for both maps
  and `GET /api/map/spice` for the Coriolis cycle, and returns the payload shape
  the atlas embed already uses.
- `AdapterClient.atlas()` uses it for the configured Discord server only.
- `AdapterHttpError` moved to `src/adapterErrors.js` (still exported from
  `adapterClient.js`).
- The embed states when live sandstorm status is unavailable.

## Security

The key is read from a file only, sent only to the configured `https://` address
with redirects refused, never to a per-guild address from the database, and
removed from log text. Errors carry the page and HTTP status, not headers or
response bodies. Startup warns if the key file permissions are looser than 0600.

## Sietch passwords

`src/atlasPasswords.js` adds passwords from `DUNE_ATLAS_PASSWORDS_FILE` to the
channel message only. They are left out unless `@everyone` is denied sight of
the channel. The file is read at each refresh and no error repeats its content.
An entry named `*` is shared by the Hagga Basin sietches and never applies to
the Deep Desert.
The refresher now uses `strictChannel` and `rethrowTransient`, so a message
holding passwords does not stay in an earlier channel or get duplicated.
In the channel message, the `@everyone` rule covers passwords from the adapter
source too, which before this change were shown whatever the channel's
visibility. `/dune server atlas` replies are unchanged and still show passwords
the adapter source returns for the caller's roles. Except on Windows, a
passwords file that group or other users can access is not used.

## Overall Theme

Keep the atlas message working on a console without the Discord adapter atlas
route, without giving the bot more access than reading map state.

## Findings Mitigated

One high-effort code review of the change, with its findings fixed in this pull
request. A second high-effort review covered the `*` shared password entry and
those fixes. Fixed from it: adapter-source passwords shown by the atlas message
in a channel `@everyone` can see, `*` reaching a sietch named `*`, a documented
command that could empty the passwords file, and permissions checked only at
startup. A third high-effort review covered that round and found no blocker.
Fixed from it: documentation saying command replies never show passwords, and
setup commands that could save a value the bot rejects.

## Verification

`npm test`; `test/consoleAtlas.test.js`, `test/atlasPasswords.test.js`.

## Rollback

Unset `DUNE_ATLAS_API_KEY_FILE`, `DUNE_ATLAS_CONSOLE_URL` and
`DUNE_ATLAS_GUILD_ID`, restart, and revoke the key in the console. Removing
`DUNE_ATLAS_PASSWORDS_FILE` takes passwords off at the next successful refresh.
A rollback of the code, or a failing source, leaves the posted message as it is:
delete it by hand.
