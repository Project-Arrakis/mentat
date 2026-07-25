# Write Confirmation & Execution Flow

## Implementation Status

**The confirmation UI described in this document is implemented** in
`src/writeConfirmation.js`, wired into `src/writeHandler.js` (prompt
creation) and `src/index.js` (button routing). It is exercised by
`test/writeConfirmation.test.js` and `test/writeHandler.test.js`.

**Execution is intentionally NOT implemented.** Clicking Confirm reports the
same "scaffolded, awaiting upstream contract" status the initial write
command already returns (see `buildScaffoldedEmbed()` in
`writeConfirmation.js`). Confirming a write action never calls
`adapterClient.writePreview()` or `adapterClient.writeExecute()` — those
routes are in `MISSING_ROUTES` (`src/adapterClient.js`) because no upstream
write-capable adapter contract has been published or approved. This matches
the constraint in `docs/r1-r2-release-roadmap.md`, which blocks "write
adapter execution calls" until R2 entry criteria are met. Sections below that
describe preview/execute calls, confirmation nonces, and dry-run behavior
document the target design for when that upstream contract exists — treat
them as forward-looking, not current behavior.

## Overview

Every write command requires explicit user confirmation before execution.
This document specifies the confirmation UI, interaction handling, and the
protocol between bot and adapter.

## Confirmation UI

Confirmation uses Discord message components — buttons instead of text replies:

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ Confirm Write Action                                  │
│                                                         │
│ Action: Set Maintenance Note                            │
│ Target: "Scheduled maintenance at 02:00 UTC"            │
│ Risk: Low                                               │
│                                                         │
│ This will be visible to all operators.                  │
│                                                         │
│ ┌──────────┐  ┌──────────┐                              │
│ │ Confirm  │  │  Cancel  │                              │
│ └──────────┘  └──────────┘                              │
└─────────────────────────────────────────────────────────┘
```

**Design rules:**
- Confirmation prompt is **ephemeral** (only the invoking user sees it, via
  the existing write command's `interaction.editReply()`).
- Action, tier, and risk are always displayed (target only when provided).
- Confirm button uses Discord's green "Success" button style.
- Cancel button uses Discord's grey "Secondary" button style.
- Prompt times out after 60 seconds by default, configurable via
  `DUNE_WRITE_CONFIRMATION_TIMEOUT_MS` (mainly for tests).
- **Known limitation:** on timeout, an audit event is generated
  (`writeTimeoutAuditEvent()`), but the original Discord message is not
  edited — the confirm/cancel buttons remain visually active until clicked.
  Clicking either button after expiry correctly shows "Confirmation
  Expired," since the server-side pending-confirmation entry is already
  gone. Editing the original message on timeout would require holding a
  live Discord message/interaction reference in the in-memory pending map;
  this was deferred as a known limitation rather than implemented silently.

## Interaction Handling (Current, Implemented)

### 1. Initial Command

```js
// User types /dune write maintenance-note note:"Scheduled maintenance"
// → handleWriteCommand() (writeHandler.js) validates writesEnabled()/canWrite(),
//   generates an idempotency key, and calls createPendingConfirmation()
//   (writeConfirmation.js), which registers the pending entry and returns
//   { embed, row }.
// → commands.js sees payload.confirmationEmbed/confirmationRow and replies
//   with interaction.editReply({ embeds: [embed], components: [row] })
//   (ephemeral, since write commands use the default ephemeral reply).
```

### 2. Confirm Button Click

```js
// User clicks [Confirm]
// → index.js's InteractionCreate listener routes button interactions to
//   handleWriteButtonInteraction() (writeConfirmation.js) before falling
//   through to executeDuneCommand().
// → handleWriteButtonInteraction() validates interaction.user.id matches the
//   pending entry's userId, clears the pending entry, and calls
//   interaction.update() to show buildScaffoldedEmbed(): "confirmed, but
//   write execution is not implemented."
// → NO adapter call is made (no writePreview(), no writeExecute()). See the
//   "Implementation Status" note above for why.
```

### 3. Cancel Button Click

```js
// User clicks [Cancel]
// → handleWriteButtonInteraction() clears the pending entry and calls
//   interaction.update() to show buildCancelledEmbed("cancelled").
// → No adapter call made (there was never one to make on this path either).
```

### 4. Timeout (60s, configurable)

```js
// No interaction within the configured window
// → The setTimeout registered by createPendingConfirmation() fires,
//   removes the entry from the pending map, and calls the onTimeout
//   callback, which currently only produces a writeTimeoutAuditEvent()
//   (see the timeout limitation noted above — the original message is not
//   edited to disable the buttons).
```

## Button Component Design (Current, Implemented)

```js
// src/writeConfirmation.js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

export function buildConfirmationRow(idempotencyKey) {
  const confirm = new ButtonBuilder()
    .setCustomId(`write:confirm:${idempotencyKey}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);

  const cancel = new ButtonBuilder()
    .setCustomId(`write:cancel:${idempotencyKey}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(confirm, cancel);
}
```

The `customId` encodes only the idempotency key (`write:<action>:<key>`),
not a separate confirmation nonce — there is no adapter-issued nonce today
because no preview call is made. If/when `writePreview()` is wired in for
real execution, the nonce returned by the adapter should be appended to the
`customId` as documented in the forward-looking sections below.

## Interaction Routing (Current, Implemented)

```js
// src/index.js
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton?.()) {
      await handleWriteButtonInteraction(interaction);
      return;
    }
    await executeDuneCommand(interaction, adapterClient, config, db);
  } catch (error) {
    logError("discord.interaction_failed", error);
  }
});
```

## Forward-Looking: Nonce-Based Interaction Routing (Not Implemented)

The routing sketch below describes the target design once a real
`writePreview()`/`writeExecute()` call path exists. It is **not** how
`src/index.js` routes interactions today (see above for the current code).

```js
// FUTURE — not implemented:
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const [prefix, action, idempotencyKey, nonce] = interaction.customId.split(":");
  if (prefix !== "write") return;

  if (action === "cancel") {
    await handleWriteCancel(interaction, idempotencyKey);
  } else if (action === "confirm") {
    await handleWriteConfirm(interaction, idempotencyKey, nonce);
  }
});
```

## Forward-Looking: Dry-Run / Preview Flow (Not Implemented)

No command currently exposes a `dry_run` option, and no `POST /write/preview`
call is ever made — see the "Implementation Status" note above. This section
documents the target design for when a real upstream write-adapter contract
exists.

When a command supports dry-run (as advertised by the adapter's capabilities):

1. User adds `dry_run:true` to the command.
2. Bot calls `POST /write/preview` with `dryRun: true`.
3. Adapter returns the preview result with `dryRun: true`.
4. Bot displays the preview in an ephemeral embed without confirmation buttons.
5. No confirmation nonce is generated.
6. No execute call is made.

```
/dune admin set-maintenance-note note:"test" dry_run:true

┌─────────────────────────────────────────────────────────┐
│ 🔍 Dry Run Preview                                       │
│                                                         │
│ Action: Set Maintenance Note                            │
│ Would set: "test"                                       │
│ Risk: Low                                               │
│ Side Effects: config-write                              │
│                                                         │
│ This is a preview only — nothing was changed.           │
└─────────────────────────────────────────────────────────┘
```

## Forward-Looking: Confirmation Nonce Protocol (Not Implemented)

No confirmation nonce is generated or validated today; the `customId` only
carries the bot-generated idempotency key (see "Button Component Design"
above). This section documents the target protocol once `writePreview()`/
`writeExecute()` are wired to a real upstream contract.

```
Bot                                  Adapter
───                                  ───────
POST /write/preview ────────────────►
  {action, params, actor}
                                     Generates nonce (60s TTL)
                                     Stores: nonce → {action, params, actor}
                    ◄──────────────── 200 {preview, nonce, expiresAt}

[User clicks Confirm]

POST /write/execute ────────────────►
  {action, params, actor,
   idempotencyKey, nonce}
                                     Validates nonce exists + not expired
                                     Validates params match stored preview
                                     Consumes nonce (deletes)
                                     Executes action
                                     Records audit event
                    ◄──────────────── 200 {ok, auditId}
```

## Error States

Current, implemented states (`src/writeConfirmation.js`):

| State | Button Behavior | Message |
|-------|----------------|---------|
| Confirmation key unknown/already resolved | `interaction.update()` clears components | "Confirmation Expired — Re-run the command to try again." |
| Another user clicked | Ephemeral reply, pending entry untouched | "Not Your Confirmation — This confirmation prompt belongs to another user." |
| Confirmed | Components cleared | "Write Not Executed — confirmed, but write execution is not implemented." |
| Cancelled | Components cleared | "Cancelled — No write action was executed." |
| Timeout | Entry removed, audit event recorded | *(message not edited — see known limitation above)* |

Forward-looking states below apply once real adapter calls exist and are
**not implemented**:

| State | Button Behavior | Message |
|-------|----------------|---------|
| Adapter unreachable | Buttons remain active | "Adapter unavailable — try again" |
| Nonce expired | Buttons disabled | "Confirmation expired — re-run the command" |
| Idempotency collision | Disable Confirm | "This action was already executed" |
| Already confirmed | Both disabled | "Action confirmed — executing..." |

## Sources

- [Write Architecture](rw-architecture.md)
- [Adapter Contract](rw-adapter-contract.md)
- [Write Safety Primitives](../src/writes.js)
- [Discord Message Components](https://discordjs.guide/message-components/)
