# Troubleshooting

Common issues, what they mean, and how to fix them.

> **Hosted-bot note (2026-08-07, issue #93):** most server owners use the
> **hosted** bot — no local process, no Docker, no token. Sections below
> that reference `docker`, `DISCORD_BOT_TOKEN`, or `npm run register`
> apply to **self-hosted instances only** (see
> [Installation Guide](installation-guide.md)). For the hosted bot,
> contact the bot host for process/token/registration issues; your own
> fixes are limited to the setup portal
> (`setup-portal-guide.md`) and your console's adapter config.

## Discord Errors

### "application did not respond"

**What it means:** The bot process isn't running. Discord sent the command
but the bot wasn't there to answer it.

**How to fix:**
1. Check if the Docker container is running:
   ```bash
   docker ps | grep dune-discord-bot
   ```
2. If not running, start it:
   ```bash
   docker start dune-discord-bot
   ```
3. If it crashes immediately, check the logs:
   ```bash
   docker logs dune-discord-bot
   ```

---

### "You are not authorized to use this command"

**What it means:** Your Discord role isn't in the allowed roles list.

**How to fix:**
1. Check your role in the server
2. Ask your server admin to add your role ID to `DISCORD_OBSERVER_ROLE_IDS`
   or `DISCORD_ADMIN_ROLE_IDS` in the `.env` file
3. The bot needs to be restarted after changing `.env`:
   ```bash
   docker restart dune-discord-bot
   ```

---

### "Adapter request failed HTTP 503"

**What it means:** The console's Discord adapter isn't configured or is
missing a token.

**How to fix:**
1. Check that the console has the adapter enabled:
   ```bash
   docker exec redblink-dune-docker-console printenv | grep DUNE_DISCORD
   ```
   Should show `DUNE_DISCORD_ADAPTER_ENABLED=true`
2. Check that the token file exists:
   ```bash
   docker exec redblink-dune-docker-console cat /repo/secrets/bot-api-token.txt
   ```
3. The bot's `DUNE_DISCORD_ADAPTER_TOKEN` must match this file's contents

---

### "Adapter is disabled"

**What it means:** The console has `DUNE_DISCORD_ADAPTER_ENABLED=false` or
isn't set at all.

**How to fix:**
Add to the console's `docker-compose.web.yml`:
```yaml
environment:
  DUNE_DISCORD_ADAPTER_ENABLED: "true"
```
Then rebuild and restart the console:
```bash
docker compose -f docker-compose.web.yml up -d --build redblink-dune-docker-console
```

---

### "Bot token is not configured"

**What it means:** The bot can't find its Discord token.

**How to fix:**
1. Check that the `.env` file has `DISCORD_BOT_TOKEN` set
2. Or check that `DISCORD_BOT_TOKEN_FILE` points to a valid file
3. For Docker, verify the secrets volume is mounted:
   ```bash
   docker inspect dune-discord-bot | grep -A5 Mounts
   ```

---

## Registration Issues

### Commands don't appear after registration

**With guild ID:**
Commands appear instantly for guild-scoped registration. If they don't,
verify `DISCORD_GUILD_ID` is correct (use the "Copy Server ID" option
with Developer Mode enabled).

**Without guild ID (global):**
Global commands can take up to 1 hour to propagate. If it's been longer:
1. Run `npm run register` again
2. Check the bot logs for errors:
   ```bash
   docker logs dune-discord-bot | grep register
   ```

---

### Duplicate `/dune` commands appear

**What it means:** Both global and guild-scoped commands are registered.

**How to fix:**
Delete the global registration:
```bash
curl -X DELETE -H "Authorization: Bot YOUR_TOKEN" \
  "https://discord.com/api/v10/applications/YOUR_APP_ID/commands/COMMAND_ID"
```
Then only use guild-scoped registration going forward.

---

## Adapter Issues

### Status returns empty or "UNKNOWN"

**What it means:** The adapter is running but can't reach the Dune CLI.

**How to fix:**
1. Verify the console container can run dune:
   ```bash
   docker exec redblink-dune-docker-console /repo/runtime/scripts/dune status
   ```
2. Check that the console's Docker socket is mounted
3. If using a non-standard setup, set `config.duneScript` in the config

---

### Health returns 401 (unauthorized)

**What it means:** The bot is sending the wrong adapter token.

**How to fix:**
1. Verify the token in `DUNE_DISCORD_ADAPTER_TOKEN` matches the file
   referenced in `DUNE_BOT_API_TOKEN_FILE` on the console side
2. Check for trailing whitespace or newlines in token files:
   ```bash
   cat -A /path/to/token-file
   ```

---

## Player Feature Issues

### "Not linked to a game character"

**What it means:** You haven't linked your Discord account to an in-game character yet.

**How to fix:**
Run the link command with your exact character name:
```bash
/dune player link <your-character-name>
```
Replace `<your-character-name>` with the name as it appears in the game.
If that character has no Steam account on file, you'll receive a
verification code in-game via whisper — use `/dune player verify <code>`
to complete the link. If it does have a Steam account on file, the bot
shows a "Link via Steam" button instead (no whisper needed, works even if
your character is offline) — the bot picks whichever applies automatically,
you never have to choose. See [User Guide § Linking Your Character](user-guide.md#linking-your-character).

---

### "No player found matching <name>"

**What it means:** The character name you entered doesn't exist on the server.

**How to fix:**
1. Check the spelling — it must match exactly, including capitalization
2. Verify the character exists on this server (not a different server)
3. Try linking with a different name if you have multiple characters

---

### "Multiple players found: <names>"

**What it means:** More than one character on the server has the name you entered.

**How to fix:**
1. Use a more specific character name if possible
2. Ask a server admin to help identify the correct character
3. Check if you have multiple characters with similar names

---

### "Player inventory is empty"

**What it means:** Your character has no items in their inventory.

**How to fix:**
1. This is normal if your character isn't carrying anything
2. Check `/dune player storage` to see items in your storage containers
3. Verify your character is online and the game server is running

---

### "Storage scope must be 'owned' or 'guild'"

**What it means:** You used an invalid scope when checking storage.

**How to fix:**
- Use `/dune player storage` for your personal storage
- Use `/dune player storage` with guild scope for guild storage (if supported)
- Use `/dune player find <item>` with scope `owned` or `guild`

---

### "Not authorized to access guild storage"

**What it means:** You don't have permission to view guild storage.

**How to fix:**
1. Verify you're a member of a guild on the server
2. Ask a server admin to check your guild membership
3. Ensure your Discord role has the `guild:read` capability

---

## Bot Crashes

### Container exits immediately

**What it means:** The bot process crashed on startup.

**How to fix:**
Check the logs for the specific error:
```bash
docker logs dune-discord-bot
```

Common causes:
- Invalid Discord token
- Missing required env vars
- No roles configured in restricted RBAC mode
- Network unreachable (check `DUNE_CONSOLE_API_URL`)

---

### "Restricted RBAC requires at least one role"

**What it means:** RBAC is set to `restricted` but no roles are configured.

**How to fix:**
Either:
1. Add role IDs to `DISCORD_OBSERVER_ROLE_IDS` or `DISCORD_ADMIN_ROLE_IDS`
2. Or temporarily set `DISCORD_RBAC_MODE=open` for testing

---

## Scheduler Issues

### No status posts appearing

1. Check that `DUNE_POST_SCHEDULE_TYPE` is not set to `none`
2. Verify `DUNE_POST_ALLOWED_CHANNELS` has valid channel IDs
3. The first post fires immediately on startup, then every interval after
4. Check bot logs:
   ```bash
   docker logs dune-discord-bot | grep scheduler
   ```

---

## Security Scan Issues

### Pre-commit hooks fail

Each hook has a specific fix:

| Hook | Common Fix |
|------|-----------|
| Semgrep | Fix the code finding or document as false positive |
| Gitleaks | Redact the secret or add to `.gitleaksignore` |
| Trivy | Skip false positive directories |
| npm audit | Run `npm audit fix` |
| ggshield | Requires `ggshield auth login` |

To bypass hooks temporarily (emergency only):
```bash
git commit --no-verify
```

---

## Getting More Help

1. Check the [FAQ](faq.md) for common questions
2. See the [Admin Guide](admin-guide.md) for setup instructions
3. Review the [Configuration Reference](configuration.md) for all settings
4. Open an issue at [github.com/yacketrj/Arrakis-Control-Panel](https://github.com/yacketrj/Arrakis-Control-Panel/issues)

## Sources

- [Discord Developer Documentation](https://docs.discord.com/developers)
- [Dune Awakening Self-Host Docker](https://github.com/Red-Blink/dune-awakening-selfhost-docker)
