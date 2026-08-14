# Backup & Recovery Runbook

**Version**: 2.1
**Date**: 2026-08-07 (original), corrected 2026-08-13
**RTO**: 1 hour
**RPO**: 15 minutes

**Correction (2026-08-13):** this document previously described the bot
as already self-hosted on the Dell R740's `dune-prod` VM, with the OCI
VPS listed as "decommissioned 2026-08-07". **That migration has not
happened.** Confirmed independently on the live Proxmox R740 host: zero
VMs exist (`qm list` returns empty). The bot remains a live,
currently-running production service on its existing OCI VPS. This
section, and every R740-specific path/IP below, describes a **planned
future migration**, not current state — see
`docs/multi-tenant-design.md` for the same correction applied to that
design doc.

---

## Hosting Architecture (CURRENT — OCI)

The ACP bot is currently self-hosted on an OCI VPS instance
(`acp-bot-vnic`, `OCI_BOT_IP` — placeholder, substitute your own real
value from your password manager/infra notes; see this repo's
personal-identifier guard for why the real value isn't committed here).

| Component | Location |
|---|---|
| Bot process | `acp-bot.service` on `acp-bot-vnic` (`OCI_BOT_IP`) |
| Working directory | `~/arrakis-control-panel` |
| Console API | Reached over the OCI instance's network path to Core's console (not localhost in the current OCI-hosted architecture) |
| Setup portal (3100) | Via Cloudflare Tunnel → `acp-setup.darkdante.org` |
| Steam-link (3101) | Via Cloudflare Tunnel (same hostname, separate port) |
| SQLite DB | `~/arrakis-control-panel/data/acp.db` |

## Hosting Architecture (PLANNED FUTURE — R740, not yet executed)

Per [yacketrj/r740-dune-deployment-kit](https://github.com/yacketrj/r740-dune-deployment-kit),
the plan is to migrate the bot onto the Dell PowerEdge R740's
`dune-prod` VM once that hardware deployment is finalized, sharing the
VM with the game server stack and calling the console API over
**localhost** instead (eliminating the current OCI hosting cost and the
WAN hop for adapter traffic). **This section describes the target
end-state, not something to act on today:**

| Component | Planned Location |
|---|---|
| Bot process | `acp-bot.service` on dune-prod VM (192.168.20.10) |
| Working directory | `/home/dune/arrakis-control-panel` |
| Console API | `http://localhost:8088` |
| Setup portal (3100) | Via Cloudflare Tunnel → `acp-setup.darkdante.org` |
| Steam-link (3101) | Via Cloudflare Tunnel (same hostname, separate port) |
| SQLite DB | `/home/dune/arrakis-control-panel/data/acp.db` |
| **VM specs** | 40 vCPU (socket 0), 152 GB RAM (Proxmox VMID 101) |
| **Game stack** | 2 Sietch (40p/ea), 4 Deep Desert, Overmap, dynamic maps |

See `r740-dune-deployment-kit`'s `prompts/tabr-tau/01-bot-secrets-rotation.md`
and `prompts/r740xd/03-bot-deploy-and-tunnel.md` for the actual,
not-yet-executed migration procedure.

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

**Note on the commands below**: they reference the deploy target as
`YOUR_DEPLOY_HOST` — substitute your actual current deploy target's
address (currently the OCI VPS; will become `192.168.20.10` once the
R740 migration in the section above is actually executed). Do not
assume `192.168.20.10` is reachable or correct until that migration has
happened.

### Bot Recovery

The bot runs as `acp-bot.service` on the current deploy target
(see Hosting Architecture above for which one that currently is).

Deployment: from a dev machine with SSH access to the deploy target,
push the `deploy` branch to a bare repo on that host, which triggers
a `post-receive` hook that tests, installs, and restarts. The canonical
hook source is `scripts/deploy-post-receive.sh` in this repo —
if it changes, sync the live copy on the actual deploy target to match.

The deploy remote targets a bare git repo on the deploy host:
`ssh://dune@YOUR_DEPLOY_HOST/home/dune/acp-deploy.git` (path shown
matches the R740 target's planned layout; adjust user/path for the
current OCI target as actually configured).

**Service unit**: the `acp-bot.service` file shipped in this repo at
`systemd/acp-bot.service` is the authoritative template. Copy it to
`/etc/systemd/system/acp-bot.service` on the deploy target and adjust
the `User` and `WorkingDirectory` paths to match the actual deployment.

**Scenario**: Bot process failed, needs restart.
```bash
ssh dune@YOUR_DEPLOY_HOST
sudo systemctl restart acp-bot.service
sudo systemctl status acp-bot.service
```

**Scenario**: Bot code corrupted, needs redeploy.
```bash
# From a dev machine with the 'deploy' remote configured:
git push deploy main:deploy
# This triggers post-receive on the deploy target: fetch, test, register,
# restart. To verify manually on that host instead:
ssh dune@YOUR_DEPLOY_HOST
cd ~/arrakis-control-panel
git fetch deploy deploy && git reset --hard deploy/deploy
npm ci --omit=dev
sudo systemctl restart acp-bot.service
```

**Note**: an old `discord-bot.service` was previously found running on
a dev machine as a leftover test instance and has been stopped/
disabled. Do not confuse it with the real production `acp-bot.service`
on the actual deploy target.

**Scenario**: Token compromised, needs rotation.
1. Generate new token in Discord Developer Portal
2. Update `.env` on the deploy target
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
`acp-setup.darkdante.org/api/live-stats`. No Cloudflare KV dependency
exists.

**Scenario**: Stats corrupted.
1. Restart bot to repopulate stats
2. Verify `GET https://acp-setup.darkdante.org/api/live-stats` returns valid JSON

### Cloudflare Tunnel Recovery

The tunnel (`cloudflared`) runs on the current deploy target (see Hosting
Architecture above) as a systemd service. The tunnel config lives at
`/etc/cloudflared/config.yml` on that host.

**Ingress rules required:**
```yaml
ingress:
  - hostname: acp-setup.darkdante.org
    service: http://localhost:3100
  - hostname: CONSOLE_TUNNEL_HOSTNAME
    service: http://localhost:8088
  - service: http_status:404
```

**Scenario**: Tunnel down, bot unreachable.
```bash
ssh dune@YOUR_DEPLOY_HOST
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

**Note**: this section describes recovery assuming the R740 migration
(see Hosting Architecture above) has already happened by the time this
procedure is ever needed. If invoked before that migration, adapt step 1
to instead recover the current OCI-hosted deployment.

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
