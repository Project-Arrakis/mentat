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

**Scenario**: Bot process failed, needs restart.
```bash
sudo systemctl restart discord-bot.service
sudo systemctl status discord-bot.service
```

**Scenario**: Bot code corrupted, needs redeploy.
```bash
cd /home/darkdante/arrakis-control-panel
git pull origin main
npm ci
sudo systemctl restart discord-bot.service
```

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
