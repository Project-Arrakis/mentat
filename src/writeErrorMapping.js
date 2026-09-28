// Maps every real error code Core's write/preview and write/execute can
// return (docs/design/write-command-reconciliation-l1-design-2026-09-22.md
// section 3, all 12 codes) to a specific Discord message -- never a
// generic "something went wrong" for a code this bot actually knows about.
import { duneEmbed } from "./embedFormat.js";

const MESSAGES = {
  writes_disabled: "Write commands are disabled on this console.",
  not_authorized: "You don't have permission for this action.",
  unknown_write_action: "This command isn't available on the connected Core instance yet.",
  invalid_parameters: null, // uses the real error string from Core
  nonce_not_found: "This confirmation expired. Please run the command again.",
  nonce_actor_mismatch: "This confirmation wasn't issued to you.",
  nonce_action_mismatch: "Internal error: the action does not match what was previewed. Please run the command again.",
  // [Audit fix: QA round 3 sweep] This code was tested (writeErrorMapping.
  // test.js) but had no MESSAGES entry -- the test only passed because the
  // fallback branch happened to echo Core's own mock message text back,
  // which coincidentally matched the test's /second/i pattern. A REAL
  // Core response's exact wording isn't guaranteed to match that pattern.
  second_confirmation_required: "Your confirmation was accepted. A second, different owner-tier admin must click Confirm on this same message to complete it.",
  second_confirmation_same_actor: "A different administrator must provide the second confirmation.",
  stale_actor_signature: "Your role info expired. Please run the command again.",
  invalid_actor_signature: "Your role info could not be verified. Please run the command again.",
  write_backend_unavailable: "The write backend is temporarily unavailable. Try again shortly."
};

export function mapWriteError(error) {
  const code = error?.body?.code;
  const coreMessage = error?.body?.error;
  if (code && Object.hasOwn(MESSAGES, code)) {
    const description = MESSAGES[code] || coreMessage || "Request failed.";
    return { title: "Write Command Failed", description };
  }
  // [Audit fix: Security, HIGH] Every reply carrying this fallback (raw
  // Core error text) is ephemeral by design (Task 5) EXCEPT server.stop,
  // which never reaches this branch (every state it can produce has a
  // named code above) -- see the design doc's Sanitization note for why
  // this is an accepted disclosure boundary, not an oversight.
  return { title: "Write Command Failed", description: coreMessage || error?.message || "An unexpected error occurred." };
}

export function buildWriteErrorEmbed(error) {
  const { title, description } = mapWriteError(error);
  return duneEmbed({ title: `🛑 ${title}`, color: "error", description });
}
