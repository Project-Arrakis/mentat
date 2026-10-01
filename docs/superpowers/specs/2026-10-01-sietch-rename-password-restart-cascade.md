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

## Not tested, code reading only (be careful citing these)

- **A secondary Sietch (partition above 1).** `restart_sietch_partition_if_running` restarts only
  that partition's own container, but the call to `refresh_survival_sietch_metadata_state` is under
  the same `Survival_1` check, so by the code it still restarts the Director, the **primary**
  Survival_1 and the Gateway. If true, renaming Sietch 3 disconnects Sietch 1's players. Needs a
  test on a dune-dev with a second Sietch.
- **Deep Desert rename or password** (`DeepDesert_1`): the scripts only auto-restart Survival_1, so
  it is saved and applies at that map's next restart. Not tested.
- **Changing the number of active Sietches.** `set-active` does not call
  `refresh_survival_sietch_metadata_state` (callers are lines 2188, 2200 and 2229 only: set-display,
  set-password, set-settings), and a comment in `reconcile_map_dimensions` says a count change must
  not replace the Director or primary Survival_1. By the code it does **not** run this cascade, but
  it can restart a **different** map through `relocate_survival_port_conflicts` (despawn and spawn of
  a map holding the newly reserved ports, refused if players are connected). Not tested; dune-dev
  had about 3.9 GB of memory available (Survival_1 9.6 GB, Deep Desert 9.0 GB), too little for a
  second Sietch unless the Deep Desert is stopped first.
- The Director's own stale-browser heal (`autoscaler.sh:~3066-3090`) also calls
  `restart-director.sh`, but defers while players are online. It is a separate trigger of the same
  Survival_1 restart.

## What changed on dune-dev, and how it was restored

- A database backup was taken first (`dune db backup`).
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
