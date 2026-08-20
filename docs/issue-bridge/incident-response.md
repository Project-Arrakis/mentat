# ACP Issue Bridge — Incident Response

**Treat any accidental private-to-public disclosure as a security
incident** (spec section 70/81), regardless of how minor the disclosed
content seems. This procedure applies whether the disclosure came through
a bridge defect, a scanner miss, or human error (e.g. someone manually
copy-pasting private content into a public comment outside the bridge
entirely).

## Immediate response (first 15 minutes)

1. **Stop outbound synchronization immediately.** Run `/sync-pause` on
   the affected issue if the bridge is still functioning normally, or
   disable the relevant workflow(s) in the repository's Actions settings
   if the bridge itself appears to be misbehaving.
2. **Apply `/security`** on the affected private issue if it wasn't
   already security-sensitive — this also pauses sync as a side effect,
   but do step 1 first regardless, since `/security` itself depends on
   the bridge still working correctly.
3. **Rotate any exposed secret immediately**, independent of the rest of
   this procedure. If a Discord bot token, adapter token, GitHub App
   private key, or any other credential appears in the disclosed content,
   assume it is compromised the moment it was public, however briefly.

## Containment (first hour)

4. **Remove or redact the public content where possible.** GitHub
   supports editing/deleting a comment and, for more serious cases,
   requesting content removal via support — but editing/deleting does
   not undo the fact that it was public; treat the secret as compromised
   regardless of whether removal succeeds.
5. **Preserve audit evidence before doing anything destructive.** Export
   the relevant workflow run's logs (Actions UI → the specific run → 
   "..." → Download log archive) before editing/deleting anything, so the
   root-cause investigation has real evidence rather than a
   reconstruction from memory.
6. **Determine the full blast radius**: which issue(s), which
   comment(s), what content, who could have seen it (public repo = 
   anyone, indefinitely, including via GitHub's search index and any
   third-party scraper/mirror).

## Root cause analysis

7. Identify exactly which control failed: was a command run by an
   unauthorized/wrong-tier actor (should have been blocked by
   `auth.mjs`)? Did the secret scanner miss a pattern (gap in
   `secretScan.mjs`)? Was this a human bypassing the bridge entirely
   (pasted directly into a public comment, not via `/public`)? The
   remediation differs completely depending on which.
8. Reproduce the gap with a unit test **before** fixing it, so the fix is
   verifiably tied to the actual defect (matches this account's Req 8
   discipline — a fix without a reproducing test that fails first, then
   passes after, is not verified).

## Remediation

9. Fix the identified control gap (scanner pattern, permission check,
   whatever the root cause pointed to).
10. Add a regression test for the exact scenario, named/commented so a
    future reader can find why it exists (e.g. reference this incident).
11. Deploy the fix, then re-verify the specific scenario is now blocked.

## Recovery

12. Only after the fix is deployed and verified: consider
    `/security-clear` (admin) and a separate `/sync-resume` on the
    affected issue, per the normal two-step recovery — do not shortcut
    this even for an issue you just personally fixed.

## Closure

13. Document the incident: what was disclosed, root cause, fix, and
    regression test, in this account's existing incident-tracking
    convention (`compliance/evidence/incidents/` in this repository,
    matching the existing `2026-07-26-service-disruption.md` precedent)
    — do not let this live only in a chat transcript or a closed issue
    comment.
14. If the disclosure involved the public repository's search
    index/caching, note that GitHub's own content may be cached by
    external services (search engines, archive.org, etc.) indefinitely —
    rotation of the actual credential is the only real mitigation for
    that exposure, not content removal.

## What this procedure explicitly does NOT allow

- Do not re-enable synchronization "temporarily to test the fix" against
  a real, non-throwaway issue — use the safe live smoke test procedure in
  `testing.md` instead.
- Do not skip the regression test step because the fix "obviously" works
  — this is exactly the discipline this account's Requirement 8 exists
  to enforce, and it applies especially under incident-response pressure.
