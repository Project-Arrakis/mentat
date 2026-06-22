# Support

## Before Opening an Issue

Start with:

- `README.md`
- `SECURITY.md`
- `docs/discord-setup.md`
- `docs/networking.md`
- `docs/configuration.md`
- `docs/verification.md`

## What to Include

For setup or runtime issues, include:

- commit SHA or release version
- host type, such as WSL, Docker Compose, or Linux server
- Node.js version if running outside Docker
- whether the WebUI adapter is reachable from the bot host
- the command you ran, with secrets removed
- relevant logs, with secrets removed

## What Not to Include

Do not post:

- Discord bot tokens
- WebUI adapter bearer tokens
- `.env` files
- screenshots showing secrets
- public IPs or private server addresses unless you mean to make them visible

## Security Issues

Do not open public issues for suspected vulnerabilities or leaked secrets. See
`SECURITY.md`.
