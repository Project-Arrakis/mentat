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
git -C ../dune-awakening-selfhost-docker-upstream-main reset --hard origin/main
```

Only use this clean clone for compatibility review. Do not make feature changes
in it.

Current evidence for this roadmap slice was checked against upstream
`Red-Blink/dune-awakening-selfhost-docker@1bb72c5` and latest tag `v1.3.37` on
June 28, 2026.

## Forks and Workstreams

Forks are useful for contribution work, but they are not authoritative here
unless the relevant behavior has landed upstream or has been explicitly accepted
as the compatibility target.

When reviewing WebUI changes for bot impact, record:

- upstream commit SHA or tag
- adapter route names and methods
- response shape or fixture used
- whether the behavior is released, on upstream `main`, or proposed in a PR
