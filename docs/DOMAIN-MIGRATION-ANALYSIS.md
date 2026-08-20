# Domain Migration Analysis: Moving to app.dunedocker.app

**Scenario:** Both landing page (acp.darkdante.org) and setup portal (acp-setup.darkdante.org) move to a unified domain at app.dunedocker.app

**Scope:** What changes needed in arrakis-control-panel code

---

## Current Architecture

### Current URLs
- **Bot API:** `acp-bot.darkdante.org` (bot VM, our code)
- **Setup Portal:** `acp-setup.darkdante.org` (bot VM, serves OAuth callback + config form)
- **Landing Page:** `acp.darkdante.org` (separate deployment, acp-landing repo)
- **Steam Link:** `acp-setup.darkdante.org/steam-link/*` (bot VM)

### Current DNS/Routing
- `acp-setup.darkdante.org` → bot VM (192.168.22.10)
- `acp.darkdante.org` → separate landing page host
- `acp-landing.pages.dev` → Cloudflare Pages fallback

---

## Proposed Migration

**New URLs (all on app.dunedocker.app):**
- Landing page: `https://app.dunedocker.app/`
- Setup portal: `https://app.dunedocker.app/setup`
- Steam link: `https://app.dunedocker.app/steam-link/*`
- Bot API: `https://app.dunedocker.app/api/*`

---

## Required Changes in arrakis-control-panel

### 1. CORS Configuration (`src/setupServer.js`)

**Current (lines 83-88):**
```javascript
const ALLOWED_ORIGINS = [
  "https://acp.darkdante.org",
  "https://acp-landing.pages.dev",
  "http://localhost:5173",
  "http://localhost:3000"
];
```

**Change Required:**
```javascript
const ALLOWED_ORIGINS = [
  "https://app.dunedocker.app",
  "http://localhost:5173",
  "http://localhost:3000"
];
```

**Impact:** Landing page fetch requests to `/api/commands` will still work (same origin, no CORS needed)

---

### 2. Setup URL Configuration (`src/onboarding.js`)

**Current (line 5):**
```javascript
const SETUP_URL = process.env.ACP_SETUP_URL || process.env.ACP_BASE_URL || "http://localhost:3100";
```

**Change Required:** Update the default or set environment variable:
```javascript
const SETUP_URL = process.env.ACP_SETUP_URL || process.env.ACP_BASE_URL || "https://app.dunedocker.app";
```

**Or via environment (preferred):**
```bash
ACP_SETUP_URL=https://app.dunedocker.app
```

**Impact:** The setup whisper DM will link to `https://app.dunedocker.app/setup?guildId=...` instead of `acp-setup.darkdante.org`

---

### 3. OAuth Redirect URI (`src/setupServer.js`)

**Current (line 97):**
```javascript
const redirectUri = config.oauthRedirectUri || `${config.baseUrl}/oauth/callback`;
```

**Change Required:** Update Discord application settings to accept:
```
https://app.dunedocker.app/oauth/callback
```

**Impact:** Discord OAuth flow will redirect to new URL. Must update Discord Developer Portal.

**Check:** Look for where `config.oauthRedirectUri` is loaded:

---

### 4. Steam Link Configuration (`src/config.js`)

**Current (approximately line for STEAM_LINK_BASE_URL):**
```javascript
steamLink: {
  baseUrl: optionalEnv(env, "ACP_STEAM_LINK_BASE_URL") || optionalEnv(env, "ACP_BASE_URL") || "http://localhost:3101"
}
```

**Change Required:** Update environment:
```bash
ACP_STEAM_LINK_BASE_URL=https://app.dunedocker.app
```

**Impact:** Steam link return URLs will point to `https://app.dunedocker.app/steam-link/callback` instead of acp-setup.darkdante.org

---

## Files That Need Changes

| File | Lines | Change Type | Environment Var | Manual Update |
|------|-------|------------|-----------------|---------------|
| `src/setupServer.js` | 83-88 | CORS hardcode | ❌ No | ✅ Yes (or via env) |
| `src/setupServer.js` | 97 | Redirect URI | ✅ Yes (oauthRedirectUri) | ✅ Discord Portal |
| `src/onboarding.js` | 5 | Setup URL default | ✅ Yes (ACP_SETUP_URL) | ✅ Yes |
| `src/config.js` | ~line 170+ | Steam link URL | ✅ Yes (ACP_STEAM_LINK_BASE_URL) | ⚠️ Check config |

---

## Configuration Changes Needed (Env Vars)

**On bot VM (.env file), add/update:**
```bash
# Current (update domain)
ACP_BASE_URL=https://app.dunedocker.app

# Explicit overrides (recommended)
ACP_SETUP_URL=https://app.dunedocker.app
ACP_STEAM_LINK_BASE_URL=https://app.dunedocker.app
ACP_OAUTH_REDIRECT_URI=https://app.dunedocker.app/oauth/callback
```

---

## External Configuration Changes

### 1. Discord Developer Portal
**Location:** https://discord.com/developers/applications/1516816812006969494/oauth2

**Change:**
- Remove: `https://acp-setup.darkdante.org/oauth/callback`
- Add: `https://app.dunedocker.app/oauth/callback`

**Test:** Run `/setup` command to verify OAuth flow

### 2. DNS/Routing
**Current:**
- `acp-setup.darkdante.org` → bot VM
- `acp.darkdante.org` → landing page host

**New:**
- `app.dunedocker.app` → bot VM (for `/oauth`, `/setup`, `/steam-link`, `/api`)
- `app.dunedocker.app` → also serve landing page (static files)

**Options:**
1. **Subdomain routing:**
   - `app.dunedocker.app/` → landing page (static or Node)
   - `app.dunedocker.app/api/*` → bot API (existing setupServer)
   - `app.dunedocker.app/setup` → OAuth callback (existing)
   
2. **Reverse proxy setup:**
   - Nginx/HAProxy routes paths to appropriate backend
   - Landing page static files served from same origin

### 3. acp-landing Repository
**Change:** Deploy landing page to serve from `https://app.dunedocker.app/` instead of `acp.darkdante.org`

**Possible solutions:**
- Serve landing page from Node.js on bot VM (add express.static("landing-dist"))
- Or: Nginx reverse proxy with two backends
- Or: Cloudflare Pages with CNAME to `app.dunedocker.app`

---

## Migration Checklist

### Code Changes (arrakis-control-panel)
- [ ] Update CORS origins in `src/setupServer.js` (lines 83-88)
- [ ] Update default setup URL in `src/onboarding.js` (line 5) OR rely on env var
- [ ] Verify `ACP_OAUTH_REDIRECT_URI` is properly read in `src/config.js`
- [ ] Ensure steam link base URL is configurable via `ACP_STEAM_LINK_BASE_URL`

### Configuration (Bot VM .env)
- [ ] Set `ACP_BASE_URL=https://app.dunedocker.app`
- [ ] Set `ACP_SETUP_URL=https://app.dunedocker.app`
- [ ] Set `ACP_STEAM_LINK_BASE_URL=https://app.dunedocker.app`
- [ ] Set `ACP_OAUTH_REDIRECT_URI=https://app.dunedocker.app/oauth/callback`

### External (One-time)
- [ ] Update Discord Developer Portal OAuth redirect URI
- [ ] Update DNS to route `app.dunedocker.app` to bot VM
- [ ] Deploy landing page to `app.dunedocker.app` (or set up reverse proxy)
- [ ] Test OAuth flow end-to-end
- [ ] Test setup whisper (verify link in DM points to new URL)
- [ ] Test steam link callback

### Testing
- [ ] `/setup` command in Discord → verify setup link points to `https://app.dunedocker.app/setup`
- [ ] Click setup link → OAuth redirects to `https://app.dunedocker.app/oauth/callback`
- [ ] Complete setup → redirects to `https://app.dunedocker.app/setup/success`
- [ ] `/dune admin sync-commands` → still works
- [ ] Steam link flow → redirects to new domain

---

## Impact Assessment

### No Changes Needed
- Registry loading (Phase 3) - independent of domain
- Command execution - uses Discord, not web
- Bot authentication - uses Discord token

### Minor Changes (Code)
- CORS configuration (1 place)
- Setup URL default (1 place)

### Major Changes (Infrastructure)
- DNS routing
- Discord Developer Portal
- Potentially landing page deployment strategy

---

## Minimal Code Changes Required

**Estimate:** 2-3 lines of code change, primarily in setupServer.js

```diff
# src/setupServer.js
- const ALLOWED_ORIGINS = [
-   "https://acp.darkdante.org",
-   "https://acp-landing.pages.dev",
+ const ALLOWED_ORIGINS = [
+   "https://app.dunedocker.app",
    "http://localhost:5173",
    "http://localhost:3000"
  ];
```

**Everything else should be handled via environment variables** that already exist in the code.

---

## Recommendation

1. **Add these to bot VM .env immediately:**
   ```bash
   ACP_SETUP_URL=https://app.dunedocker.app
   ACP_STEAM_LINK_BASE_URL=https://app.dunedocker.app
   ```

2. **Update CORS in code** (1-line change in setupServer.js)

3. **Plan infrastructure:** How will landing page and bot API coexist on same domain?
   - Option A: Reverse proxy (Nginx/HAProxy)
   - Option B: Serve landing page from bot VM (add Express static)
   - Option C: Deploy landing page separately, set CNAME

4. **Update Discord Developer Portal** (one-time, no code)

5. **Test end-to-end** (setup whisper → OAuth → success page)

---

## Summary

**Code changes required:** ~5-10 lines  
**Configuration changes:** 4 environment variables  
**Infrastructure changes:** DNS, Discord Portal, potentially reverse proxy  
**Risk level:** Low (all changes are cosmetic URLs, no logic changes)  
**Rollback:** Revert env vars and Discord Portal settings

The codebase is already well-designed for this migration — everything is configurable via environment variables.

