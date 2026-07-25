# Backup & Recovery Runbook

**Version**: 1.0
**Date**: 2026-07-19
**RTO**: 1 hour
**RPO**: 15 minutes

---

## Backup Scope

| Component | Backup Method | Frequency | Retention |
|---|---|---|---|
| Bot code | GitHub repository | Continuous | Indefinite |
| Landing page | GitHub repository | Continuous | Indefinite |
| KV stats | Cloudflare automatic | Continuous | 30 days |
| Bot database | SQLite file | Daily | 30 days |
| Configuration | `.env` files | Manual | Until rotation |
| Secrets | File system | Manual | Until rotation |

## Recovery Procedures

### Bot Recovery

<!-- Corrected 2026-07-25: this previously named the wrong systemd unit
     (discord-bot.service) and described a manual git-pull recovery
     flow that doesn't match how the real production bot is actually
     deployed. Verified directly against the real OCI production
     instance (acp-bot-vnic). -->

**Real production bot**: runs as `acp-bot.service` on the OCI instance
(`acp-bot-vnic`), working directory `/home/ubuntu/arrakis-control-panel`.
Deployment is via `git push deploy deploy` from a dev machine, which
triggers a `post-receive` hook on the OCI instance
(`~/acp-deploy.git/hooks/post-receive`) that fetches the `deploy` branch,
runs the test suite as a guardrail, and only restarts the service if
tests pass.

**Scenario**: Bot process failed, needs restart.
```bash
ssh ubuntu@<oci-host>
sudo systemctl restart acp-bot.service
sudo systemctl status acp-bot.service
```

**Scenario**: Bot code corrupted, needs redeploy.
```bash
# From a dev machine with the 'deploy' remote configured:
git push deploy deploy --force
# This triggers post-receive on the OCI instance: fetch, test, restart.
# To verify manually on the OCI instance instead:
ssh ubuntu@<oci-host>
cd ~/arrakis-control-panel
git fetch deploy deploy && git reset --hard deploy/deploy
npm ci --omit=dev
sudo systemctl restart acp-bot.service
```

**Note**: a `discord-bot.service` may also exist on local dev machines
as a leftover test instance -- confirm which host and which service
you're actually operating on before running any of the above.

**Scenario**: Token compromised, needs rotation.
1. Generate new token in Discord Developer Portal
2. Update `secrets/discord-bot-token.txt`
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

### KV Recovery

**Scenario**: KV data corrupted.
1. Clear corrupted keys
2. Restart bot to repopulate stats
3. Verify stats are accurate

**Scenario**: KV namespace deleted.
1. Create new namespace in Cloudflare dashboard
2. Update `wrangler.toml` with new namespace ID
3. Update bot `.env` with new namespace ID
4. Redeploy landing page and restart bot

## Backup Verification

### Monthly Checks

- [ ] Verify bot can restart from clean state
- [ ] Verify landing page builds successfully
- [ ] Verify KV data is populated and accurate
- [ ] Verify all secrets are accessible
- [ ] Test rollback procedure

### Evidence

Store verification results in `compliance/evidence/backups/YYYY-MM.md`:
- Date of verification
- Components tested
- Results (pass/fail)
- Issues found and remediation
- Sign-off

## Disaster Recovery

### Full System Recovery

1. **Infrastructure**: Provision new server (if needed)
2. **Code**: Clone repositories from GitHub
3. **Dependencies**: Run `npm ci` in each project
4. **Configuration**: Restore `.env` files from secure backup
5. **Secrets**: Rotate all tokens and credentials
6. **Services**: Start bot, verify landing page
7. **Validation**: Run test suite, verify functionality
8. **Monitoring**: Confirm alerts and logging are active

### Contact Information

| Role | Contact | Escalation |
|---|---|---|
| Primary | yacketrj | Immediate |
| Secondary | TBD | 1 hour |
| Cloudflare Support | support@cloudflare.com | 4 hours |
| Discord Support | support.discord.com | 24 hours |
