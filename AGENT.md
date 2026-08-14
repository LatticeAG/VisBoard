# AGENT.md

Contributor conventions for VisBoard.

## Toolchain

- Node 22+
- pnpm 9.15.0 (`packageManager` in the root `package.json`)
- PostgreSQL 16 (SQLite is not supported)
- TypeScript, turbo, Biome

## Commands

```bash
pnpm install
pnpm --filter @visboard/db db:migrate
pnpm lint
pnpm typecheck
pnpm test
pnpm --filter @visboard/api start
./scripts/smoke.sh
```

Never commit `.env`. Copy `.env.example` and set `VISBOARD_TOKEN_PEPPER` to at least 32 characters.

## API split

- `/v1`: workspaces, projects, notes, checklists, files, agents, events, context, bootstrap
- `/v2`: boards, handoffs, templates, automations, integrations
- `/health` and `/readyz` live on the process origin (`http://localhost:8080`), not under `/v1`

HMAC pepper hashing is HMAC-SHA-256, not `sha256(token + pepper)`.

Boards in this cycle are command-and-revision, not live CRDT collaboration. Do not treat a board as a shared Yjs document.

## Smoke

`scripts/smoke.sh` expects `API_BASE_URL` (default `http://localhost:8080`) and a reachable `/readyz`. CI starts the API, waits for readiness, then runs that script.
