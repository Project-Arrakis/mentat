#!/usr/bin/env bash
# Phase 0 read-only checks for the mentat bot VM (build order, phase 0). Run it ON the bot VM, or:
#   ssh bot@<bot-vm> 'bash -s' < 2026-10-01-phase0-bot-vm-checks.sh
# Read-only: it changes nothing. It never prints a token, secret or the console URL: environment
# variables are reported as set/unset, except the non-secret mode flags listed below.
set -u

echo "== 1. service"
systemctl show acp-bot.service -p ActiveState,SubState,NRestarts,ActiveEnterTimestamp,WorkingDirectory,EnvironmentFiles 2>&1

WD="$(systemctl show acp-bot.service -p WorkingDirectory --value 2>/dev/null)"
EF="$(systemctl show acp-bot.service -p EnvironmentFiles --value 2>/dev/null | awk '{print $1}')"
[ -n "$WD" ] || WD="$HOME/arrakis-control-panel"
echo "working dir: $WD"

echo; echo "== 2. deployed commit"
git -C "$WD" log --oneline -1 2>&1
git -C "$WD" status -sb 2>&1 | head -3
git -C "$WD" branch --show-current 2>&1

echo; echo "== 3. schema version (expected 8 on main; 9 means the unmerged on-duty draft is deployed)"
( cd "$WD" && DBP="$(grep -E '^ACP_DB_PATH=' "$EF" 2>/dev/null | head -1 | cut -d= -f2-)"; DBP="${DBP:-data/acp.db}"; echo "db file: $DBP ($(stat -c %s "$DBP" 2>/dev/null || echo missing) bytes)"
  node --input-type=module -e "import Database from 'better-sqlite3'; const db=new Database(process.argv[1],{readonly:true}); console.log(db.prepare('SELECT version FROM schema_version').get()); const cols=db.prepare(\"PRAGMA table_info(guilds)\").all().map(c=>c.name); console.log('guilds has on_duty_role_id:', cols.includes('on_duty_role_id')); console.log('guild rows:', db.prepare('SELECT count(*) n FROM guilds').get().n);" "$DBP" 2>&1 )

echo; echo "== 4. environment (set/unset only; no values except the mode flags)"
for v in DISCORD_BOT_TOKEN DISCORD_CLIENT_ID DISCORD_GUILD_ID DUNE_CONSOLE_API_URL DUNE_DISCORD_ADAPTER_TOKEN DUNE_DISCORD_ADAPTER_TOKEN_FILE; do
  if grep -qE "^${v}=.+" "$EF" 2>/dev/null; then echo "$v: set"; else echo "$v: unset"; fi
done
for v in DISCORD_RBAC_MODE MENTAT_MULTI_TENANT SENTINEL_MULTI_TENANT ACP_MULTI_TENANT; do
  line="$(grep -E "^${v}=" "$EF" 2>/dev/null | head -1)"; echo "${line:-$v: unset}"
done

echo; echo "== 5. recent service log (errors only, last 20)"
journalctl -u acp-bot.service --no-pager -n 400 2>/dev/null | grep -iE "error|fatal|unhandled" | tail -20 | cut -c1-200
