# Upstream Source of Truth

## Executive Summary

The canonical upstream for WebUI behavior, adapter routes, and integration
expectations is:

https://github.com/Red-Blink/dune-awakening-selfhost-docker

Do not use personal forks, local workstreams, or experimental branches as the
source of truth for this bot project.

## Why This Matters

This Discord bot is an external companion to the upstream WebUI. Its defaults,
documentation, and compatibility tests should track released or mainline
behavior from the upstream project, not behavior from another workstream that
may contain local experiments or unmerged changes.

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

## Forks and Workstreams

Forks are useful for contribution work, but they are not authoritative for this
bot unless the relevant change has landed upstream or has been explicitly
accepted as the target compatibility baseline.

When reviewing WebUI changes for bot impact, record:

- upstream commit SHA or tag
- adapter route names and methods
- response shape or fixture used
- whether the behavior is released, on upstream `main`, or proposed in a PR
