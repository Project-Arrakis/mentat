// Write Command Handler — validates, confirms, audits write operations.
// The 9 legacy group="write" stub subcommands (LEGACY_WRITE_STUBS below)
// keep their existing scaffolded, "awaiting upstream contract" behavior
// unchanged. Every other write command (WRITE_ACTIONS, see writeActions.js)
// now dispatches for real: it calls Core's write/preview route, and the
// confirm-button flow (writeConfirmation.js / Task 5) calls write/execute.

import { randomUUID } from "node:crypto";
import { writesEnabled, canWrite, requireConfirmation, generateIdempotencyKey, writeAuditEvent } from "./writes.js";
import { findWriteAction, WRITE_ACTIONS } from "./writeActions.js";
import { mapWriteError } from "./writeErrorMapping.js";
import { buildConfirmationEmbed, buildConfirmationRow, registerRealPendingConfirmation, confirmationTimeoutMs, pendingConfirmationCount, createPendingConfirmation, writeTimeoutAuditEvent } from "./writeConfirmation.js";
import { actorFromInteraction } from "./rbac.js";

export { WRITE_ACTIONS };

// [Audit fix: Security, MEDIUM round 3] The 9 remaining WRITE_COMMANDS
// entries with no real backing feature anywhere (design doc section 2) --
// copied verbatim from the real, current src/writeHandler.js, MINUS the 3
// entries superseded by a real new command elsewhere ("backup", "restart",
// "update" -- see Task 7 Step 3, which removes exactly these 3 from the
// real commands.js "write" group builder). These keep returning the exact
// same "scaffolded, awaiting upstream contract" response they always have
// -- this design does not touch their behavior at all, only where the
// code that produces it lives.
export const LEGACY_WRITE_STUBS = Object.freeze([
  { group: "write", name: "maintenance-note", action: "maintenance:set-note", risk: "low", tier: "admin",
    desc: "Set a maintenance note for operators.", params: [{ name: "note", type: "string", desc: "Maintenance note text", required: true, maxLength: 500 }] },
  { group: "write", name: "maintenance-window", action: "maintenance:set-window", risk: "low", tier: "admin",
    desc: "Set a maintenance window.", params: [
      { name: "start", type: "string", desc: "Start time (ISO 8601)", required: true },
      { name: "duration", type: "integer", desc: "Duration in minutes", required: true, min: 1, max: 1440 }] },
  { group: "write", name: "alert-channel", action: "notifications:set-alert-channel", risk: "low", tier: "admin",
    desc: "Set the alert channel for readiness/service notifications.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "alert-threshold", action: "notifications:set-threshold", risk: "medium", tier: "admin",
    desc: "Set alert thresholds.", params: [
      { name: "metric", type: "string", desc: "Metric (readiness/services/population)", required: true },
      { name: "condition", type: "string", desc: "Condition (lt/gt/eq)", required: true },
      { name: "value", type: "integer", desc: "Threshold value", required: true }] },
  { group: "write", name: "digest-schedule", action: "notifications:set-digest-schedule", risk: "low", tier: "admin",
    desc: "Set the digest schedule interval.", params: [{ name: "minutes", type: "integer", desc: "Interval in minutes", required: true, min: 5, max: 1440 }] },
  { group: "write", name: "post-schedule", action: "schedule:set-post-schedule", risk: "low", tier: "admin",
    desc: "Set the scheduled post type.", params: [{ name: "type", type: "string", desc: "status/status-summary/readiness/services/none", required: true }] },
  { group: "write", name: "add-channel", action: "schedule:add-channel", risk: "medium", tier: "admin",
    desc: "Add a channel for scheduled posts.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "remove-channel", action: "schedule:remove-channel", risk: "medium", tier: "admin",
    desc: "Remove a channel from scheduled posts.", params: [{ name: "channel", type: "string", desc: "Discord channel ID", required: true }] },
  { group: "write", name: "cache", action: "operations:clear-cache", risk: "medium", tier: "owner",
    desc: "Clear server caches.", params: [{ name: "type", type: "string", desc: "Cache type (steam/maps/derived)", required: true }] }
]);

function findLegacyWriteStub(group, subcommand) {
  if (group !== "write") return null;
  return LEGACY_WRITE_STUBS.find((c) => c.name === subcommand) || null;
}

function collectParams(def, interaction) {
  const params = {};
  for (const p of def.params) {
    if (p.type === "integer") params[p.name] = interaction.options.getInteger(p.name);
    else if (p.type === "number") params[p.name] = interaction.options.getNumber(p.name);
    else params[p.name] = interaction.options.getString(p.name);
  }
  return params;
}

export async function handleWriteCommand({ group, subcommand, interaction, adapterClient, config, guildId = null, db = null }) {
  if (!writesEnabled(config)) {
    return { ok: false, error: "Write commands are disabled. Set DUNE_DISCORD_WRITES_ENABLED=true.", disabled: true };
  }

  // Legacy stub path, checked BEFORE findWriteAction: the 9 remaining
  // maintenance/notifications/schedule/clear-cache entries are group
  // "write" specifically, which findWriteAction (Task 3's real-action
  // table) never resolves -- WRITE_ACTIONS has no "write"-group entries at
  // all. Preserves the exact pre-existing behavior (createPendingConfirmation,
  // no kind field -- distinguishing it from registerRealPendingConfirmation's
  // "real"/"self-update" entries in Task 5's confirm-button dispatch).
  const legacyDef = findLegacyWriteStub(group, subcommand);
  if (legacyDef) {
    if (!canWrite(interaction, config, legacyDef.tier, db, guildId)) {
      const requiresOwner = legacyDef.tier === "owner";
      return {
        ok: false,
        error: requiresOwner
          ? "Not authorized for write operations. This action requires owner-tier access, which belongs only to this Discord server's real owner."
          : "Not authorized for write operations. Requires admin-tier access (a mapped Admin role, or the real Discord server owner)."
      };
    }
    const idempotencyKey = generateIdempotencyKey();
    const confirmation = requireConfirmation({ action: legacyDef.action, target: legacyDef.tier, risk: legacyDef.risk });
    const { embed, row } = createPendingConfirmation({
      idempotencyKey,
      action: legacyDef.action,
      tier: legacyDef.tier,
      risk: legacyDef.risk,
      userId: interaction?.user?.id,
      onTimeout: (entry) => console.log(JSON.stringify(writeTimeoutAuditEvent(entry, idempotencyKey)))
    });
    return {
      ok: true,
      action: legacyDef.action,
      tier: legacyDef.tier,
      risk: legacyDef.risk,
      idempotencyKey,
      needsConfirmation: true,
      confirmationMessage: confirmation.message,
      confirmationEmbed: embed,
      confirmationRow: row,
      status: "pending-upstream",
      message: "Write command scaffolded. Awaiting upstream write-adapter contract implementation."
    };
  }

  const def = findWriteAction(group, subcommand);
  if (!def) return { ok: false, error: `Unknown write command: ${group} ${subcommand}` };

  // bot.self-update: a dedicated host-operator identity check, NEVER
  // canWrite()'s per-guild tier system. [Audit fix: Security, CRITICAL]
  // mentat is multi-tenant -- "owner" tier is scoped per-guild, but
  // self-update restarts the ONE shared bot process serving every tenant.
  // def.tier is the sentinel "host-operator", which canWrite() can never
  // grant, so this action is authorized ONLY by this exact check.
  if (def.action === "bot.self-update") {
    const operatorId = config?.discord?.botOperatorUserId;
    if (!operatorId || interaction.user?.id !== operatorId) {
      return { ok: false, error: "Not authorized. This action is restricted to the configured bot host operator." };
    }
    // No typed confirmation phrase: the host-operator identity check above
    // already narrows this to exactly one person, and the confirm-button
    // click (Task 5) already requires a second, deliberate action -- a
    // typed phrase would need a Discord modal (a different interaction
    // type than every other command's button flow) for marginal benefit
    // given the identity check already does the real narrowing. Simplified
    // out during this plan's own self-review rather than half-implemented.
    console.log(JSON.stringify(writeAuditEvent({ actor: actorFromInteraction(interaction), action: def.action, capability: def.action, idempotencyKey: "n/a", result: "triggered" })));
    const key = randomUUID();
    const expiresAt = Date.now() + confirmationTimeoutMs();
    const pendingCount = pendingConfirmationCount();
    registerRealPendingConfirmation({ nonce: key, action: def.action, tier: def.tier, userId: interaction.user.id, expiresAt, confirmPhrase: def.confirmPhrase, kind: "self-update" });
    return {
      ok: true, needsConfirmation: true, action: def.action, tier: def.tier, isSelfUpdate: true,
      confirmationEmbed: buildConfirmationEmbed({
        action: def.action, tier: def.tier, risk: "high", expiresAt, confirmPhrase: def.confirmPhrase,
        extraWarning: pendingCount > 0 ? `${pendingCount} other pending confirmation(s) will be lost.` : null
      }),
      confirmationRow: buildConfirmationRow(key)
    };
  }

  if (!canWrite(interaction, config, def.tier, db, guildId)) {
    const requiresOwner = def.tier === "owner";
    return {
      ok: false,
      error: requiresOwner
        ? "Not authorized for write operations. This action requires owner-tier access, which belongs only to this Discord server's real owner."
        : "Not authorized for write operations. Requires admin-tier access (a mapped Admin role, or the real Discord server owner)."
    };
  }

  const params = collectParams(def, interaction);
  const action = def.resolveAction ? def.resolveAction(params) : def.action;
  // [Audit fix: Security, CRITICAL round 2] actorFromInteraction (rbac.js,
  // moved there in Step 7a) builds the COMPLETE actor payload -- userId,
  // username, guildId, channelId, roleIds, guildOwnerId -- that Core's
  // actorSignature.js HMAC verification needs. A hand-built partial actor
  // (just userId/username/guildOwnerId) was this plan's own bug through
  // Revision 2: every write/preview and write/execute call would have sent
  // Core an incomplete actor, not just the dual-confirmation path.
  const actor = actorFromInteraction(interaction);

  let preview;
  try {
    preview = await adapterClient.writePreview(actor, { action, params }, guildId);
  } catch (error) {
    const { description } = mapWriteError(error);
    console.log(JSON.stringify(writeAuditEvent({ actor, action, capability: action, idempotencyKey: "n/a", result: "preview-rejected", detail: { error: description } })));
    return { ok: false, error: description };
  }

  const nonce = preview.nonce;
  const expiresAt = preview.expiresAt;
  registerRealPendingConfirmation({ nonce, action, tier: def.tier, userId: interaction.user.id, expiresAt, confirmPhrase: preview.preview?.confirmPhrase, kind: "real" });
  console.log(JSON.stringify(writeAuditEvent({ actor, action, capability: action, idempotencyKey: nonce, result: "preview-ok" })));

  return {
    ok: true,
    needsConfirmation: true,
    action,
    tier: def.tier,
    nonce,
    expiresAt,
    confirmationEmbed: buildConfirmationEmbed({ action, tier: def.tier, risk: def.tier === "owner" ? "high" : "medium", expiresAt, confirmPhrase: preview.preview?.confirmPhrase }),
    confirmationRow: buildConfirmationRow(nonce)
  };
}
