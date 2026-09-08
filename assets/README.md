# Bot Assets

## Icon (Discord Bot Avatar)

| File | Size | Use |
|------|------|-----|
| `bot-icon-1024.png` | 1.3 MB | Discord Developer Portal → Bot → Avatar |
| `bot-icon-256.png` | 106 KB | Thumbnails |
| `bot-icon.ico` | 106 KB | Windows icon |

## Banner

| File | Size | Use |
|------|------|-----|
| `bot-banner-960.png` | 766 KB | Discord server banner (960×540) |
| `bot-banner-docs.png` | 1.9 MB | README, docs, RFC, roadmap |
| `bot-banner.png` | 2.0 MB | Original source (1672×941) |

## QR Codes

| File | Use |
|------|-----|
| `qr/invite-hosted.svg` | Scannable QR for the hosted bot's Discord invite link — embedded in `docs/installation-guide.md` and (as an identical copy) `mentat-link`'s homepage |

**Regenerating:** run `scripts/generate-invite-qr.sh` — it also decodes its
own output back to plaintext and fails loudly if the result doesn't match
the intended URL exactly, so a bad regeneration can't silently ship. Only
re-run this if the hosted invite URL's `client_id`, `scope`, or
`permissions` value ever changes (see `src/commands.js`'s `setupPayload()`
for the current, real invite URL this asset must match). If you do
regenerate it, also copy the new file to `mentat-link`'s own `qr/`
directory to keep both copies in sync (same convention as
`public/js/sand.js`).

## Updating

### Discord Bot Avatar
1. Go to https://discord.com/developers/applications → your app → Bot
2. Under Display Name, click the avatar circle
3. Upload `bot-icon-1024.png`

### Discord Server Banner
1. Go to your server → Server Settings → Overview
2. Upload `bot-banner-960.png`
