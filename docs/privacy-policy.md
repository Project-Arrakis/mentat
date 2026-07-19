# Privacy Policy

**Last updated:** July 18, 2026

## Overview

The Arrakis Control Panel ("ACP", "the Bot") is a self-hosted Discord bot for Dune Awakening server operators. This Privacy Policy describes what data the Bot collects, how it is used, and your rights regarding that data.

**Key principle:** The Bot is designed to keep your data on your own infrastructure. We do not operate a central database or collect data for our own purposes.

## 1. Who We Are

The Bot is an open-source community project maintained by volunteers. It is not a commercial service. There is no company, no employees, and no data brokers involved.

- **Project:** Arrakis Control Panel (ACP)
- **Contact:** [Discord Community](https://discord.gg/9pQqytu6BU)

## 2. Data Controller

**You are the data controller.** When you add the Bot to your Discord server, you decide what data is collected, how it is stored, and who has access to it. The Bot processes data on your behalf under your instructions.

## 3. Data We Process

### 3.1 Discord Data

The Bot receives the following data from Discord when commands are used:

- **User ID:** Your Discord user identifier (required for role-based access control)
- **Username:** Your Discord display name (for logging purposes)
- **Server ID:** The Discord server where the command was issued
- **Channel ID:** The channel where the command was issued
- **Role IDs:** Your Discord role identifiers (for permission checks)

The Bot does **not** read message content. It only receives slash command interactions, which contain the command name and options you selected.

### 3.2 Game Server Data

When you run a command, the Bot queries your Dune Docker Console API and may process:

- Server status and health information
- Player counts and online status
- Character data (for linked accounts)
- Inventory and storage contents (for linked characters)
- Service container states
- Backup metadata
- Operational metrics (CPU, memory, etc.)

### 3.3 Character Links

When a user links their Discord account to an in-game character, the following association is stored:

- Discord user ID ↔ In-game character name

This link is stored on your game server, not on any external service. It is used solely to determine which character's data to display when that user runs player commands.

## 4. How Data Is Used

All data processing serves the following purposes:

- **Authentication:** Verifying your Discord identity to enforce role-based access control
- **Authorization:** Checking your Discord roles to determine which commands you may use
- **Command Execution:** Relaying your command to the Dune Console API and returning the result
- **Character Linking:** Associating your Discord account with your in-game character for player commands
- **Logging:** Recording command usage for cooldown enforcement and audit trails
- **Scheduled Updates:** Posting periodic server status to configured Discord channels

## 5. Data Storage

**All data is stored on your own infrastructure.** The Bot does not maintain any external databases, cloud storage, or third-party data repositories.

- **Configuration:** Stored in your `.env` file and Docker volumes
- **Character Links:** Stored on your Dune game server
- **Logs:** Written to your server's log files
- **Secrets:** Stored in files with 0600 permissions on your server

## 6. Data Sharing

**The Bot does not share your data with any third party.** Data flows only between:

1. Your Discord server (commands and responses)
2. The Bot process (running on your infrastructure)
3. Your Dune Docker Console API (running on your infrastructure)

No data is transmitted to the Bot developers, Funcom, Discord (beyond normal API interactions), or any other entity.

## 7. Data Retention

Data retention is controlled by you:

- **Character links:** Persist until the user unlinks or the server is reset
- **Command logs:** Retained according to your logging configuration
- **Scheduled posts:** Stored in Discord's infrastructure per Discord's retention policies

## 8. Your Rights

Since you control the infrastructure, you have full control over all data:

- **Access:** You can view all data stored on your server
- **Deletion:** You can delete any data by removing it from your server
- **Export:** You can export data from your server at any time
- **Correction:** You can modify any data stored on your server

For Discord users who are not server administrators, you may request data deletion from your server administrator.

## 9. Security

The Bot implements the following security measures:

- **Bearer-token authentication:** All API requests require a secret token
- **Role-based access control:** Commands are restricted by Discord role
- **Read-only by default:** Commands cannot modify server state
- **File-based secrets:** Tokens stored with 0600 permissions
- **No Docker socket access:** The Bot cannot control containers
- **No database access:** The Bot cannot directly query the game database
- **Security scanning:** Every code change is scanned for vulnerabilities

## 10. Children's Privacy

The Bot is not intended for children under 13. Discord's Terms of Service require users to be at least 13 years old. We do not knowingly collect data from children.

## 11. International Data Transfers

Since all data is stored on your own infrastructure, data does not leave your server unless you configure it to do so. Discord's own data processing is subject to Discord's Privacy Policy.

## 12. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be posted in the project repository. Continued use of the Bot after changes constitutes acceptance of the updated policy.

## 13. Contact

For privacy-related questions or requests, contact us via the project's [Discord server](https://discord.gg/9pQqytu6BU).

## 14. Acknowledgments

This Privacy Policy was drafted with reference to GDPR, CCPA, and Discord's Developer Privacy Policy requirements. It is intended to be clear, honest, and actionable.
