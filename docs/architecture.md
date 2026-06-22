# Design and Architecture

## Overview

The Discord bot lives in its own repository so the Dune console remains the
safety boundary. Version 1 is read-only. It uses Discord slash commands to ask
the console adapter for health, status, readiness, and service state.

The bot does not need Docker socket access, database credentials, shell access,
or mounted game files. It only needs the disabled-by-default, bearer-token
protected adapter API.

## Runtime Flow

Runtime flow:

1. A Discord user runs `/dune health`, `/dune status`, `/dune readiness`, or
   `/dune services`.
2. The bot checks the optional Discord role allow-list.
3. The bot sends a bearer-token authenticated request to the configured console
   adapter endpoint.
4. The console adapter returns JSON.
5. The bot redacts credential-shaped keys, bounds the Discord message length,
   and posts the response.

```mermaid
flowchart LR
  User["Discord user"] --> Bot["Discord bot runtime"]
  Bot --> Guard["Optional Discord role allow-list"]
  Guard --> Client["Adapter client"]
  Client --> Adapter["Console Discord adapter API"]
  Adapter --> Console["Dune console safe boundary"]
  Client --> Redaction["Redaction and Discord formatting"]
  Redaction --> User
```

## Boundaries

- This repository owns command registration, Discord runtime,
  formatting, deployment docs, and tests.
- Console repository owns the read-only adapter API and any internal decisions
  about how health/status/readiness/services are gathered.
- The bot never calls Docker, never connects to the Dune database, and never
  executes console commands.

## Adapter Contract

The defaults are configurable:

| Function | Default method | Default path |
| --- | --- | --- |
| Health | `GET` | `/api/integrations/discord/health` |
| Status | `POST` | `/api/integrations/discord/status` |
| Readiness | `POST` | `/api/integrations/discord/readiness` |
| Services | `POST` | `/api/integrations/discord/services` |

Each request includes `Authorization: Bearer <token>`. `POST` requests include
minimal actor context:

```json
{
  "actor": {
    "userId": "discord-user-id",
    "guildId": "discord-guild-id",
    "channelId": "discord-channel-id",
    "roleIds": ["discord-role-id"]
  }
}
```

The bot accepts JSON from the adapter and does not depend on console internals.

## Security Controls

- Read-only command surface.
- Bearer-token authentication to the console adapter.
- Optional Discord role allow-list.
- Credential-shaped keys are redacted before Discord output.
- Docker example runs with read-only filesystem, no new privileges, and dropped
  Linux capabilities.
- No Docker socket, DB credentials, raw command execution, or game-file mounts.

## Unit Testing

The package uses Node's built-in test runner:

```bash
npm test
```

Current coverage focuses on:

- Safe configuration defaults and validation.
- Adapter request method/path/auth behavior.
- HTTP error handling.
- Secret redaction and Discord message limits.
- Read-only slash command definitions and role checks.
