# Installation Guide — ACP Discord Bot

**Status:** Current | **Last Updated:** August 2026

Complete installation and deployment guide for Arrakis Control Panel.

## Installation Options

ACP is available as:

1. **Hosted Bot (Recommended)** — Use the official hosted instance
2. **Self-Hosted** — Run your own bot instance
3. **Docker Container** — Deploy in your infrastructure

Choose based on your needs:

| Option | Setup Time | Maintenance | Cost | Best For |
|--------|-----------|-------------|------|----------|
| **Hosted Bot** | 5 min | None | Free | Most server operators |
| **Self-Hosted** | 20 min | Medium | Low | Large communities, custom features |
| **Docker** | 10 min | Medium | Hosting | Professional deployments |

## Option 1: Hosted Bot (Recommended)

### Setup

1. **Invite the bot:**
   ```
   https://discord.com/oauth2/authorize?client_id=1516816812006969494&scope=bot%20applications.commands&permissions=128
   ```

2. **Open setup portal:**
   ```
   https://acp-setup.darkdante.org
   ```

3. **Complete the setup form:**
   - Enter your game server IP and port
   - Choose Discord channels for status/alerts
   - Configure permissions

4. **Verify:**
   ```
   /status
   ```

### Pros & Cons

**Pros:**
- Zero maintenance
- Always up-to-date
- No infrastructure required
- No Docker knowledge needed

**Cons:**
- Depends on hosting stability
- Limited customization
- Data on external servers

## Option 2: Self-Hosted

### Prerequisites

- **Node.js** 18+ (LTS recommended)
- **Discord Bot Token** (from Discord Developer Portal)
- **Game Server** connection (IP + port)
- **Internet connection** for Discord API

### Step 1: Create Discord Application

1. Visit [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Name it "Arrakis Control Panel"
4. Go to **Bot** → **Add Bot**
5. Copy the **TOKEN** (keep this secret!)
6. Enable these **Intents:**
   - Message Content Intent
   - Server Members Intent
   - Guild Members Intent

### Step 2: Clone Repository

```bash
git clone https://github.com/yacketrj/arrakis-control-panel.git
cd arrakis-control-panel
npm install
```

### Step 3: Configure Environment

Create a `.env` file:

```bash
# Discord
DISCORD_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here

# Game Server
SERVER_IP=YOUR_SERVER_IP
GAME_PORT=7777
CONSOLE_PORT=8088
CONSOLE_USERNAME=admin
CONSOLE_PASSWORD=your_password_here

# Setup Portal
SETUP_PORTAL_URL=https://your-domain.com
NODE_ENV=production
```

### Step 4: Add Bot to Your Server

1. Go to Discord Developer Portal → Your App → OAuth2 → URL Generator
2. Select scopes: `bot`, `applications.commands`
3. Select permissions: `Send Messages`, `Embed Links`, `Use Slash Commands`
4. Copy the generated URL
5. Visit the URL and select your server

### Step 5: Run the Bot

```bash
npm start
```

Or use a process manager:

```bash
npm install -g pm2
pm2 start "npm start" --name acp-bot
pm2 save
```

### Step 6: Verify

In Discord:
```
/status
```

## Option 3: Docker Container

### Prerequisites

- Docker & Docker Compose
- Game server IP and credentials
- Discord bot token

### Step 1: Create docker-compose.yml

```yaml
version: '3.8'

services:
  acp-bot:
    image: ghcr.io/yacketrj/arrakis-control-panel:latest
    container_name: acp-bot
    restart: unless-stopped
    environment:
      DISCORD_TOKEN: ${DISCORD_TOKEN}
      DISCORD_CLIENT_ID: ${DISCORD_CLIENT_ID}
      SERVER_IP: ${SERVER_IP}
      GAME_PORT: 7777
      CONSOLE_PORT: 8088
      NODE_ENV: production
    volumes:
      - ./bot-data:/app/data
    networks:
      - dune-network

networks:
  dune-network:
    external: true
```

### Step 2: Create .env

```bash
DISCORD_TOKEN=your_token
DISCORD_CLIENT_ID=your_client_id
SERVER_IP=your_game_server_ip
```

### Step 3: Start Container

```bash
docker compose up -d
```

### Step 4: Verify

```bash
docker logs -f acp-bot
```

Watch for:
```
✅ Bot ready! Logged in as ACP#1234
✅ Connected to server at 192.168.1.100:7777
```

## Securing Your Deployment

### Discord Bot Token Security

🔒 **NEVER commit your bot token to Git!**

- Store in `.env` (add to `.gitignore`)
- Use environment variables in production
- Rotate token if compromised:
  1. Discord Developer Portal → Bot → Regenerate Token
  2. Update `.env` or environment
  3. Restart bot

### Server Credentials

🔒 **Console credentials should be secure:**

- Use a dedicated admin account (not your personal account)
- Use a strong, unique password (20+ characters)
- Never log in externally with this password
- Rotate every 30 days

### Network Security

- Only expose game port (7777 UDP) to players
- Keep console port (8088) internal only
- Use a reverse proxy with HTTPS for web access
- Use firewall to restrict access

## Systemd Service (Self-Hosted)

Run as a Linux system service:

### Step 1: Create Service File

```bash
sudo nano /etc/systemd/system/acp-bot.service
```

### Step 2: Add Configuration

```ini
[Unit]
Description=Arrakis Control Panel Discord Bot
After=network.target

[Service]
Type=simple
User=acp
WorkingDirectory=/home/acp/arrakis-control-panel
ExecStart=/usr/bin/npm start
Restart=on-failure
RestartSec=10

Environment="NODE_ENV=production"
EnvironmentFile=/home/acp/.env

[Install]
WantedBy=multi-user.target
```

### Step 3: Enable & Start

```bash
sudo systemctl daemon-reload
sudo systemctl enable acp-bot
sudo systemctl start acp-bot
```

### Step 4: Monitor

```bash
# Check status
sudo systemctl status acp-bot

# View logs
sudo journalctl -u acp-bot -f

# Restart
sudo systemctl restart acp-bot
```

## Upgrading

### Hosted Bot

Updates are automatic. No action needed.

### Self-Hosted

```bash
git pull origin main
npm install
npm start
```

Or with Docker:

```bash
docker compose pull
docker compose down
docker compose up -d
```

## Troubleshooting Installation

### Bot Doesn't Respond

1. Check bot is online in Discord
2. Verify token is correct in `.env`
3. Check logs: `docker logs acp-bot` or `npm start`
4. Ensure bot has permission to use slash commands in channels

### Can't Connect to Game Server

1. Verify server IP and port in `.env`
2. Test connectivity: `telnet SERVER_IP 8088`
3. Check firewall allows outbound on port 7777 and 8088
4. Verify console credentials work

### Port Already in Use

If you get "EADDRINUSE" error:

```bash
# Find process using port
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Module Not Found

```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

## Next Steps

1. **[Quick Start](quick-start-guide.md)** — Basic usage
2. **[Discord Setup](discord-setup.md)** — Configure Discord channels
3. **[User Guide](user-guide.md)** — Command reference
4. **[Admin Guide](admin-guide.md)** — Admin features
5. **[Configuration](configuration.md)** — Advanced settings

## Getting Help

- **[FAQ](faq.md)** — Common questions
- **[Troubleshooting](troubleshooting.md)** — Problem solving
- **[GitHub Issues](https://github.com/yacketrj/arrakis-control-panel/issues)** — Bug reports
- **[Discussions](https://github.com/yacketrj/arrakis-control-panel/discussions)** — Questions & ideas

---

**Ready?** Head to the [Quick Start Guide](quick-start-guide.md) to begin! 🎮
