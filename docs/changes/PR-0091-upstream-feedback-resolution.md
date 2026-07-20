# PR Change Summary — Upstream Feedback Resolution

## Addressed Items from Red-Blink/dune-awakening-selfhost-docker#91

### 1. Character Linking Ownership Verification ✅

**Problem:** `/dune data link <character-name>` accepted any character name without proving the Discord user owns that character.

**Solution:** In-game whisper verification flow:
- The adapter generates a 6-character code (e.g., `ACP-7X9K2`) and sends it via RabbitMQ whisper to the character in-game. The user reads it and submits it via `/dune data verify <code>`.

**Commands:**
- `/dune data link <character-name>` — initiates link, returns verification code
- `/dune data verify <code>` — completes link after code verification

**Implementation Details:**
- New `discord_pending_links` table stores codes with 5-minute expiry
- `resolvePlayerByName()` returns player record for whisper targeting
- `publishCarePackageWhisper()` sends codes through RabbitMQ `chat.whispers` exchange
- Codes are uppercase alphanumeric (`ACP-XXXXXX` format)
- `consumePendingLink()` atomically deletes and returns the pending link on verification

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
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │  RabbitMQ       │
                                       │  (chat.whispers)│
                                       └─────────────────┘
                                                │
                                                ▼
                                       ┌─────────────────┐
                                       │  Game Server    │
                                       │  (Whisper Msg)  │
                                       └─────────────────┘
```

### Step-by-Step Flow

#### Step 1: User Initiates Link
```
User: /dune data link MyCharacter
```

1. Bot receives slash command with `character` parameter
2. Bot calls `adapterClient.playerLink(actor, characterName, guildId)`
3. Adapter receives `POST /api/integrations/discord/players/link` with `{ actor, characterName }`
4. Adapter resolves character name via `resolvePlayerByName()`, returning `player_controller_id`, `funcom_id`, and `fls_id`
5. Adapter generates a 6-character code (e.g., `ACP-7X9K2`)
   - Code stored in `discord_pending_links` table with 5-minute expiry
   - Adapter sends RabbitMQ whisper to the character in-game via `publishCarePackageWhisper()`: *"Your ACP verification code is: ACP-7X9K2. Use /dune data verify ACP-7X9K2 to link your character."*
   - Returns `{ ok: true, pending: true, code: "ACP-7X9K2", message: "Check in-game whispers for your code." }`

#### Step 2: User Verifies Link
```
User: /dune data verify ACP-7X9K2
```

1. Bot receives slash command with `code` parameter
2. Bot calls `adapterClient.playerLinkVerify(actor, code, guildId)`
3. Adapter receives `POST /api/integrations/discord/players/link/verify` with `{ actor, code }`
4. Adapter validates:
   - Code exists in `discord_pending_links` table
   - Code hasn't expired (5-minute window)
   - Code's `discord_user_id` matches the requesting user
5. If valid:
   - Atomically deletes the pending link via `consumePendingLink()`
   - Inserts into `discord_player_links` with unique constraints on both `discord_user_id` (primary key) and `player_controller_id` (unique)
   - Returns `{ ok: true, linked: true, character: "MyCharacter" }`
6. If invalid:
   - Returns `{ ok: false, error: "Invalid or expired verification code" }`

### Database Schema

```sql
create table if not exists dune.discord_player_links (
  discord_user_id text primary key,
  player_controller_id text not null unique,
  linked_at timestamp with time zone default now()
);

create table if not exists dune.discord_pending_links (
  code text primary key,
  discord_user_id text not null,
  player_controller_id text not null,
  character_name text not null,
  funcom_id text,
  fls_id text,
  created_at timestamp with time zone default now(),
  expires_at timestamp with time zone not null
);
```

**Constraints:**
- `discord_player_links.discord_user_id` PRIMARY KEY — one Discord account = one link
- `discord_player_links.player_controller_id` UNIQUE — one character = one Discord account
- `discord_pending_links.code` PRIMARY KEY — unique verification codes
- Both constraints enforced at the database level, preventing duplicate or conflicting links

### Security Properties

1. **Whisper is private:** Only the player actually controlling that character sees the whisper message sent via RabbitMQ `chat.whispers` exchange.
2. **Codes expire:** 5-minute window prevents replay attacks.
3. **Unique constraints:** Database-level enforcement prevents one character from being linked to multiple Discord accounts, or one Discord account from linking to multiple characters.
4. **Atomic operations:** `INSERT ... ON CONFLICT` ensures the link operation is transactional — no race conditions where two users could claim the same character simultaneously.
5. **Code ownership:** Pending links store the `discord_user_id` that generated them. Verification fails if a different user tries to use the code.
6. **Single-use codes:** `consumePendingLink()` atomically deletes the code on successful verification, preventing reuse.
