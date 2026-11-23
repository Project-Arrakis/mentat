# Change Note: Monitoring posts from Mentat in Sahir Venn's voice

## Executive Summary

A monitoring stack can now have its Discord posts come from Mentat itself: a live
status message and firing/resolved alerts, written in Sahir Venn's voice with the
persona footer and a random signed quote. Everything is off unless configured.

## Technical Summary

- New `POST /api/status/relay` (`src/statusRelay.js`): a monitoring job pushes
  structured status; the bot renders it with `duneEmbed()` and keeps one live
  message current through `postOrEditLiveMessage` (key `status`).
- `POST /api/alerts/relay` can post alerts as the bot when
  `DUNE_ALERT_RELAY_CHANNEL_ID` is set (token required), falling back to the
  webhook if the bot cannot post.
- `postOrEditLiveMessage` gains opt-in `strictChannel` and `rethrowTransient`.

## Overall Theme

Operator-facing monitoring that speaks as the bot, without giving the bot any
route into the monitoring host: data is pushed, never pulled.

## Findings Mitigated

Two `/code-review high` rounds on the branch: 17 findings, all but one fixed
(see PR #470). Open by design: a dead monitoring job leaves the last state
displayed (follow-up issue).

## Verification

`npm test` (242 pass, 0 fail), `node --test test/statusRelay.test.js` (37 pass),
architecture drift check clean. Two deliberate mutations were caught by the tests.

## Rollback

Unset `DUNE_STATUS_CHANNEL_ID`, `DUNE_STATUS_RELAY_TOKEN[_FILE]` and
`DUNE_ALERT_RELAY_CHANNEL_ID`; the webhook alert path is unchanged.
