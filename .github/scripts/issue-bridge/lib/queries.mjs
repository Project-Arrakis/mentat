// ACP Issue Bridge — GitHub search query construction (kept separate and
// pure so the exact query string is unit-testable without a network call).

/** Search query to find existing private mirrors correlated to a Sync ID. */
export function syncIdSearchQuery(repoSlug, syncId) {
  return `repo:${repoSlug} "sync_id: ${syncId}" in:body,comments is:issue`;
}
