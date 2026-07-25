# Operator Validation

## Purpose

Operator validation is the R1.1 evidence path for proving the read-only bot can
be installed, registered, started, and exercised without changing server state.
It complements unit tests and security gates; it does not replace them.

Keep validation evidence free of secrets and PII. Do not paste `.env` files,
tokens, authorization headers, private server addresses, emails, SteamIDs,
FuncomIDs, real names, raw adapter responses, or screenshots that contain
sensitive data into issues, pull requests, release notes, or change notes.

## Required Evidence

For release-candidate or stable release validation, record:

- bot repository commit and tag candidate
- upstream reference commit and tag
- `npm run check` result
- `npm audit --audit-level=moderate` result
- GitHub CI and Security Gates result
- adapter smoke result
- command registration result in a test guild
- runtime command smoke result
- Docker start and healthcheck result when Docker is available
- known limitations or owner-approved deferrals

Use pass, fail, or deferred. A deferred item needs the reason, owner, and follow
up issue or release note.

## Local Adapter Smoke

Use the local mock when a live WebUI adapter is not available:

```bash
npm run mock:adapter
```

In a second terminal:

```bash
DUNE_CONSOLE_API_URL=http://127.0.0.1:8095 \
DUNE_DISCORD_ADAPTER_TOKEN=local-adapter-token \
npm run smoke:adapter
```

The smoke command calls the four current read-only adapter routes:

- `GET /api/integrations/discord/health`
- `POST /api/integrations/discord/status`
- `POST /api/integrations/discord/readiness`
- `POST /api/integrations/discord/services`

The command prints route-level pass/fail status only. It intentionally avoids
printing adapter response bodies. It fails if a response contains fields or
values that would be redacted before Discord output.

## Live Adapter Smoke

Use the operator-owned WebUI adapter only on a private network path:

```bash
DUNE_CONSOLE_API_URL=https://console.example.invalid \
DUNE_DISCORD_ADAPTER_TOKEN_FILE=/path/to/adapter-token \
npm run smoke:adapter
```

Use a token file when possible so tokens do not appear in shell history. If the
smoke command fails because the adapter response contains sensitive content,
treat that as a finding and review the adapter payload before widening access.

## Test Guild Registration

Use a test guild for fast command propagation:

```bash
DISCORD_GUILD_ID=your-test-guild-id npm run register
```

Expected result: Discord shows one `/dune` command with subcommand groups
`core`, `server`, `data`, `logs`, `ops`, `admin`, and `infra` (plus `write`
only when `DUNE_DISCORD_WRITES_ENABLED=true`). Run
`node -e "import('./src/commands.js').then(({commandDefinitions}) => console.log(JSON.stringify(commandDefinitions(), null, 2)))"`
against the commit under test to print the exact current subcommand list
instead of relying on a hand-maintained list here, since the surface grows
across releases.

Do not record real guild names, user names, role names, or screenshots that
identify people. Record only pass/fail and the commit under test.

## Runtime Command Smoke

Start the bot against the local mock or live adapter:

```bash
npm start
```

In the test guild, exercise at minimum one command per group:

- `/dune core about`
- `/dune core ping`
- `/dune server health`
- `/dune server status-summary`
- `/dune server readiness`
- `/dune server services`
- `/dune server maintenance` (unverified upstream route; expect either a
  maintenance status or an explicit "Unknown" state, never a false-positive
  "no maintenance scheduled")
- `/dune data population`
- `/dune infra version`

Use `/dune server status` only when the channel and RBAC settings are
appropriate for the returned status detail. Command output should be
ephemeral by default.

Commands under `logs`, `data` (linked-character routes), and any route marked
`UNMERGED_ROUTES` in `src/adapterClient.js` will return a specific "not yet
merged to upstream" message rather than live data until the console applies
the corresponding feature branch. That message is the expected pass result
for those commands, not a failure.

Expected result: commands complete without leaking tokens, authorization
headers, emails, SteamIDs, FuncomIDs, real names, private server addresses, or
raw adapter errors.

## Docker Smoke

When Docker is available:

```bash
docker compose -f docker-compose.example.yml up --build
```

After the bot reaches ready state:

```bash
docker inspect --format '{{json .State.Health}}' <container>
```

Expected result:

- container starts as a non-root runtime image
- root filesystem remains read-only
- Docker socket is not mounted
- healthcheck becomes healthy after Discord ready state is written

## Release Evidence Template

```text
Release candidate:
Bot commit:
Upstream commit and tag:
npm run check:
npm audit --audit-level=moderate:
GitHub CI:
GitHub Security Gates:
Adapter smoke:
Test guild command registration:
Runtime command smoke:
Docker start and healthcheck:
Findings or deferrals:
Owner approval:
```

## Go/No-Go

Do not promote a release candidate if:

- any medium, high, or critical security finding is unresolved
- adapter smoke reveals unredacted sensitive content
- command registration fails without a documented operator-specific cause
- runtime smoke leaks secrets or PII
- Docker smoke reveals new privileges, Docker socket access, or writable root
  filesystem
- upstream compatibility evidence is stale

## Sources

- Verification checklist: `docs/verification.md`
- Security gates: `docs/security-gates.md`
- Release process: `docs/release-process.md`
- Adapter contract: `docs/adapter-contract.md`
