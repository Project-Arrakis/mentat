# Backup & Recovery Runbook

**Version**: 3.0
**Date**: 2026-08-07 (original), corrected 2026-08-13, corrected 2026-08-17
**RTO**: 1 hour
**RPO**: 15 minutes

**Correction (2026-08-17, issue #174):** this document previously
described OCI as the live hosting target (correctly, as of 2026-08-13)
with an R740 `dune-prod` co-location migration as "planned future, not
yet executed." **That migration happened, but not as originally
planned.** Per `r740-dune-deployment-kit#93`'s decision record, the bot
did NOT move to `dune-prod` (co-locating a public-facing Discord bot
with the live game server was rejected as a blast-radius risk) --
instead it got its own **dedicated VM** (VMID 103, "acp-bot",
`192.168.22.10`) on a new, isolated "Services" VLAN (22), separate from
both game-server VMs and the Proxmox hypervisor. This is now the live,
currently-running production service, confirmed directly via
`systemctl status acp-bot` on both the new VM (`active`) and the old OCI
instance (`inactive`, stopped 2026-08-17). OCI is drained but not yet
decommissioned -- see the Hosting Architecture section below.

---

## Hosting Architecture (CURRENT — dedicated Proxmox VM)

The Mentat bot (Sahir Venn) runs on a dedicated Proxmox VM, isolated from both
game-server VMs and the hypervisor itself (see
`r740-dune-deployment-kit#93` for the full placement decision and why
co-locating with `dune-prod` or running directly on the Proxmox host
were both rejected).

| Component | Location |
|---|---|
| Bot process | `acp-bot.service` on VM "acp-bot" (VMID 103, `192.168.22.10`), user `bot` |
| Working directory | `/home/bot/arrakis-control-panel` |
| Console API | `http://192.168.20.10:8088` (dune-prod) and `http://192.168.21.10:9088` (dune-dev) -- multi-tenant, reaches both over the Services VLAN's firewall-permitted path, not localhost |
| Setup portal (3100) | Via the `acp-console` Cloudflare Tunnel (relocated to the Proxmox host, see below) → `mentat-link.darkdante.org` |
| Steam-link (3101, path `/auth/steam`) | Same tunnel, path-scoped rule |
| SQLite DB | `/home/bot/arrakis-control-panel/data/acp.db` |
| **VM specs** | VMID 103, 2 vCPU / 4 GB RAM / 20 GB disk, Services VLAN 22 |

**Network isolation** (per issue #93's zone-matrix policy): the bot VM
can reach both game-server VMs' console APIs (`Services-Zone ->
Prod-Zone: Allow`, `Services-Zone -> Dev-Zone: Allow`), but neither
game-server VM can reach the bot (`Prod-Zone -> Services-Zone: Block`,
`Dev-Zone -> Services-Zone: Block`), and the bot cannot reach the
hypervisor (`Services-Zone -> Mgmt-Zone: Block`).

**The Cloudflare Tunnel does NOT run on the bot VM.** Unlike the
previous OCI setup (which ran `cloudflared-acp.service` directly on the
bot host), `mentat-link.darkdante.org`'s ingress now routes through the
`acp-console` tunnel already running on the **Proxmox host itself**
(`192.168.68.127`), which forwards to the bot VM's ports 3100/3101 over
the LAN. Restarting `cloudflared` on the Proxmox host takes down
`mentat-link.darkdante.org` alongside the game-server admin console
hostnames sharing the same tunnel -- see the meta-repo README's Live
Systems section (not committed here; that hostname is intentionally
kept non-public, unlike `mentat-link.darkdante.org`) for the full,
current ingress list.

## Hosting Architecture (PREVIOUS — OCI, drained but not decommissioned)

| Component | Previous Location |
|---|---|
| Bot process | `acp-bot.service` on `acp-bot-vnic` (OCI VPS) -- confirmed `inactive`, stopped 2026-08-17 |
| Working directory | `~/arrakis-control-panel` (user `ubuntu`) |
| Tunnel | `cloudflared-acp.service` ran directly on this instance -- confirmed `inactive`, stopped 2026-08-17 |

The OCI instance itself, its systemd unit files, and its deploy
repository have **not** been torn down as of this correction. Do not
assume they are still safe to use as a fallback without first checking
their actual current state -- "drained" is not the same as "ready to
receive traffic again on demand."

---

## Backup Scope

| Component | Backup Method | Frequency | Retention |
|---|---|---|---|
| Bot code | GitHub repository | Continuous | Indefinite |
| Landing page | GitHub repository | Continuous | Indefinite |
| Stats | Local SQLite + served via Cloudflare Tunnel | Continuous (5-min push) | Persistent until DB reset |
| Bot database | SQLite file | Daily | 30 days |
| Configuration | `.env` files | Manual | Until rotation |
| Secrets | File system | Manual | Until rotation |

## Recovery Procedures

**Note on the commands below**: they reference the deploy target's real,
current address, `192.168.22.10` (the dedicated bot VM, user `bot`) --
not a placeholder. If a future migration moves the bot again, update
every command below in the same change, per Requirement 14's
"documentation drift is a defect" rule.

### Bot Recovery

The bot runs as `acp-bot.service` on `192.168.22.10` (VM "acp-bot",
VMID 103), user `bot`.

Deployment: from a dev machine with SSH access to the deploy target,
push the `deploy` branch to a bare repo on that host, which triggers
a `post-receive` hook that tests, installs, and restarts. The canonical
hook source is `scripts/deploy-post-receive.sh` in this repo —
if it changes, sync the live copy on the actual deploy target to match.

The deploy remote targets a bare git repo on the deploy host:
`ssh://bot@192.168.22.10/home/bot/acp-deploy.git` (confirmed via
`git remote -v` on the dev clone).

**Service unit**: the `acp-bot.service` file shipped in this repo at
`systemd/acp-bot.service` is the authoritative template, and (as of
2026-08-17, issue #174) matches the live unit on `192.168.22.10`
exactly, field-for-field. If you ever need to reinstall it, copy it to
`/etc/systemd/system/acp-bot.service` on the deploy target unmodified.

**Scenario**: Bot process failed, needs restart.
```bash
ssh bot@192.168.22.10
sudo systemctl restart acp-bot.service
sudo systemctl status acp-bot.service
```

**Scenario**: Bot code corrupted, needs redeploy.
```bash
# From a dev machine with the 'deploy' remote configured:
git push deploy main:deploy
# This triggers post-receive on the deploy target: fetch, test, register,
# restart. To verify manually on that host instead:
ssh bot@192.168.22.10
cd ~/arrakis-control-panel
git fetch deploy deploy && git reset --hard deploy/deploy
npm ci --omit=dev
sudo systemctl restart acp-bot.service
```

**Note**: an old `discord-bot.service` was previously found running on
a dev machine as a leftover test instance and has been stopped/
disabled. Do not confuse it with the real production `acp-bot.service`
on `192.168.22.10`.

**Scenario**: Token compromised, needs rotation.
1. Generate new token in Discord Developer Portal
2. Update `.env` on `192.168.22.10`
3. Restart bot service
4. Verify bot comes online

### Landing Page Recovery

**Scenario**: Cloudflare Pages deployment failed.
```bash
cd /tmp/acp-landing-site
npm run build
npx wrangler pages deploy dist --project-name=acp-landing --branch=main
```

**Scenario**: Site compromised, needs restore.
1. Review git history for last known good commit
2. Checkout that commit
3. Rebuild and redeploy
4. Rotate any exposed credentials

### Stats Recovery

The live stats payload is stored in the bot's local SQLite `stats_snapshot`
table and served through the existing Cloudflare Tunnel at
`mentat-link.darkdante.org/api/live-stats`. No Cloudflare KV dependency
exists.

**Scenario**: Stats corrupted.
1. Restart bot to repopulate stats
2. Verify `GET https://mentat-link.darkdante.org/api/live-stats` returns valid JSON

### Cloudflare Tunnel Recovery

**Corrected 2026-08-17**: unlike the previous OCI setup, the tunnel
does NOT run on the bot's own VM. `cloudflared` (tunnel `acp-console`,
ID `67d90501-3c71-413d-949f-89a060f56567`) runs on the **Proxmox host
itself** (`192.168.68.127`), and its ingress rules forward to the bot
VM's LAN address (`192.168.22.10:3100`/`3101`) rather than `localhost`.
The tunnel is **dashboard-managed** — the authoritative ingress list
lives in Cloudflare's Tunnel Configuration API, not the local
`/etc/cloudflared/config.yml` on the Proxmox host (that file is kept
for readability but editing it and restarting the daemon has no effect
on real routing). See the meta-repo README's Live Systems section for
the full current ingress list and how to verify it via
`journalctl -u cloudflared` on the Proxmox host.

**Live ingress rules for this service** (as of 2026-08-17):
```yaml
ingress:
  - hostname: mentat-link.darkdante.org
    service: http://192.168.22.10:3100
  - hostname: mentat-link.darkdante.org
    path: ^/auth/steam
    service: http://192.168.22.10:3101
  - hostname: CONSOLE_TUNNEL_HOSTNAME
    service: http://192.168.20.10:8088
  - hostname: CONSOLE_DEV_TUNNEL_HOSTNAME
    service: http://192.168.21.10:9088
  - service: http_status:404
```

**Scenario**: Tunnel down, bot unreachable. Restart on the **Proxmox
host**, not the bot VM -- this also takes down both game-server admin
console hostnames sharing the same tunnel simultaneously, so check
current player count on both game-server VMs first.
```bash
ssh root@192.168.68.127
sudo systemctl restart cloudflared
sudo systemctl status cloudflared
```

## Backup Verification

### Monthly Checks

- [ ] Verify bot can restart from clean state
- [ ] Verify landing page builds successfully
- [ ] Verify live stats endpoint returns valid data
- [ ] Verify all secrets are accessible
- [ ] Test rollback procedure
- [ ] Verify Cloudflare Tunnel ingress rules are correct

### Evidence

Store verification results in `compliance/evidence/backups/YYYY-MM.md`:
- Date of verification
- Components tested
- Results (pass/fail)
- Issues found and remediation
- Sign-off

## Disaster Recovery

### Full System Recovery

1. **Infrastructure**: Provision a new VM on Proxmox per
   `r740-dune-deployment-kit#93`'s spec (2 vCPU / 4 GB RAM / 20 GB disk,
   Services VLAN 22) -- do NOT recreate it on `dune-prod` (VMID 101) or
   run it directly on the Proxmox host; both were explicitly rejected in
   #93's decision record for blast-radius reasons.
2. **Code**: Clone repositories from GitHub
3. **Dependencies**: Run `npm ci` in each project
4. **Configuration**: Restore `.env` files from secure backup
5. **Secrets**: Rotate all tokens and credentials
6. **Tunnel**: Re-establish Cloudflare Tunnel with ingress rules
7. **Services**: Start bot, verify landing page
8. **Validation**: Run test suite, verify functionality
9. **Monitoring**: Confirm alerts and logging are active

### Contact Information

| Role | Contact | Escalation |
|---|---|---|
| Primary | yacketrj | Immediate |
| Secondary | TBD | 1 hour |
| Cloudflare Support | support@cloudflare.com | 4 hours |
| Discord Support | support.discord.com | 24 hours |
