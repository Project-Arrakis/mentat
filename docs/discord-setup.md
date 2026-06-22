# Discord Setup

## Overview

Each install should use its own Discord application. Do not use a shared public
bot. Keeping the bot user-owned keeps Discord access, bot tokens, and WebUI
adapter tokens under the operator's control.

## Required Discord Model

Use one Discord application per deployment or admin group:

1. Create an application in the Discord Developer Portal.
2. Add a bot user to that application.
3. Copy the bot token into local secrets management.
4. Invite the bot to the target Discord server.
5. Register the slash commands with `npm run register`.
6. Run the bot beside the WebUI or on a trusted private network.

## OAuth2 Scopes

Use only the scopes required for this bot:

- `bot`
- `applications.commands`

Discord uses OAuth2 scopes to decide what an application can do. This bot needs
the bot identity and slash commands only; it does not need user OAuth tokens.

## Bot Permissions

Start with permissions integer `0` for v1 slash-command interaction responses.

Do not grant broad server permissions. The current bot does not need:

- Administrator
- Manage Server
- Manage Channels
- Manage Roles
- Manage Messages
- Read Message History
- Message Content access

If a future feature adds scheduled channel posts, grant only the specific
channel permissions required for that feature and document the change in the PR.

## Gateway Intents

The runtime uses the Discord `Guilds` intent only. Do not enable privileged
gateway intents for v1:

- Guild Members
- Guild Presences
- Message Content

Discord requires privileged intents to be enabled separately in the Developer
Portal, and they should only be enabled when a bot requires them. This bot does
not require them for the current read-only slash command flow.

## Command Registration

For development, set `DISCORD_GUILD_ID` so command updates appear in one test
guild quickly:

```bash
npm run register
```

For production, leave `DISCORD_GUILD_ID` empty to register global commands.

## User-Owned Secrets

Never commit these values:

- `DISCORD_BOT_TOKEN`
- `DUNE_DISCORD_ADAPTER_TOKEN`
- secret-file contents referenced by `DISCORD_BOT_TOKEN_FILE`
- secret-file contents referenced by `DUNE_DISCORD_ADAPTER_TOKEN_FILE`

Use `.env` only for local runtime configuration. `.env` is ignored by Git.

## Sources

- Discord OAuth2 and permissions: https://docs.discord.com/developers/platform/oauth2-and-permissions
- Discord application commands: https://docs.discord.com/developers/interactions/application-commands
- Discord privileged intents: https://support-dev.discord.com/hc/en-us/articles/6207308062871-What-are-Privileged-Intents
- Discord gateway privileged intents: https://docs.discord.com/developers/events/gateway
