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

Open this URL in your browser:

```
https://acp-setup.darkdante.org/setup
```

You will see a dark-themed page with a **"Sign In with Discord"** button.

---

## Step 2: Sign In with Discord

1. Click **Sign in with Discord**
2. Discord will ask you to authorize the application
   - This only grants permission to see your username and the servers you manage
   - No messages, roles, or private data are accessed
3. Click **Authorize**

You will be redirected back to the setup portal, now showing a configuration
form with your Discord username at the top.

---

## Step 3: Select Your Server

The form shows a **"Discord Server"** dropdown. It lists all servers you own
or have the **Manage Server** permission for.

- Select the server you want the bot to work in
- If your server doesn't appear, verify you have the **Manage Server**
  permission in that server's settings

---

## Step 4: Enter Your Console URL

This field is labeled **"Console URL"**. It needs the web address of your
Dune Docker Console's WebUI.

**Important:** The bot runs on our remote server, so this URL must be
**publicly accessible from the internet**. The following will **not** work:

- `localhost` or `127.0.0.1`
- Private IPs like `192.168.x.x` or `10.x.x.x`
- Any address only reachable on your local network

**What to enter instead:**

| Where your console runs | What to enter |
|------------------------|---------------|
| Public VPS / dedicated server | `http://your-server-ip:8088` |
| Domain with DNS pointing to it | `https://dune.yourdomain.com` |
| Your home PC (use a tunnel) | See below |

**If your console runs on your home PC:** You need to expose it to the
internet with a tunnel. The easiest free option is Cloudflare Tunnel:

```bash
cloudflared tunnel --url http://localhost:8088
```

This prints a URL like `https://abc123.trycloudflare.com`. Copy that URL
and paste it into the Console URL field. Keep the tunnel running while
the bot is active.

---

## Step 5: Enter Your Adapter Token

This field is labeled **"Adapter Token"**. It authenticates the bot with
your Dune console so it can query server status, player data, etc.

You have two options:

### Option A: Copy an existing token

If you already enabled the Discord adapter on your Dune console:

1. SSH into the machine running your Dune console
2. Read the token file:
   ```bash
   cat /repo/runtime/secrets/discord-adapter-token.txt
   ```
3. Copy the output and paste it into the **Adapter Token** field on the
   setup portal page

### Option B: Generate a new token from the portal

If you haven't set up the adapter yet, or want a fresh token:

1. On the setup portal page (after signing in with Discord), find the
   **Adapter Token** field
2. Click the **Generate** button to the right of that field
   - A random 64-character token will appear in the field automatically
3. **Copy this token** — you will need it in the next step
4. SSH into the machine running your Dune console
5. Edit your console's `.env` file and add (or update) these lines:
   ```bash
   DUNE_DISCORD_ADAPTER_ENABLED=true
   DUNE_BOT_API_TOKEN_FILE=/repo/runtime/secrets/discord-adapter-token.txt
   ```
6. Create the token file with the value you copied from the portal:
   ```bash
   mkdir -p /repo/runtime/secrets
   echo -n "paste-the-generated-token-here" > /repo/runtime/secrets/discord-adapter-token.txt
   chmod 600 /repo/runtime/secrets/discord-adapter-token.txt
   ```
7. Restart your Dune console:
   ```bash
   cd ~/dune-awakening-selfhost-docker
   docker compose -f docker-compose.web.yml restart redblink-dune-docker-console
   ```

---

## Step 6: Configure Roles (Optional)

Below the token field are two optional fields for role-based access control.
You can skip these and fill them in later.

### Admin Role ID

Members with this Discord role can use **admin commands**
(`/dune admin doctor`, `/dune admin config`, etc.)

**How to get a Role ID:**

1. Open Discord **User Settings** (gear icon near your username)
2. Go to **Advanced** → Toggle **Developer Mode** ON
3. Go to your server → Right-click the role in the role list
   (or go to Server Settings → Roles)
4. Click **Copy Role ID**
5. Paste the ID into the **Admin Role ID** field

### Observer Role ID

Members with this role can use **read-only commands**
(`/dune health`, `/dune status`, `/dune server status`, etc.)

Follow the same steps as above to get the Role ID.

**Tip:** If you only configure one role, members with that role can use
all commands. Configure both for proper separation of permissions.

---

## Step 7: Connect

Scroll to the bottom of the form and click **Connect Server**.

If everything is correct, the page will change to a success screen
confirming your server is connected. You can now close the browser tab.

---

## Verify It Works

1. Open Discord and go to your server
2. Type `/dune ping` in any text channel and press Enter
3. You should see a response showing Discord latency and adapter latency

If you get an error:

| Error | Cause | Fix |
|-------|-------|-----|
| "Not authorized" | No roles configured | Go back to the setup portal, enter an Admin or Observer Role ID |
| "Adapter request failed" | Console unreachable | Verify the Console URL is correct, publicly accessible, and the adapter is enabled |
| "Missing adapter credential" | Token mismatch | The token in the portal must match the contents of the console's token file |
| Commands don't appear | Slash commands not registered | The bot host handles this automatically; if commands are missing after 1 hour, contact support |
