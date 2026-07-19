# Setup Portal Guide

This guide walks you through connecting your Discord server to the Arrakis
Control Panel using the web setup portal. No `.env` file editing required —
everything is configured through the browser.

## Before You Start

You need:

- **Server Owner** or **Administrator** permission in your Discord server
- A running **Dune Awakening Selfhost Docker Console** with the Discord adapter enabled
- The bot already **invited to your Discord server**

---

## Step 1: Open the Setup Portal

Open the setup URL provided by your bot host:

```
https://acp-setup.darkdante.org/setup
```

You will see a **"Sign In with Discord"** button.

---

## Step 2: Sign In with Discord

Click **Sign in with Discord**. You will be redirected to Discord's
authorization screen.

- Discord will ask you to authorize the bot to see your username and server list
- This is required so the portal can identify you and populate your server dropdown
- Click **Authorize**

You will be redirected back to the setup portal with a configuration form.

---

## Step 3: Select Your Server

A dropdown lists all Discord servers you own or have the **Manage Server**
permission for.

- Select the server you want to connect
- If your server doesn't appear, make sure you have the **Manage Server**
  permission in that server

---

## Step 4: Enter Your Console URL

This is the address of your Dune Docker Console's WebUI.

**Example values:**

| Scenario | Console URL |
|----------|-------------|
| Local network | `http://192.168.1.100:8088` |
| Same machine | `http://localhost:8088` |
| Public server | `http://your-domain.com:8088` |
| Behind reverse proxy | `https://dune.yourdomain.com` |

**Where to find it:** This is the same URL you use to open the Dune console
dashboard in your browser.

---

## Step 5: Enter Your Adapter Token

The adapter token authenticates the bot with your Dune console.

### Option A: Use an existing token

If you already enabled the Discord adapter on your console:

1. SSH into your Dune console host
2. Read the token file:
   ```bash
   cat /repo/runtime/secrets/discord-adapter-token.txt
   ```
3. Copy the token and paste it into the **Adapter Token** field

### Option B: Generate a new token

If you haven't set up the adapter yet, or want a fresh token:

1. Click the **Generate** button next to the Adapter Token field
2. A random 64-character token will be filled in automatically
3. **Now you need to configure your Dune console to use this token:**

   SSH into your Dune console host and edit your console `.env`:

   ```bash
   # Enable the adapter
   DUNE_DISCORD_ADAPTER_ENABLED=true

   # Point to the token file
   DUNE_BOT_API_TOKEN_FILE=/repo/runtime/secrets/discord-adapter-token.txt
   ```

   Create the token file with the generated value:

   ```bash
   echo -n "paste-the-generated-token-here" > /repo/runtime/secrets/discord-adapter-token.txt
   chmod 600 /repo/runtime/secrets/discord-adapter-token.txt
   ```

   Restart your Dune console:

   ```bash
   docker compose restart
   ```

---

## Step 6: Configure Roles (Optional)

Roles control who can use which bot commands. You can skip this and configure
roles later.

### Admin Role ID

Members with this role can use **admin commands** (`/dune admin doctor`, etc.)

**How to get a Role ID:**

1. Open Discord **User Settings** (gear icon)
2. Go to **Advanced** → Enable **Developer Mode**
3. Go to your server → **Server Settings** → **Roles**
4. Right-click the role you want → **Copy Role ID**
5. Paste the ID into the **Admin Role ID** field

### Observer Role ID

Members with this role can use **read-only commands** (`/dune health`,
`/dune status`, `/dune server status`, etc.)

Follow the same steps as above to get the Role ID.

**Tip:** If you only configure one role, that role gets access to all commands.
Configure both for proper separation of permissions.

---

## Step 7: Connect

Click **Connect Server**. If everything is correct, you will see a success
screen confirming your server is connected.

---

## Verify It Works

Go to your Discord server and type:

```
/dune ping
```

You should see a response with Discord and adapter latency. If you get an error:

| Error | Cause | Fix |
|-------|-------|-----|
| "Not authorized" | No roles configured | Set an Admin or Observer Role ID in the portal |
| "Adapter request failed" | Console unreachable | Check Console URL is correct and adapter is enabled |
| "Missing adapter credential" | Token mismatch | Ensure the token in the portal matches the console's token file |
| Commands don't appear | Not registered | Run `npm run register` on the bot host, or wait up to 1 hour for global registration |

---
