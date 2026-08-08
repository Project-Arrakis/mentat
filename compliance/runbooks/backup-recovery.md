# Backup & Recovery Runbook

**Version**: 2.0
**Date**: 2026-08-07
**RTO**: 1 hour
**RPO**: 15 minutes

---

## Hosting Architecture

The ACP bot is self-hosted on the **dune-prod VM** (VMID 101) of the Dell
PowerEdge R740 Hypervisor described in
[yacketrj/r740-dune-deployment-kit](https://github.com/yacketrj/r740-dune-deployment-kit).
The bot and the game server stack share the same VM, calling the console
API over **localhost** (no WAN exposure for adapter traffic). The setup portal
and Steam-link OAuth callback are exposed through a **Cloudflare Tunnel**,
the same tunnel that already serves `console.darkdante.org`.

| Component | Location |
|---|---|
| Bot process | `acp-bot.service` on dune-prod VM (192.168.20.10) |
| Working directory | `/home/dune/arrakis-control-panel` |
| Console API | `http://localhost:8088` |
| Setup portal (3100) | Via Cloudflare Tunnel → `acp-setup.darkdante.org` |
| Steam-link (3101) | Via Cloudflare Tunnel (same hostname, separate port) |
| SQLite DB | `/home/dune/arrakis-control-panel/data/acp.db` |
| **VM specs** | 40 vCPU (socket 0), 152 GB RAM (Proxmox VMID 101) |
| **Game stack** | 2 Sietch (40p/ea), 4 Deep Desert, Overmap, dynamic maps |

**Previous host (decommissioned 2026-08-07):** OCI VPS `acp-bot-vnic`
at `129.146.238.118`. Moved to R740 to eliminate $300/month OCI costs.

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

### Bot Recovery

The bot runs as `acp-bot.service` on the **dune-prod VM**
(192.168.20.10, VMID 101 on the R740 Proxmox hypervisor).

Deployment: from a dev machine with SSH access to the dune-prod VM,
push the `deploy` branch to a bare repo on that VM, which triggers
a `post-receive` hook that tests, installs, and restarts. The canonical
hook source is `scripts/deploy-post-receive.sh` in this repo —
if it changes, sync the live copy on the R740 dune-prod VM to match.

The deploy remote targets a bare git repo on the VM:
`ssh://dune@192.168.20.10/home/dune/acp-deploy.git`. This internal IP
is only reachable from the Trusted LAN (VLAN 10) and from the Proxmox
host — not from the public internet.

**Service unit**: the `acp-bot.service` file shipped in this repo at
`systemd/acp-bot.service` is the authoritative template. Copy it to
`/etc/systemd/system/acp-bot.service` on the dune-prod VM and adjust
the `User` and `WorkingDirectory` paths to match the actual deployment.

**Scenario**: Bot process failed, needs restart.
```bash
ssh dune@192.168.20.10
sudo systemctl restart acp-bot.service
sudo systemctl status acp-bot.service
```

**Scenario**: Bot code corrupted, needs redeploy.
```bash
# From a dev machine with the 'deploy' remote configured:
git push deploy main:deploy
# This triggers post-receive on the dune-prod VM: fetch, test, register,
# restart. To verify manually on the VM instead:
ssh dune@192.168.20.10
cd ~/arrakis-control-panel
git fetch deploy deploy && git reset --hard deploy/deploy
npm ci --omit=dev
sudo systemctl restart acp-bot.service
```

**Note**: the old `discord-bot.service` on the dev machine
(`darkdante@tabr-tau`) was a leftover test instance and has been
stopped/disabled. Do not confuse it with the real production
`acp-bot.service` on the dune-prod VM.

**Scenario**: Token compromised, needs rotation.
1. Generate new token in Discord Developer Portal
2. Update `.env` on the dune-prod VM
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
`acp-setup.darkdante.org/api/live-stats`. No Cloudflare KV dependency exists.

**Scenario**: Stats corrupted.
1. Restart bot to repopulate stats
2. Verify `GET https://acp-setup.darkdante.org/api/live-stats` returns valid JSON

### Cloudflare Tunnel Recovery

The tunnel (`cloudflared`) runs on the dune-prod VM as a systemd service.
The tunnel config lives at `/etc/cloudflared/config.yml` on that VM.

**Ingress rules required:**
```yaml
ingress:
  - hostname: acp-setup.darkdante.org
    service: http://localhost:3100
  - hostname: console.darkdante.org
    service: http://localhost:8088
  - service: http_status:404
```

**Scenario**: Tunnel down, bot unreachable.
```bash
ssh dune@192.168.20.10
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

1. **Infrastructure**: Provision hypervisor per R740 kit, recreate dune-prod VM (VMID 101)
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
