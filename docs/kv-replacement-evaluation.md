# KV Replacement Evaluation: Free/Open-Source Alternatives to Cloudflare KV for Stats Storage

> **2026-08-07 note, corrected 2026-08-13:** this evaluation was written
> anticipating a bot migration from OCI to the Dell R740 that was, at the
> time, expected to happen imminently. **That migration has not
> happened** — the bot remains on its original OCI host as of this
> writing. References to the "OCI host" below reflect the actual current
> infrastructure, not a historical one. The evaluation's analysis of
> alternatives remains valid regardless of hosting location.

**Tracking issue:** #94 ("Investigate Cassandra (or other DB) as a future
alternative to Cloudflare KV for stats storage") -- opened 2026-07-27,
deliberately parked; this document is the first real research on the
topic, produced when the trigger was explicitly pulled (2026-08-07).

**Status: research only. No decision to migrate, no code changes, no
impact on the live stats pipeline.** The current Cloudflare KV setup
remains the production path for `acp-stats-aggregate` today.

## 1. The actual workload (verified, not assumed)

All numbers below were confirmed by reading the code, not by memory:

- **Writer:** `src/statsPusher.js` on the OCI bot host.
  `PUSH_INTERVAL_MS` default `300000` (5 minutes) -> ~288 writes/day.
  Single key: `acp-stats-aggregate`, TTL 3600s
  (`ACP_STATS_KV_TTL_SECONDS`). Payload is a flat JSON blob:
  live Core ops snapshots (players_online, spice_fields via the
  Discord-adapter ops.* actions) plus the bot's own counters
  (guilds_total/guilds_active/commands_total/version/updated_at).
- **Reader:** `acp-landing`'s `functions/api/stats.js` does exactly one
  `env.ACP_STATS.get("acp-stats-aggregate")` per page-view of the
  "Live Stats" widget. No queries, no indexes, no history, no
  per-guild breakdowns, no secondary access patterns.
- **Data volume:** one small JSON document, replaced in place every 5
  minutes, self-expiring. This is a cache of a live snapshot, not a
  database of record.

Cloudflare KV free tier (100k reads/day, 1k writes/day, 1 GB) covers
this by roughly 3 orders of magnitude. There is no capacity or cost
problem today. The research question is purely about
vendor-independence and future fit -- exactly what #94 framed.

## 2. Evaluation criteria

Derived from #94's own framing plus this project's constraints
(single-maintainer, evidence-first, Strict Requirement 0 blast-radius
thinking for anything that touches the live bot):

1. **Free and genuinely open source** (OSI-approved license). Per the
   user's explicit request, "free tier of a proprietary service" does
   not qualify -- the point is to be able to run it ourselves.
2. **Fit for a single-key, TTL'd, read-on-pageview workload.** A
   system designed for multi-TB multi-node scale is a liability here,
   not a benefit: more services to run, monitor, back up, and
   compromise for a workload that fits in one 4 KB JSON file.
3. **Operational burden for a single maintainer.** The current setup
   is zero-ops (Cloudflare side). Any self-hosted replacement moves
   work onto this account's OCI host.
4. **Reader reachability.** The reader is a Cloudflare Pages Function.
   Whatever replaces KV must be reachable from it over public HTTPS --
   either because the store itself is public-facing, or (more
   realistically) because the bot host already exposes an HTTPS path
   to the reader (existing Cloudflare Tunnel / setup portal).

## 3. Candidate matrix

| Candidate | License | Maintained? | Footprint | Fit for this workload | Verdict |
|---|---|---|---|---|---|
| Cloudflare KV (incumbent) | Proprietary (free tier) | Yes | Zero-ops | Exact fit | Keep (today) |
| Valkey | BSD-3 (Linux Foundation) | Yes (active, v9.x era, backed by AWS/Google/Oracle/Snap) | Single `valkey-server` binary + RAM | Overkill but workable; RESP + TTL natively | Honorable mention |
| Redis | AGPLv3 (post-2024 license history: RSALv2/SSPLv1 2024, AGPLv3 2025) | Yes | Same as Valkey | Same as Valkey; license now copyleft | Prefer Valkey over Redis |
| KeyDB | BSD-3 | No -- effectively stalled (last releases based on Redis 6, ~2023-2024) | Same as Valkey | Fine, but dead | Reject (stale) |
| Cassandra | Apache-2.0 | Yes | JVM, designed for multi-node clusters | Severe overkill; needs a cluster to make sense; repair/compaction ops | Reject for this workload |
| ScyllaDB | C++ CQL-compatible; OSS releases AGPL, newer releases source-available/commercial | Yes | C++ but still cluster-oriented | Same overkill as Cassandra | Reject for this workload |
| NATS JetStream KV | Apache-2.0 | Yes (CNCF) | Single ~20 MB `nats-server` binary | KV is a stream-as-map: CAS, per-key TTL, history -- closest semantic match among self-hosted options | Honorable mention |
| D1 | Proprietary (Cloudflare) | Yes | Zero-ops | Would work, but it is *still Cloudflare* | Reject for purpose (fails criterion 1) |
| **Serve from the bot's own SQLite** | Public domain / permissive (better-sqlite3 already a production dep) | Yes (in-repo) | **Zero new infrastructure** | Perfect fit -- data already lives here | **Recommended fallback** |

## 4. The key finding: the data already lives in the bot's SQLite

`src/database.js` already maintains `bot_stats` (incl. `commands_total`,
incremented per command) and `guilds` (status-filtered for
`guilds_active`, `updated_at` for freshness) via `better-sqlite3`
(already a production dependency, `^12.11.1`). The parts of the
aggregate payload that come from the bot itself
(guilds_total/guilds_active/commands_total/version/updated_at) are
already a read away from the local database. Only the live Core ops
snapshots (players_online, spice_fields) are fetched fresh per push --
and the push job already runs on the host that would serve them.

So a KV replacement does not actually need a database at all. It needs:

1. A read-only endpoint on the bot host that returns the current
   aggregate (the push job's payload builder already produces it), and
2. The existing Cloudflare Tunnel / setup-portal route already
   forwarding `mentat-backend.darkdante.org` (port 3100, internal-only
   as of the 2026-09-06 domain consolidation) to that host -- which
   already exists for the setup portal, i.e. the public HTTPS path to
   the reader is already in place (reached via `mentat-link.darkdante.org`'s
   own reverse-proxy Pages Function).

The acp-landing Pages Function's reader then changes from
`env.ACP_STATS.get(...)` to a fetch of that endpoint (same JSON
contract in `acp-landing/docs/kv-stats-schema.md`, so the widget is
unchanged). No new store, no new service, no new credential -- the
"replacement" is a route on an already-deployed, already-publicly-
reachable process.

## 5. When the answer really is a standalone store

If stats ever grows into what #94 describes (per-guild breakdowns,
history/time-series, real queries), the correct move is a real
queryable database, not a KV -- at which point the candidates rank:

1. **Postgres on the OCI host** (this workstream already runs one in
   Core; the addon/ACP conventions and backup tooling exist) --
   real queries, TTL via table cleanup or a cron, single-maintainer
   scale.
2. **NATS JetStream KV** -- if staying KV-shaped is genuinely wanted
   (TTL/CAS semantics, no SQL); single binary, Apache-2.0.
3. **Valkey** -- if Redis-protocol compatibility matters (existing
   tooling, clients); BSD-3, active. Prefer over Redis itself
   (AGPLv3 copyleft) and over KeyDB (stalled).

Cassandra/ScyllaDB remain rejected at any size this project is likely
to reach: their operational model (cluster, repair, compaction,
JVM/C++ footprint) is built for a scale and a team this project does
not have, and ScyllaDB's newer releases are no longer OSS anyway.

## 6. Recommendation

- **Do nothing now.** Cloudflare KV free tier fits the current
  single-key workload by ~1000x; it is zero-ops and the reader
  integration is already shipped. Migration is not justified by any
  current cost, capacity, or reliability problem. (This matches #94's
  original framing: no decision that KV is inadequate today.)
- **If vendor-independence becomes a hard requirement**, the
  lowest-risk path is #94's "replacement" done with zero new
  infrastructure: a read-only stats route on the bot's existing HTTP
  server, served from data the bot already holds, behind the existing
  tunnel, with the reader changed to fetch it. Estimated work: one
  small endpoint + reader change + the documented contract already in
  `acp-landing/docs/kv-stats-schema.md`.
- **Only if the data shape grows** (per #94's own trigger) should a
  real queryable store be introduced, and then Postgres (existing
  operational familiarity in this workstream) first.

## 7. Verification log

- 2026-08-07: read `src/statsPusher.js` (interval default 300000 ms,
  TTL 3600 s, single `acp-stats-aggregate` key, payload source
  comments) and `acp-landing/functions/api/stats.js` (single key
  `get`) -- workload numbers above.
- 2026-08-07: read `src/database.js` schema (bot_stats /
  commands_total, guilds status/updated_at) and `package.json`
  (`better-sqlite3 ^12.11.1` already a production dep) -- the
  "data already local" finding.
- 2026-08-07: web research on current (2026) licensing/maintenance
  status of Valkey (BSD-3, Linux Foundation, active), Redis (AGPLv3
  after 2024-2025 license moves), KeyDB (BSD-3, stalled), Cassandra
  (Apache-2.0), ScyllaDB (OSS releases AGPL, newer source-available),
  NATS JetStream (Apache-2.0), D1 (proprietary).
