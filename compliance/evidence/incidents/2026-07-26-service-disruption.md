# INC-03: Service Disruption — acp-bot.service crash loop after deploy sync

**Severity**: P1 (service down, player-facing)
**Detected**: 2026-07-26 00:43 UTC
**Resolved**: 2026-07-26 00:44 UTC
**Duration**: ~1 minute of active crash-looping before manual intervention; confirmed via `journalctl` timestamps (`00:43:06` first failed start, `00:44:30` confirmed stable restart)

## Trigger

Deploying `origin/main` (21 commits, accumulated 2026-07-22 through 2026-07-25, previously undeployed — see issue #82) to the live `deploy` remote via `git push deploy deploy-sync:deploy`.

## Assess

The `post-receive` hook's own guardrail (full test suite via `npm test`) passed cleanly on the server, and reported `✅ Tests passed.` The hook then restarted `acp-bot.service` and reported `⚠️ Service status unclear — check manually.` rather than a clean success message.

Checked manually via `systemctl status acp-bot.service`: the service was in `activating (auto-restart)` with `Result: exit-code`, `status=209/STDOUT`. `journalctl -u acp-bot.service -n 50` showed the actual failure:

```
(node)[...]: acp-bot.service: Failed to set up standard output: No such file or directory
systemd[1]: acp-bot.service: Main process exited, code=exited, status=209/STDOUT
```

Root cause: `acp-bot.service`'s unit file redirects stdout/stderr via `StandardOutput=append:/home/ubuntu/arrakis-control-panel/logs/bot.log`. Commit `4eb066b` ("chore: stop tracking runtime logs/bot.log", merged 2026-07-24 as part of PR #78) untracked `logs/bot.log` and added `logs/` to `.gitignore`. That commit's own message states the live log "is left in place on disk, just no longer tracked" — true for the author's environment at the time (the file already existed on disk and `git rm --cached` doesn't touch working-tree state), but this did not account for what happens on the *next* deploy sync: the `post-receive` hook runs `git reset --hard deploy/deploy`, which removes any file/directory not present in the target ref's tree. Once `logs/` was untracked, the next hard-reset-based deploy removed the directory entirely from the server's working tree, and systemd could no longer open its configured log-append target on the following service start.

This is a real instance of exactly the "test the actual upgrade, not just the new state" failure mode the workstream's operating document specifically calls out: the commit was correct and tested in isolation (the file it removed was genuinely redundant to track), but its effect on a live deployment's *next* sync operation was never verified against the actual `git reset --hard`-based deploy mechanism.

## Contain / Remediate

```bash
ssh acp-bot-oci "mkdir -p /home/ubuntu/arrakis-control-panel/logs && touch /home/ubuntu/arrakis-control-panel/logs/bot.log"
ssh acp-bot-oci "sudo systemctl restart acp-bot.service"
```

## Verify

- `systemctl show acp-bot.service --property=NRestarts,ActiveState,SubState` → `NRestarts=0`, `ActiveState=active`, `SubState=running` (confirmed 15+ seconds post-restart, no further auto-restart cycling).
- `logs/bot.log` shows `discord.ready` with a real bot user ID, confirming an actual, successful Discord gateway connection, not just a process that stayed alive.
- Two unrelated, pre-existing, non-fatal errors were also observed in this same log output (`health_state.write_failed` EACCES on `/tmp/dune-discord-bot/health.json`, and `stats_push.aggregate_failed` with a 401) — confirmed via source inspection that neither is caused by tonight's deploy or this incident's root cause; filed separately as issue #83 rather than fixed under incident-recovery time pressure.

## Corrective actions

1. **This report** (documenting the incident per the runbook's INC-03 steps).
2. Filed issue #82 (deploy drift) already existed prior to this incident being discovered; this incident occurred while resolving it.
3. **Follow-up needed, not yet done**: `logs/` should either not be required to exist for the service to start (e.g. the unit file's `StandardOutput`/`StandardError` targets should tolerate a missing directory, or systemd's `RuntimeDirectory=`/`LogsDirectory=` directives should be used instead of a hand-managed path so systemd creates it automatically on every start), or the deploy hook itself should `mkdir -p logs` before restarting the service. Either fix prevents recurrence; neither has been implemented yet. Tracked as a follow-up rather than fixed live during incident recovery, consistent with keeping incident response minimal and scoped to restoring service.
4. Update `compliance/runbooks/incident-response.md`'s INC-03 guidance to explicitly call out "check for directories removed by recent commits that a systemd unit or app config depends on existing" as a first-pass root-cause step for `Failed to set up standard output`-class failures, since this exact failure signature is now a known pattern here.

## Communication

Not separately posted to Discord #acp-updates — total downtime was under two minutes, resolved before any user-facing impact was likely to have been noticed (no player reports received). Documented here per the runbook's requirement rather than announced, consistent with P1 criteria being about detection/response speed, not mandating public disclosure for a sub-two-minute self-resolved blip.
