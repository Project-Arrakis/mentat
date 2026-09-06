# Upstream Source of Truth

## Canonical Upstream

The canonical upstream for WebUI behavior, adapter routes, and integration
expectations is:

https://github.com/Red-Blink/dune-awakening-selfhost-docker

Do not use personal forks, local workstreams, or experimental branches as the
compatibility baseline for this bot.

## Why This Matters

The bot is an external companion to the upstream WebUI. Defaults, docs, and
compatibility tests should track released or mainline upstream behavior, not
local experiments or unmerged fork changes.

## Recommended Local Reference Clone

Maintain a clean clone of upstream `main` outside this repository:

```bash
git clone https://github.com/Red-Blink/dune-awakening-selfhost-docker.git ../dune-awakening-selfhost-docker-upstream-main
```

Refresh it with:

```bash
git -C ../dune-awakening-selfhost-docker-upstream-main fetch --prune origin
git -C ../dune-awakening-selfhost-docker-upstream-main switch main
git -C ../dune-awakening-selfhost-docker-upstream-main pull --ff-only
```

Only use this clean clone for compatibility review. Do not make feature changes
in it.

Current evidence for this roadmap slice was checked against upstream
`Red-Blink/dune-awakening-selfhost-docker@b53765c2070c12d7ebb4adc8103f26c42745fa7c`
(latest published release tag `v1.4.8`) on September 6, 2026. Route-by-route
provenance for the bot's adapter client was re-verified directly against this
current baseline (see `docs/adapter-contract.md`'s 2026-09-06 entry for the
full diff-based re-verification: no route-classification changes found across
~1,139 commits of upstream drift since the prior, 2026-08-16 baseline). The
2026-08-16 evidence itself corrected two real drift issues the original
2026-08-06 evidence had missed -- see `arrakis-control-panel#172` for that
full audit, and the full-set pin in `test/adapterClient.test.js`.
`docs/ro-roadmap-state-2026-08-06.md` is the original evidence snapshot; it
carries explicit correction notices at its top (both 2026-08-16 and
2026-09-06) rather than being rewritten, per this document's own
no-silent-rewrite practice.

The standalone local reference clone used for this review followed the
recommended sibling path:

```text
../dune-awakening-selfhost-docker-upstream-main
```

No upstream release-candidate tag newer than `v1.4.8` was observed during this
review. Older release-candidate tags remain historical evidence, but the stable
compatibility baseline is the latest published release.

## Forks and Workstreams

Forks are useful for contribution work, but they are not authoritative here
unless the relevant behavior has landed upstream or has been explicitly accepted
as the compatibility target.

When reviewing WebUI changes for bot impact, record:

- upstream commit SHA or tag
- adapter route names and methods
- response shape or fixture used
- whether the behavior is released, on upstream `main`, or proposed in a PR
