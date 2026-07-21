# Write Confirmation & Execution Flow

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
- Confirmation prompt is **ephemeral** (only the invoking user sees it).
- Action, target, and risk are always displayed.
- Confirm button uses success color (Atreides blue).
- Cancel button uses secondary color.
- Prompt times out after 60 seconds.
- On timeout, the buttons are disabled and the message notes "cancelled."

## Interaction Handling

### 1. Initial Command

```js
// User types /dune admin set-maintenance-note note:"Scheduled maintenance"
// → executeWriteCommand() returns { needsConfirmation: true, ... }
// → Bot replies with ephemeral confirmation embed + buttons
```

### 2. Confirm Button Click

```js
// User clicks [Confirm]
// → Bot validates the interaction came from the same user
// → Bot generates idempotency key
// → Bot calls adapterClient.writePreview(action, params, actor)
// → Adapter returns confirmation nonce + preview
// → Bot calls adapterClient.writeExecute(action, params, actor, idempotencyKey, nonce)
// → Adapter executes and returns audit ID
// → Bot edits the ephemeral message to show success
// → Bot records writeAuditEvent()
```

### 3. Cancel Button Click

```js
// User clicks [Cancel]
// → Bot edits the ephemeral message to show "cancelled"
// → Bot records a cancelled audit event
// → No adapter call made
```

### 4. Timeout (60s)

```js
// No interaction within 60 seconds
// → Bot disables both buttons
// → Bot edits message to show "cancelled (timeout)"
// → Bot records a timeout audit event
```

## Button Component Design

```js
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

function buildConfirmationRow(actionId, nonce) {
  const confirm = new ButtonBuilder()
    .setCustomId(`write:confirm:${actionId}:${nonce}`)
    .setLabel("Confirm")
    .setStyle(ButtonStyle.Success);

  const cancel = new ButtonBuilder()
    .setCustomId(`write:cancel:${actionId}`)
    .setLabel("Cancel")
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder().addComponents(confirm, cancel);
}
```

The `customId` encodes the action identifier and nonce so the interaction
handler can route the confirmation to the correct command.

## Interaction Routing

```js
// In index.js or a write interaction handler:
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

## Dry-Run / Preview Flow

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

## Confirmation Nonce Protocol

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

| State | Button Behavior | Message |
|-------|----------------|---------|
| Adapter unreachable | Buttons remain active | "Adapter unavailable — try again" |
| Nonce expired | Buttons disabled | "Confirmation expired — re-run the command" |
| Idempotency collision | Disable Confirm | "This action was already executed" |
| Already confirmed | Both disabled | "Action confirmed — executing..." |
| User not authorized | Both disabled | "You are no longer authorized" |
| Another user clicked | Ignore click | Ephemeral "This confirmation is not for you" |

## Sources

- [Write Architecture](rw-architecture.md)
- [Adapter Contract](rw-adapter-contract.md)
- [Write Safety Primitives](../src/writes.js)
- [Discord Message Components](https://discordjs.guide/message-components/)
