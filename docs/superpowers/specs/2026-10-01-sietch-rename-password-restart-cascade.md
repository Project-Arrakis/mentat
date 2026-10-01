# Sietch rename and password change: the full restart cascade (verified on dune-dev)

**Date:** 2026-10-01. **Status:** evidence document, not a design. **Method:** static reading of
Core's runtime scripts plus three controlled runs on dune-dev (rename, password set, restore).
**Scope tested:** Survival_1 partition 1 only. Everything about other partitions below is **code
reading, not tested**, and is marked as such.

## Why this exists

The operator asked what a Sietch rename or password change does when done from the console, so
that a Discord version of it can warn correctly and be given the right tier. The operator's
expectation was "a Sietch restart". The measured behavior is larger.

## Result in one paragraph

Renaming a Survival_1 Sietch, or setting or clearing its password, does **not** restart one
Sietch. It runs a four-step cascade that restarts, in order: the Survival_1 server, the Director,
the Survival_1 server **a second time**, and the Gateway. The Deep Desert and the Overmap are not
restarted. All three runs showed the identical sequence, about 76 seconds from the first kill to
the Gateway start and about 93 seconds until the command returned.

## Measured timeline (UTC, dune-dev, 0 players connected)

Container start times before the test were all 12:00 to 12:03 with 0 restarts (baseline).
Times are `docker events` kill/die/start. Offsets are from the command start.

**Run B: set the password (complete log)**

| Time | Offset | Event | Meaning |
|---|---|---|---|
| 23:08:58 | 0s | command begins | `sietches.sh set-password` |
| 23:09:02 | +4s | Survival_1 kill, die, start | step 1: restart so the new setting is published |
| 23:09:33 | +35s | Director kill, die, start | step 2: Director restart |
| 23:09:48 | +50s | Survival_1 kill, die, start | step 3: second Survival_1 restart (re-register with the new Director) |
| 23:10:18 | +80s | Gateway kill, die, start | step 4: Gateway restart |
| 23:10:31 | +93s | command returns | "Password updated." |

**Run A (rename)** showed the same four containers in the same order (Survival_1 start 23:07:06,
Director 23:07:37, Survival_1 23:07:52 to 23:07:53, Gateway 23:08:22 to 23:08:23). The first
kill line of run A was cut off in my capture, so its first row is a start, not a kill.
**Run C1/C2 (restore name, restore password)** repeated the cascade twice more (C2: Survival_1
23:13:42, Director 23:14:13, Survival_1 23:14:28, Gateway 23:14:58); the first lines of C1 were also
cut off by my capture. Four runs, one pattern.

After run B: `dune-server-survival-1` started 23:09:49, `dune-director` 23:09:34, `dune-server-gateway`
23:10:19. `dune-server-deepdesert-1-8` (12:03:17) and `dune-server-overmap` (12:01:42) were
**unchanged**.

## Why it happens (code, `runtime/scripts` in Core)

1. `sietches.sh set-display | set-password | set-settings` writes the instance ini through
   `usersettings.py partition-engine-set` (`server_display_name`, `server_login_password`) and
   runs `materialize-current`.
2. For a Survival_1 partition it then calls `restart_sietch_partition_if_running`. For partition 1
   that is `restart_survival_server_if_running`, which prints "Restarting Survival_1 so sietch
   display/password changes are published by the running server..." and runs
   `start-server-survival-1.sh`. **This is cascade step 1.**
3. It then calls `refresh_survival_sietch_metadata_state` (`sietches.sh:~1357-1363`), which runs
   `refresh_survival_director_state` and `refresh_survival_gateway_state`.
4. `refresh_survival_director_state` prints "Refreshing Director and primary Survival_1 for the
   updated Sietch topology..." and runs `restart-director.sh`. That script starts the Director
   (**step 2**) and, if Survival_1 was running, restarts Survival_1 again "so it registers with the
   new Director" (**step 3**), then re-applies spicefield overrides and restarts and re-runs the
   sietch override publisher.
5. `refresh_survival_gateway_state` runs `start-server-gateway.sh` (**step 4**).

`DUNE_SKIP_SURVIVAL_DIRECTOR_REFRESH=1` skips the Director refresh (steps 2 and 3) per
`sietches.sh:1334`; there is no equivalent switch for the Gateway refresh (step 4). I did not test the flag.

**Corroboration inside Core:** `deepdesert.sh:~116-124` deliberately avoids `restart-director.sh`
for Deep Desert changes, with the comment that its general recovery path "also restarts Survival_1,
which would disconnect every Hagga Basin player".

## What this means for players

- Players on the Survival_1 server are disconnected **twice**, about 45 seconds apart.
- The Gateway restart at about +80s affects new logins and connections during that window.
- The Director restart is a control-plane restart. Whether the Deep Desert and the Overmap
  re-register cleanly after a Director restart was **not checked** (they stayed up, 0 players).
- The console's own warning does not describe this: the "Restart Required / Save And Restart"
  dialog in `MapsPanel.tsx:~1722` is behind `const willRestart = false;`, so a Sietch save only asks
  "Save settings for <name>?".

## Second test series: adding and removing a Sietch, renaming the secondary (tested)

Same day, same dune-dev, 0 players, backup first. dune-dev has 25.5 GB total memory and 8 GB swap
(swappiness 10). To fit a second Sietch the Deep Desert had to be stopped first. Memory and
container events were sampled every 10 seconds and by `docker events` for the whole series.

### Setup finding: the Deep Desert is held up by the autoscaler

`dune despawn 8` refused: "Refusing to despawn Always On map: DeepDesert_1 ... The autoscaler will
respawn Always On maps." The operator's guidance, confirmed: set the map to **dynamic** and it will
not be restarted until someone enters it (`dune maps set DeepDesert_1 dynamic`, the original mode
was `always-on`). The mode change itself restarted nothing ("Map remains running if already
active"); the Deep Desert was then despawned normally. Memory available rose from about 4.0 GB to
13.2 GB.

### Result 1: increasing the active Sietches 1 to 2 does NOT restart Survival_1

Sequence copied from the console UI (`set-max Survival_1 2`, then `set-active Survival_1 2`).

| Time (UTC) | Event |
|---|---|
| 23:25:21 | `set-max` |
| 23:25:24 | `set-active 2` |
| 23:25:32 | **start `dune-server-survival-1-36`** (new Sietch, partition 36, dimension 1) |

That is the **only** container event. The primary Survival_1, the Director, the Gateway and the
Overmap did not restart. This contradicts the operator's recollection that changing the count
restarts Survival_1, **for this case (count 1 to 2, nothing connected, Deep Desert stopped)**. It
agrees with the code comment in `reconcile_map_dimensions` ("must not replace" the Director or
primary Survival_1). A larger change, or a count change while another map holds the newly reserved
ports (`relocate_survival_port_conflicts`), was not tested.

Memory: the new Sietch settled at **9.26 GiB** (primary 9.57 GiB). Available memory fell from 13.2
GB to a minimum of **3.52 GB** (23:27:23) and recovered to about 3.8 to 4.4 GB. Swap use peaked at
**52 MB** (no change from baseline). No out-of-memory events. So dune-dev **can** run two Sietches
plus the Overmap, but not also the Deep Desert.

### Result 2: renaming the SECONDARY Sietch also restarts the primary Survival_1

`dune sietches set-display 36 "<name>"`, with the primary Survival_1, the Director and the Gateway
all running and unaffected before the command:

| Time (UTC) | Offset | Event |
|---|---|---|
| 23:30:24 | 0s | command begins |
| 23:30:28 to 23:30:39 | +4s | **secondary Sietch (36) kill, die, start** |
| 23:31:08 | +44s | **Director** kill, die, start |
| 23:31:23 | +59s | **primary Survival_1** kill, die, start |
| 23:31:54 | +90s | **Gateway** kill, die, start |

So the code-reading prediction was correct: **a rename on any Survival_1 Sietch restarts the
primary Survival_1 (Sietch 1) as well**, so it disconnects Sietch 1's players even if the renamed
Sietch has none. The same Director-plus-Gateway cascade follows. The password path calls the same
refresh helper (by code), so it behaves the same; only partition 1 was tested for password.

### Result 3: decreasing the active Sietches 2 to 1 stops only the extra Sietch

`set-active Survival_1 1` at 23:34:18: the only container event was **kill and die of
`dune-server-survival-1-36`** (23:34:20). The primary Survival_1, the Director and the Gateway were
not touched. The partition 36 row was deleted (a `COMMIT` in the output), leaving only partition 1.
`set-max Survival_1 1` restored the maximum.

### Result 4: restoring the Deep Desert

`dune maps set DeepDesert_1 always-on` printed:

> WAIT always-on map=DeepDesert_1 partition=8 host-memory available=14GiB requested=16GiB
> reserve=4GiB required=20GiB swap-free=8GiB. Automatic startup was deferred to protect the host
> from memory exhaustion. Swap is emergency headroom and is not treated as launch capacity.

The autoscaler **refused to restart the Deep Desert for 3 minutes** (18 polls): its guard needs the
map's 16 GiB limit plus a 4 GiB reserve (20 GiB) available, and only about 13.4 GB was free with
Survival_1 up. The Deep Desert only ran earlier because it started at boot when memory was free.
**Consequence on a 26 GB host: an always-on Deep Desert that stops cannot come back automatically
while Survival_1 is running.** A direct `dune spawn 8` started it (it does not apply that guard, as
`set-active` did not either); it settled alive and registered, available memory about 5.2 GB.

## What this changes in the interpretation of the earlier open questions

- "Does changing the active count restart Survival_1?" **Not in this test** (1 to 2 and 2 to 1).
  Whatever the operator saw on production (3 to 4 Sietches, many maps, real players) may involve the
  port-conflict relocation or behavior I did not reproduce. Do not cite this as a proof for the
  production layout.
- "Does a rename on a secondary restart the primary?" **Yes, confirmed.**
- "Can dune-dev hold a second Sietch?" **Yes, if the Deep Desert is stopped (set dynamic).**

## Still not tested

- ~~A rename or password change on a Deep Desert~~ **Probably not a supported operation** (operator
  doubted it; code check, not a test): the console's Sietch name/password editor only works on
  Survival_1 Sietch rows (rows built from the Survival_1 partition id list; a row without a real
  partition id is read-only, `sietchRows.ts`), and no Deep Desert name or password control was found
  in `MapsPanel.tsx`. Deep Desert display names ("Deep Desert PvE/PvP") are produced by the layout
  (`deepdesert.sh`, `ManagedPrimaryDisplayName...`), not set by hand. The CLI `sietches set-display`
  takes any partition id and would write that ini value, but the layout may overwrite it and it does
  not run the Survival_1 restart cascade. Not run.
- Password change on a **secondary** Sietch (same code path as rename; expected identical).
- Count changes **while players are connected**, and counts above 2 (port conflicts and
  `relocate_survival_port_conflicts`, which would restart another map holding the reserved ports).
- Whether the Deep Desert and Overmap re-register cleanly after a Director restart (they stayed up
  and 0 players were connected).
- The Director's own stale-browser heal (`autoscaler.sh:~3066-3090`) also calls `restart-director.sh`,
  but defers while players are online; it appeared in the autoscaler log as
  `HEAL unscoped-stale-server-state` during the series without a Director restart event.

## What changed on dune-dev, and how it was restored (both series)

- A database backup was taken before each series (`dune db backup`).
- The Sietch name and password were saved to a private file on the VM (never printed or copied
  into any session), changed, then restored. Verification compared the stored values to the saved
  copies: both restored. The temporary name and password used in the test were fixed test strings.
- Evidence files remain on dune-dev under `~/sietch-restart-test/` (baseline, before/after states,
  `events-A.log`, `events-B.log`, `events-C.log`, script output). Delete when no longer needed.
- Reproduce with the same method: record `docker inspect` start times, run `docker events
  --filter type=container --filter event=kill --filter event=start` in the background, run the
  `dune sietches set-display <partition> <name>` or `set-password <partition>` command with its stdin
  redirected from `/dev/null`, then compare. **A pitfall hit during the test:** `dune` reads stdin, so
  when a script is piped into `ssh bash -s` the rest of the script is consumed by the `dune` command
  unless stdin is redirected.

## Consequences for the Discord design

1. A Discord rename or password change on a Survival_1 Sietch must be described to the user as
   **"this restarts Survival_1 twice, the Director and the Gateway (about 90 seconds), and
   disconnects everyone on Survival_1"**, with the live player count, not as "a Sietch restart".
2. Admin tier only (operator decision), with a second confirmation. A moderator may restart a
   Sietch through the queue, but must not be able to trigger this cascade.
3. Mark it as a high-impact action in help. Consider a refusal when players are online unless the
   admin explicitly chooses to proceed.
4. Core could reduce the impact (skip the second Survival_1 restart, avoid the Gateway restart);
   that is a Core change, tracked in a Core issue, not something mentat can do.
5. The same evidence applies to the console: its dialog does not warn about this cascade.

## dune-dev final state after both series

Deep Desert partition 8 alive and registered, mode `always-on` (as found); Survival_1 has only
partition 1, `max_dimensions` 1 and `active_dimensions` 1 (now stored as explicit values, where
before only `active_dimensions_explicit: false` was recorded); the Sietch name and password of
partition 1 are as found; the autoscaler is running; the temporary partition 36 row is gone. Evidence
is under `~/sietch-restart-test/` and `~/sietch-restart-test/t2/` on dune-dev (event logs, memory
log, before/after states).
