# VisBoard

A shared workspace where agents and humans plan, write, and ship together.

**Phase 1:** OSS self-hosted only. See [SPEC.md](./SPEC.md) for the full implementation spec.

## Quick start

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16 (or Docker)

### Local development

```bash
# 1. Install and build
pnpm install
pnpm build

# 2. Start Postgres (Docker)
docker compose up -d postgres

# 3. Configure environment
cp .env.example .env

# 4. Migrate database
pnpm --filter @visboard/db db:migrate

# 5. (Optional) Seed demo workspace — or bootstrap for a PAT
pnpm --filter @visboard/db db:seed
# Preferred for admin token:
pnpm --filter @visboard/cli exec visboard auth bootstrap --name "My Workspace"

# 6. Start API (terminal 1)
pnpm --filter @visboard/api dev

# 7. Start web UI (terminal 2)
pnpm --filter @visboard/web dev
```

Open http://localhost:3000 — paste your PAT in Settings.

### Docker (full stack)

```bash
docker compose up -d
pnpm --filter @visboard/db db:migrate   # against localhost:5432
```

### Smoke test

With API running on port 8080:

```bash
chmod +x scripts/smoke.sh
./scripts/smoke.sh
```

## Packages

| Package | Description |
|---------|-------------|
| `@visboard/shared` | Zod schemas, IDs, scopes, event types |
| `@visboard/db` | Drizzle ORM schema, migrations, seed |
| `@visboard/agents-md` | AGENTS.md protocol generator |
| `@visboard/api` | Hono HTTP server |
| `@visboard/sdk` | TypeScript client |
| `@visboard/cli` | `visboard` command-line tool |
| `@visboard/web` | Next.js web UI |
| `@visboard/mcp` | MCP server for Cursor / Claude Desktop |

## Features

- **Workspaces & projects** — multi-project boards with slug-based routing
- **Notes** — markdown notes with frontmatter, versioning, and ETag concurrency
- **Checklists** — task lists with assignees and agent check/uncheck
- **Files** — local filesystem uploads per project
- **Agents** — scoped API keys for autonomous agents
- **AGENTS.md** — auto-generated agent protocol per project
- **Context API** — compact project snapshot for agents (`/context`, `/agents.md`)
- **Events** — append-only activity log with polling and **SSE stream** (`/events/stream`)
- **Export / import** — zip workspace export and roundtrip import (`visboard export`, `visboard import`)
- **Auth** — PAT + agent keys; bootstrap for first install
- **OpenAPI** — full REST spec at [`openapi/openapi.yaml`](./openapi/openapi.yaml)

## MCP server

The `@visboard/mcp` package exposes VisBoard to MCP-compatible clients (Cursor, Claude Desktop).

```bash
# Build and run (stdio transport)
pnpm --filter @visboard/mcp build
VISBOARD_TOKEN=vb_pat_... VISBOARD_BASE_URL=http://localhost:8080/v1 \
  pnpm --filter @visboard/mcp exec visboard-mcp
```

Configure in your MCP client with env vars `VISBOARD_TOKEN`, `VISBOARD_BASE_URL`, and optional `VISBOARD_WORKSPACE`.

## CLI examples

```bash
visboard auth bootstrap --name "Acme"
visboard project create --name "Pipeline" --slug pipeline
visboard note create --project pipeline --title "Spec" --file ./SPEC.md
visboard agent create --name "Reviewer" --scopes read,write:checklists --project pipeline
visboard context --project pipeline
visboard agents-md --project pipeline
visboard export --workspace acme --out ./export.zip
visboard import --file ./export.zip --slug acme-copy --name "Acme Copy"
```

## API documentation

- OpenAPI 3.1 spec: [`openapi/openapi.yaml`](./openapi/openapi.yaml)
- Base URL: `http://localhost:8080/v1`
- Errors: RFC 7807 `application/problem+json`

## License

MIT — see [LICENSE](./LICENSE).
