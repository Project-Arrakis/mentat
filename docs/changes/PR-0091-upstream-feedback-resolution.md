# PR Change Summary — Upstream Feedback Resolution

## Addressed Items from Red-Blink/dune-awakening-selfhost-docker#91

### 1. Character Linking Ownership Verification ✅

**Problem:** `/dune data link <character-name>` accepted any character name without proving the Discord user owns that character.

**Solution:** Two-step verification flow:
- **Primary:** Discord's verified Steam connection — the adapter checks the user's Discord-connected Steam account against the console's connected player list
- **Fallback:** RCON whisper verification — the adapter sends a 6-character code to the character in-game, the user reads it and submits it via `/dune data verify <code>`

**Commands:**
- `/dune data link <character-name>` — initiates link, returns verification code
- `/dune data verify <code>` — completes link after code verification

### 2. Unique Constraint on player_controller_id ✅

**Problem:** The `discord_player_links` table had no unique constraint on `player_controller_id`, allowing one character to be linked to multiple Discord accounts.

**Solution:** Added `unique` constraint to `player_controller_id` column in `dune.discord_player_links` table. The `discordPlayerLink` function now uses a single `INSERT ... ON CONFLICT (discord_user_id)` statement, making the operation atomic and preventing duplicate links.

### 3. Broadcast Route Returns Planned Stub ✅

**Problem:** `admin:broadcast` returned a planned placeholder instead of sending the broadcast.

**Solution:** Moved `broadcast` to `PLANNED_ROUTES` in `adapterClient.js`. The bot will now show the "planned" status when this command is used, accurately reflecting the upstream state.

### 4. Invalid/Incomplete Commands ✅

**Problem:** `dune logs` had no service parameter, `dune maintenance` route doesn't exist.

**Solution:**
- Removed `dune data maintenance` subcommand entirely
- Replaced single `dune logs` with a `logs` command group with per-container subcommands:
  - `/dune logs dune-cache`
  - `/dune logs dune-generated`
  - `/dune logs dune-server`
  - `/dune logs dune-steam`
  - `/dune logs dune-work`
  - `/dune logs orchestrator`
  - `/dune logs redblink-dune-docker-console`

### 5. Log Output Sanitization ✅

**Problem:** Log output must be sanitized before being returned through Discord.

**Solution:** All command output now passes through `redactSecrets()` before being sent to Discord. This redacts:
- Bearer tokens and API keys
- Email addresses
- Steam IDs (64, 2, and 3 formats)
- Funcom IDs
- Real names
- Any field matching credential key patterns

### 6. "Read-Only" Wording ✅

**Problem:** The bot described itself as "read-only" but linking creates and modifies database records.

**Solution:** Updated `aboutPayload` to report `readOnly: false` instead of `readOnly: true`. Documentation updated to reflect that the bot is read-only for server observability but supports write operations for player linking.

---

## Detailed Player Link Flow

### Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Discord   │────▶│  ACP Bot     │────▶│  Dune Console   │
│   User      │     │  (OCI)       │     │  Adapter        │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │                      │
                           │                      ▼
                           │              ┌─────────────────┐
                           │              │  Game Server    │
                           │              │  (RCON Whisper) │
                           │              └─────────────────┘
                           ▼
                    ┌──────────────┐
                    │  Cloudflare  │
                    │  KV (stats)  │
                    └──────────────┘
```

### Step-by-Step Flow

#### Step 1: User Initiates Link
```
User: /dune data link MyCharacter
```

1. Bot receives slash command with `character` parameter
2. Bot calls `adapterClient.playerLink(actor, characterName, guildId)`
3. Adapter receives `POST /api/integrations/discord/players/link` with `{ actor, characterName }`
4. Adapter resolves character name to `player_controller_id` via `resolvePlayerByName()`
5. **Primary verification:** Adapter checks if the Discord user has a verified Steam connection linked in Discord Settings → Connections
   - If Steam ID matches the connected player's Steam ID → link completes immediately
   - If no Steam connection or mismatch → proceed to fallback
6. **Fallback verification:** Adapter generates a 6-character code (e.g., `ACP-7X9K2`)
   - Code stored in pending links table with 5-minute expiry
   - Adapter sends RCON whisper to the character in-game: *"Your ACP verification code is: ACP-7X9K2"*
   - Returns `{ ok: true, pending: true, message: "Check in-game for your verification code" }`

#### Step 2: User Verifies Link
```
User: /dune data verify ACP-7X9K2
```

1. Bot receives slash command with `code` parameter
2. Bot calls `adapterClient.playerLinkVerify(actor, code, guildId)`
3. Adapter receives `POST /api/integrations/discord/players/link/verify` with `{ actor, code }`
4. Adapter validates:
   - Code exists in pending links table
   - Code hasn't expired (5-minute window)
   - Code matches the character that received the RCON whisper
5. If valid:
   - Inserts into `discord_player_links` with unique constraints on both `discord_user_id` (primary key) and `player_controller_id` (unique)
   - Returns `{ ok: true, linked: true, character: "MyCharacter" }`
6. If invalid:
   - Returns `{ ok: false, error: "Invalid or expired code" }`

### Database Schema

```sql
create table if not exists dune.discord_player_links (
  discord_user_id text primary key,
  player_controller_id text not null unique,
  linked_at timestamp with time zone default now()
);
```

**Constraints:**
- `discord_user_id` PRIMARY KEY — one Discord account = one link
- `player_controller_id` UNIQUE — one character = one Discord account
- Both constraints enforced at the database level, preventing duplicate or conflicting links

### Security Properties

1. **No public info bypass:** Steam IDs, friend lists, and character names are all publicly visible. Neither can be used alone to prove ownership.
2. **RCON whisper is private:** Only the player actually controlling that character sees the whisper message.
3. **Codes expire:** 5-minute window prevents replay attacks.
4. **Unique constraints:** Database-level enforcement prevents one character from being linked to multiple Discord accounts, or one Discord account from linking to multiple characters.
5. **Atomic operations:** `INSERT ... ON CONFLICT` ensures the link operation is transactional — no race conditions where two users could claim the same character simultaneously.
