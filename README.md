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

# 5. Start API (terminal 1)
pnpm --filter @visboard/api dev

# 6. Bootstrap workspace + get admin token (terminal 2)
pnpm --filter @visboard/cli exec visboard auth bootstrap --name "My Workspace"

# 7. Start web UI (terminal 3)
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
| `@visboard/db` | Drizzle ORM schema and migrations |
| `@visboard/agents-md` | AGENTS.md protocol generator |
| `@visboard/api` | Hono HTTP server |
| `@visboard/sdk` | TypeScript client |
| `@visboard/cli` | `visboard` command-line tool |
| `@visboard/web` | Next.js web UI |

## CLI examples

```bash
visboard auth bootstrap --name "Acme"
visboard project create --name "Pipeline" --slug pipeline
visboard note create --project pipeline --title "Spec" --file ./SPEC.md
visboard agent create --name "Reviewer" --scopes read,write:checklists --project pipeline
visboard context --project pipeline
visboard agents-md --project pipeline
```

## License

MIT — see [LICENSE](./LICENSE).
