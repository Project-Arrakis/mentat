// ACP Issue Bridge — mention suppression (spec section 34/35).
//
// Transforms active @mentions into a visually-identical, non-notifying
// form by inserting a zero-width space (U+200B) immediately after the `@`.
// GitHub only turns `@name` into a notifying link when the `@` is
// immediately followed by the name with no intervening characters, so this
// reliably breaks the notification while remaining invisible to a reader
// and, unlike stripping the `@` entirely, keeps the original text legible
// and diffable.
//
// Skips fenced/inline code so copyable command examples and stack traces
// are never corrupted by an invisible character (section 33).

import { transformTextSegments } from "./markdownSegments.mjs";

const ZERO_WIDTH_SPACE = "\u200B";

// @name or @org/team-slug. GitHub logins: alnum + hyphen, no leading/
// trailing hyphen, <=39 chars. Team slugs: alnum, ., _, -.
const MENTION_PATTERN = /(^|[^\w`])@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))((?:\/[A-Za-z0-9._-]{1,100})?)/g;

/** Replace every active @mention in `text` with a non-notifying equivalent. */
export function suppressMentions(text) {
  if (typeof text !== "string" || text.length === 0) return text || "";
  return transformTextSegments(text, (segment) =>
    segment.replace(MENTION_PATTERN, (_, pre, name, teamSuffix) => `${pre}@${ZERO_WIDTH_SPACE}${name}${teamSuffix}`)
  );
}

/** True if `text` contains at least one mention that would be suppressed. */
export function containsMention(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  MENTION_PATTERN.lastIndex = 0;
  return MENTION_PATTERN.test(text);
}
