# VisBoard — OSS Implementation Spec

**Version:** 0.3 (OSS-first, implementation-ready)  
**Status:** Building Phase 1 (OSS only)  
**Series:** Vis (interface / workspace)  
**Owner:** LatticeAG  
**License:** MIT  
**Tagline:** A shared workspace where agents and humans plan, write, and ship together.

---

## 0. Scope Decision: OSS First

### What we are building now (Phase 1)

**Open-source, self-hosted VisBoard only.** No hosted SaaS, no billing, no invite system, no Clerk/Auth0 integration in this phase.

| In scope (OSS Phase 1) | Deferred (Phase 2+ / SaaS) |
|---|---|
| Monorepo + Docker Compose | Hosted multi-tenant SaaS |
| Hono API server | Vercel Fluid Compute deployment |
| PostgreSQL + Drizzle | Neon managed hosting |
| Local filesystem file storage | Vercel Blob / S3 production config |
| Personal access tokens + agent API keys | OIDC/SSO (Clerk, WorkOS) |
| CLI (`visboard`) | npm publish (local `pnpm link` first) |
| TypeScript SDK | MCP server |
| Minimal Next.js web UI | Marketing site |
| AGENTS.md generator | Real-time SSE/WebSocket |
| Export (JSON + files zip) | Import, billing, invites |
| OpenAPI spec | Playwright e2e (Vitest unit tests first) |

### Long-term business model (context only — not building now)

**Hybrid** remains the north star: MIT OSS core + optional LatticeAG-hosted SaaS later. Phase 1 proves the agent-human loop on self-host before any hosted layer.

---

## 1. Problem & Product

Humans and agents need a **shared, structured, permissioned workspace** for plans, notes, checklists, and files — with an API agents treat as ground truth and a UI humans can trust.

**VisBoard is:** shared context board, `AGENTS.md` protocol, event stream, API-native.  
**VisBoard is not:** Notion clone, agent runtime, chat UI, issue tracker.

---

## 2. Phase 1 Success Criteria

Phase 1 is done when the **MVP smoke test** (§32) passes entirely via:

```bash
docker compose up -d
pnpm install && pnpm build
pnpm --filter @visboard/api db:migrate
pnpm --filter @visboard/cli dev auth bootstrap   # creates admin token
# ... smoke test steps
```

**Definition of done per package:**

| Package | Done when |
|---|---|
| `@visboard/shared` | Zod schemas export; unit tests pass |
| `@visboard/db` | Migrations apply cleanly; seed script works |
| `@visboard/agents-md` | Generates canonical AGENTS.md from fixture data |
| `@visboard/api` | All §10 endpoints return correct shapes; auth enforced |
| `@visboard/sdk` | Typed client covers all endpoints |
| `@visboard/cli` | All §11 commands work against local API |
| `@visboard/web` | Dashboard + project 3-pane + editor renders |

---

## 3. Repository Layout (exact)

```
visboard/
├── SPEC.md                          # This file
├── LICENSE                          # MIT
├── README.md
├── package.json                     # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json
├── biome.json
├── tsconfig.base.json
├── .env.example
├── docker-compose.yml
├── .github/workflows/ci.yml
│
├── apps/
│   ├── api/                         # Hono HTTP server
│   │   ├── package.json             # name: @visboard/api
│   │   ├── tsconfig.json
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts             # entry: serve on PORT
│   │       ├── app.ts               # Hono app + middleware
│   │       ├── env.ts               # Zod-validated env
│   │       ├── db.ts                # drizzle client singleton
│   │       ├── auth/
│   │       │   ├── middleware.ts    # Bearer token resolution
│   │       │   ├── tokens.ts        # hash/verify PAT + agent keys
│   │       │   └── scopes.ts        # scope checking helpers
│   │       ├── routes/
│   │       │   ├── health.ts
│   │       │   ├── workspaces.ts
│   │       │   ├── projects.ts
│   │       │   ├── notes.ts
│   │       │   ├── checklists.ts
│   │       │   ├── files.ts
│   │       │   ├── agents.ts
│   │       │   ├── events.ts
│   │       │   └── context.ts       # /context + /agents.md
│   │       ├── services/
│   │       │   ├── workspace.ts
│   │       │   ├── project.ts
│   │       │   ├── note.ts
│   │       │   ├── checklist.ts
│   │       │   ├── file.ts
│   │       │   ├── agent.ts
│   │       │   ├── event.ts
│   │       │   ├── agents-md-sync.ts
│   │       │   └── export.ts
│   │       └── lib/
│   │           ├── errors.ts        # RFC 7807 problem+json
│   │           ├── pagination.ts
│   │           ├── ids.ts             # prefixed ID generation
│   │           └── storage.ts         # local FS adapter
│   │
│   └── web/                         # Next.js 15 App Router
│       ├── package.json             # name: @visboard/web
│       ├── next.config.ts
│       ├── tailwind.config.ts
│       └── src/
│           ├── app/
│           │   ├── layout.tsx
│           │   ├── page.tsx           # redirect → /app
│           │   ├── globals.css
│           │   └── app/
│           │       ├── layout.tsx     # app shell
│           │       ├── page.tsx       # workspace picker
│           │       └── [ws]/
│           │           ├── page.tsx   # dashboard
│           │           └── projects/[p]/
│           │               └── page.tsx  # 3-pane project view
│           ├── components/
│           │   ├── sidebar.tsx
│           │   ├── note-editor.tsx
│           │   ├── markdown-preview.tsx
│           │   ├── activity-stream.tsx
│           │   ├── checklist-view.tsx
│           │   └── file-list.tsx
│           └── lib/
│               ├── api-client.ts      # fetch wrapper using SDK
│               └── auth.ts            # token from localStorage
│
├── packages/
│   ├── shared/                      # @visboard/shared
│   │   └── src/
│   │       ├── index.ts
│   │       ├── ids.ts               # prefix constants + validators
│   │       ├── scopes.ts
│   │       ├── events.ts            # event type enum
│   │       └── schemas/             # Zod schemas per resource
│   │           ├── workspace.ts
│   │           ├── project.ts
│   │           ├── note.ts
│   │           ├── checklist.ts
│   │           ├── file.ts
│   │           ├── agent.ts
│   │           ├── event.ts
│   │           └── common.ts
│   │
│   ├── db/                          # @visboard/db
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts
│   │       ├── schema/
│   │       │   ├── index.ts
│   │       │   ├── workspaces.ts
│   │       │   ├── users.ts
│   │       │   ├── tokens.ts
│   │       │   ├── projects.ts
│   │       │   ├── notes.ts
│   │       │   ├── checklists.ts
│   │       │   ├── files.ts
│   │       │   ├── agents.ts
│   │       │   └── events.ts
│   │       ├── migrations/          # drizzle-kit output
│   │       └── seed.ts
│   │
│   ├── agents-md/                   # @visboard/agents-md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── generate.ts
│   │       ├── parse-version.ts
│   │       └── templates.ts
│   │
│   ├── sdk/                         # @visboard/sdk
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts
│   │       └── resources/
│   │           ├── workspaces.ts
│   │           ├── projects.ts
│   │           ├── notes.ts
│   │           ├── checklists.ts
│   │           ├── files.ts
│   │           ├── agents.ts
│   │           ├── events.ts
│   │           └── context.ts
│   │
│   └── cli/                         # @visboard/cli
│       └── src/
│           ├── index.ts             # commander entry
│           ├── config.ts            # ~/.config/visboard/config.json
│           ├── output.ts            # --json formatting
│           └── commands/
│               ├── auth.ts
│               ├── workspace.ts
│               ├── project.ts
│               ├── note.ts
│               ├── checklist.ts
│               ├── file.ts
│               ├── agent.ts
│               ├── context.ts
│               ├── export.ts
│               └── doctor.ts
│
├── openapi/
│   └── openapi.yaml                 # generated or hand-maintained
│
└── docs/
    └── adr/
        ├── 001-monorepo-pnpm-turborepo.md
        ├── 002-drizzle-postgres.md
        ├── 003-hono-api-server.md
        ├── 004-oss-auth-pat-and-agent-keys.md
        └── 005-local-filesystem-storage.md
```

---

## 4. Technology Stack (locked for Phase 1)

| Layer | Choice | Version guidance |
|---|---|---|
| Runtime | Node.js | 22+ LTS |
| Package manager | pnpm | 9.x |
| Monorepo | Turborepo | 2.x |
| Language | TypeScript | 5.7+, strict |
| Linter/formatter | Biome | 1.9+ |
| API framework | Hono | 4.x |
| ORM | Drizzle ORM | latest |
| DB | PostgreSQL | 16 |
| Validation | Zod | 3.x |
| IDs | `ulid` package | sortable, prefixed |
| Web | Next.js App Router | 15.x |
| CSS | Tailwind CSS | 4.x or 3.4 |
| CLI | Commander.js | 12.x |
| HTTP client (SDK) | native `fetch` | — |
| Testing | Vitest | per package |
| Containers | Docker Compose | v2 |

**Explicitly not used in Phase 1:** Clerk, Auth0, Vercel Blob, Redis, WebSockets, Prisma, tRPC.

---

## 5. Environment Variables

### `.env.example` (root — used by docker-compose + local dev)

```bash
# Database
DATABASE_URL=postgresql://visboard:visboard@localhost:5432/visboard

# API
PORT=8080
API_BASE_URL=http://localhost:8080
VISBOARD_DATA_DIR=./data          # file uploads root
VISBOARD_TOKEN_PEPPER=change-me-in-production-min-32-chars

# Web (Next.js)
NEXT_PUBLIC_API_URL=http://localhost:8080/v1

# Bootstrap (first run only)
VISBOARD_BOOTSTRAP_TOKEN=         # optional; if set, enables POST /v1/bootstrap
```

### Docker Compose services

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: visboard
      POSTGRES_PASSWORD: visboard
      POSTGRES_DB: visboard
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U visboard"]
      interval: 5s
      retries: 5

  api:
    build: ./apps/api
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgresql://visboard:visboard@postgres:5432/visboard
      VISBOARD_DATA_DIR: /data
      VISBOARD_TOKEN_PEPPER: ${VISBOARD_TOKEN_PEPPER:-dev-pepper-change-me}
    volumes: [uploads:/data]
    depends_on:
      postgres: { condition: service_healthy }

  web:
    build: ./apps/web
    ports: ["3000:3000"]
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:8080/v1
    depends_on: [api]

volumes:
  pgdata:
  uploads:
```

---

## 6. Database Schema (exact columns)

All tables use `id` text PK with prefixed ULID. All timestamps `timestamptz` default `now()`.

### `workspaces`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `ws_` prefix |
| slug | text UNIQUE NOT NULL | lowercase, `[a-z0-9-]`, 3-48 chars |
| name | text NOT NULL | display name |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz NULL | soft delete |

### `users`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `user_` prefix |
| email | text UNIQUE NULL | optional for OSS MVP |
| display_name | text NOT NULL | |
| created_at | timestamptz | |

### `workspace_members`

| Column | Type | Notes |
|---|---|---|
| workspace_id | text FK → workspaces | composite PK |
| user_id | text FK → users | composite PK |
| role | text NOT NULL | `owner` \| `admin` \| `member` \| `guest` |
| created_at | timestamptz | |

### `personal_access_tokens`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `pat_` prefix |
| user_id | text FK → users | |
| name | text NOT NULL | e.g. "CLI laptop" |
| token_hash | text NOT NULL | sha256(token + pepper) |
| token_prefix | text NOT NULL | first 8 chars for identification |
| scopes | text[] NOT NULL | default `["admin"]` for owner bootstrap |
| expires_at | timestamptz NULL | |
| revoked_at | timestamptz NULL | |
| created_at | timestamptz | |

**Token format:** `vb_pat_<32 random base62 chars>` — shown once on create.

### `projects`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `prj_` |
| workspace_id | text FK | indexed |
| slug | text NOT NULL | unique per workspace |
| name | text NOT NULL | |
| description | text DEFAULT '' | |
| status | text NOT NULL | `draft` \| `active` \| `archived` |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz NULL | |

UNIQUE(workspace_id, slug)

### `project_members`

| Column | Type | Notes |
|---|---|---|
| project_id | text FK | composite PK |
| principal_type | text | `user` \| `agent` |
| principal_id | text | composite PK |
| role | text | `editor` \| `viewer` |
| created_at | timestamptz | |

### `notes`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `nt_` |
| project_id | text FK | indexed |
| slug | text NOT NULL | unique per project |
| title | text NOT NULL | |
| body | text NOT NULL DEFAULT '' | markdown |
| frontmatter | jsonb NOT NULL DEFAULT '{}' | |
| is_system | boolean DEFAULT false | true for AGENTS.md note |
| system_key | text NULL | `agents.md` when system note |
| version | integer NOT NULL DEFAULT 1 | bumped each update |
| created_by_type | text | `user` \| `agent` \| `system` |
| created_by_id | text | |
| updated_by_type | text | |
| updated_by_id | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz NULL | |

UNIQUE(project_id, slug) WHERE deleted_at IS NULL

### `note_versions`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `ntv_` |
| note_id | text FK | |
| version | integer | |
| title | text | snapshot |
| body | text | |
| frontmatter | jsonb | |
| created_by_type | text | |
| created_by_id | text | |
| created_at | timestamptz | |

UNIQUE(note_id, version)

### `checklists`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `chk_` |
| project_id | text FK | |
| title | text NOT NULL | |
| source_note_id | text FK NULL | if parsed from note |
| created_at | timestamptz | |
| updated_at | timestamptz | |
| deleted_at | timestamptz NULL | |

### `checklist_items`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `item_` |
| checklist_id | text FK | |
| text | text NOT NULL | |
| done | boolean DEFAULT false | |
| sort_order | integer NOT NULL | 0-based |
| assignee_type | text NULL | `user` \| `agent` |
| assignee_id | text NULL | |
| due_at | timestamptz NULL | |
| blocked_by | text[] DEFAULT '{}' | item IDs |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### `files`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `file_` |
| project_id | text FK | |
| name | text NOT NULL | original filename |
| mime_type | text NOT NULL | |
| size_bytes | bigint NOT NULL | |
| storage_path | text NOT NULL | relative path under DATA_DIR |
| sha256 | text NULL | optional Phase 1 |
| created_by_type | text | |
| created_by_id | text | |
| created_at | timestamptz | |
| deleted_at | timestamptz NULL | |

### `agents`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `agent_` |
| workspace_id | text FK | |
| name | text NOT NULL | |
| description | text DEFAULT '' | |
| capabilities | text[] DEFAULT '{}' | informational |
| scopes | text[] NOT NULL | see §13 |
| project_ids | text[] DEFAULT '{}' | empty = workspace-wide |
| token_hash | text NOT NULL | |
| token_prefix | text NOT NULL | |
| status | text DEFAULT 'active' | `active` \| `revoked` |
| last_seen_at | timestamptz NULL | |
| created_by_id | text FK → users | |
| created_at | timestamptz | |
| revoked_at | timestamptz NULL | |

**Token format:** `vb_agent_<32 random base62 chars>`

### `events`

| Column | Type | Notes |
|---|---|---|
| id | text PK | `evt_` |
| project_id | text FK | indexed |
| type | text NOT NULL | see §7.8 |
| actor_type | text NOT NULL | `user` \| `agent` \| `system` |
| actor_id | text NOT NULL | |
| resource_type | text NULL | |
| resource_id | text NULL | |
| payload | jsonb NOT NULL DEFAULT '{}' | |
| created_at | timestamptz | indexed |

Index: `(project_id, created_at)` for polling.

---

## 7. Core Concepts (implementation notes)

### 7.1 ID generation

```typescript
// packages/shared/src/ids.ts
export const PREFIX = {
  workspace: 'ws',
  project: 'prj',
  note: 'nt',
  checklist: 'chk',
  item: 'item',
  file: 'file',
  agent: 'agent',
  event: 'evt',
  user: 'user',
  pat: 'pat',
} as const;

export function createId(prefix: string): string {
  return `${prefix}_${ulid()}`;
}
```

### 7.2 Auth model (OSS Phase 1)

Two credential types, same `Authorization: Bearer` header:

1. **Personal Access Token (PAT)** — humans + CLI + web UI
2. **Agent API Key** — autonomous agents

Resolution order in middleware:
1. Hash token with pepper
2. Lookup `personal_access_tokens` where `token_hash` match and not revoked/expired
3. Else lookup `agents` where `token_hash` match and `status = active`
4. Else 401

Attach to Hono context:
```typescript
type AuthContext = {
  type: 'user' | 'agent';
  id: string;
  scopes: string[];
  workspaceIds: string[];  // derived from memberships or agent.workspace_id
};
```

### 7.3 Bootstrap flow (first install)

`POST /v1/bootstrap` — only when **zero workspaces exist** OR `VISBOARD_BOOTSTRAP_TOKEN` env matches header `X-Bootstrap-Token`.

Creates: workspace, owner user, PAT with admin scope. Returns token **once**.

CLI: `visboard auth bootstrap --name "My Workspace"` calls this.

### 7.4 AGENTS.md sync

On these mutations, call `syncAgentsMd(projectId)` (debounced 500ms in-memory per project):
- note create/update/delete
- checklist/item changes
- project update
- agent create/revoke

Implementation:
1. Load project + notes (exclude deleted) + checklists + files + agents
2. Call `@visboard/agents-md` `generate()`
3. Upsert system note where `system_key = 'agents.md'`, `is_system = true`
4. Emit `system.agents_md.synced` event

### 7.5 Note frontmatter parsing

Use `gray-matter` package:
- Split YAML frontmatter from body on create/update
- Validate frontmatter as `Record<string, unknown>` (no deep schema MVP)
- Reserved keys: `status`, `owner`, `tags`, `visboard` (object)

### 7.6 ETag / optimistic concurrency

Notes return header `ETag: W/"<version>"`.  
`PATCH` requires `If-Match` header; mismatch → `412 Precondition Failed`.

### 7.7 Event types (enum)

```typescript
export const EventType = {
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  NOTE_CREATED: 'note.created',
  NOTE_UPDATED: 'note.updated',
  NOTE_DELETED: 'note.deleted',
  CHECKLIST_CREATED: 'checklist.created',
  CHECKLIST_ITEM_UPDATED: 'checklist.item.updated',
  FILE_UPLOADED: 'file.uploaded',
  FILE_DELETED: 'file.deleted',
  AGENT_CREATED: 'agent.created',
  AGENT_REVOKED: 'agent.revoked',
  AGENT_TURN_COMPLETED: 'agent.turn.completed',
  SYSTEM_AGENTS_MD_SYNCED: 'system.agents_md.synced',
} as const;
```

### 7.8 Agent scopes

| Scope | Grants |
|---|---|
| `read` | GET on notes, checklists, files, context, events, agents.md |
| `write:notes` | POST/PATCH notes |
| `write:checklists` | POST/PATCH checklists and items |
| `write:files` | POST/DELETE files |
| `write:events` | POST events |
| `admin` | all of the above + agent management |

Default new agent: `['read']`.  
`admin` implies all scopes (checked in `scopes.ts`).

---

## 8. API Specification

**Base path:** `/v1`  
**Content-Type:** `application/json` (except file upload: `multipart/form-data`)  
**Errors:** RFC 7807 `application/problem+json`

### 8.1 Error shape

```json
{
  "type": "https://visboard.dev/errors/not-found",
  "title": "Not Found",
  "status": 404,
  "detail": "Project 'missing' not found in workspace 'acme'",
  "instance": "/v1/workspaces/acme/projects/missing"
}
```

### 8.2 Pagination

Query: `?cursor=<evt_id>&limit=50` (default 50, max 100)  
Response wrapper:

```json
{
  "data": [...],
  "pagination": { "next_cursor": "evt_...", "has_more": true }
}
```

### 8.3 Endpoints (complete)

#### Health
- `GET /health` → `{ "status": "ok", "version": "0.1.0" }` (no auth)

#### Bootstrap
- `POST /v1/bootstrap` → `{ workspace, user, token }` (gated, see §7.3)

#### Workspaces
- `GET /v1/workspaces`
- `POST /v1/workspaces` body: `{ name, slug? }`
- `GET /v1/workspaces/:ws`
- `PATCH /v1/workspaces/:ws` body: `{ name? }`
- `POST /v1/workspaces/:ws/export` → `{ export_id, status: "pending" }`
- `GET /v1/workspaces/:ws/exports/:id` → stream zip when ready

#### Projects
- `GET /v1/workspaces/:ws/projects`
- `POST /v1/workspaces/:ws/projects` body: `{ name, slug?, description?, status? }`
- `GET /v1/workspaces/:ws/projects/:p`
- `PATCH /v1/workspaces/:ws/projects/:p`
- `DELETE /v1/workspaces/:ws/projects/:p` → archives (status=archived)

#### Notes
- `GET /v1/workspaces/:ws/projects/:p/notes`
- `POST` body: `{ title, slug?, body?, frontmatter? }`
- `GET /v1/workspaces/:ws/projects/:p/notes/:id`
- `PATCH` body: `{ title?, body?, frontmatter? }` + `If-Match`
- `DELETE` → soft delete
- `GET .../notes/:id/versions`
- `GET .../notes/:id/versions/:version`

#### Checklists
- `GET/POST /v1/workspaces/:ws/projects/:p/checklists`
- `GET/PATCH/DELETE .../checklists/:id`
- `POST .../checklists/:id/items` body: `{ text, sort_order? }`
- `PATCH .../checklists/:id/items/:item` body: `{ text?, done?, assignee_type?, assignee_id?, due_at?, blocked_by? }`

#### Files
- `POST .../files` multipart field `file`
- `GET .../files`
- `GET .../files/:id` → JSON metadata; `?download=1` → binary stream
- `DELETE .../files/:id`

#### Agents
- `GET /v1/workspaces/:ws/agents`
- `POST` body: `{ name, description?, scopes, project_ids? }` → includes `token` once
- `PATCH /v1/workspaces/:ws/agents/:id`
- `POST /v1/workspaces/:ws/agents/:id/revoke`

#### Context (agent-optimized)
- `GET /v1/workspaces/:ws/projects/:p/agents.md` → `text/markdown`
- `POST /v1/workspaces/:ws/projects/:p/agents.md/sync`
- `GET /v1/workspaces/:ws/projects/:p/context?include=headings|bodies` (default `headings`)

**Context response shape:**

```json
{
  "project": { "id", "slug", "name", "description", "status" },
  "agents_md": "# AGENTS.md ...",
  "notes": [{ "id", "slug", "title", "summary", "body?" }],
  "checklists": [{ "id", "title", "items": [...] }],
  "files": [{ "id", "name", "mime_type", "size_bytes" }],
  "participants": { "users": [...], "agents": [...] }
}
```

#### Events
- `POST /v1/workspaces/:ws/projects/:p/events` body: `{ type, resource_type?, resource_id?, payload? }`
- `GET /v1/workspaces/:ws/projects/:p/events?since=<iso|evt_id>&types=a,b&limit=50`

### 8.4 Rate limiting (OSS)

In-memory token bucket per token ID: 600 req/min. Return `429` + `Retry-After: 60`.  
Configurable via `VISBOARD_RATE_LIMIT_RPM` env.

---

## 9. AGENTS.md Protocol v1

```markdown
<!-- visboard-agents-md:1 -->
# AGENTS.md — {project_name}

> Generated by VisBoard. Do not edit this file directly.
> Human overrides: create note `agents.local.md` (appended below).

## Purpose
{description or "No description set."}

## Status
{status}

## API
- Base URL: {api_base}/v1
- Workspace: `{ws_slug}`
- Project: `{p_slug}`
- Context endpoint: `GET .../context?include=headings`
- Recommended scopes: `read`, `write:checklists`, `write:events`

## Participants
### Humans
- {display_name} (`{user_id}`)

### Agents
- {name} (`{agent_id}`) scopes: {scopes}

## Notes
| Slug | Title | Summary |
|------|-------|---------|
| purpose | Purpose | First paragraph... |

## Checklists
### Launch (`chk_abc`)
- [ ] Ship API (`item_xyz`) @agent:reviewer
- [x] Write spec (`item_abc`)

## Files
| ID | Name | Type | Size |
|----|------|------|------|

## Local overrides
{contents of agents.local.md note if exists, else "_None._"}
```

---

## 10. CLI Specification

**Binary name:** `visboard`  
**Config file:** `~/.config/visboard/config.json`

```json
{
  "endpoint": "http://localhost:8080/v1",
  "token": "vb_pat_...",
  "workspace": "acme"
}
```

### Global flags
- `--json` — machine-readable output
- `--quiet` — errors only
- `--endpoint <url>` — override config
- `--workspace <slug>` — override config

### Commands (all must work in Phase 1)

```bash
# Auth
visboard auth bootstrap --name "Acme" [--slug acme]
visboard auth set-token <token>
visboard auth status
visboard auth logout

# Workspace
visboard workspace list
visboard workspace create --name "Acme" [--slug acme]
visboard workspace switch <slug>

# Project
visboard project list
visboard project create --name "Pipeline" --slug pipeline [--description "..."]
visboard project show <slug>
visboard project archive <slug>

# Notes
visboard note list --project <slug>
visboard note create --project <slug> --title "Spec" [--file ./spec.md] [--slug spec]
visboard note view --project <slug> <note-slug>
visboard note edit --project <slug> <note-slug>    # $EDITOR
visboard note delete --project <slug> <note-slug>

# Checklists
visboard checklist list --project <slug>
visboard checklist create --project <slug> --title "Tasks"
visboard checklist add --project <slug> <chk-id> --text "Do thing"
visboard checklist check --project <slug> <chk-id> <item-id>
visboard checklist uncheck --project <slug> <chk-id> <item-id>

# Files
visboard file upload --project <slug> ./data.json
visboard file list --project <slug>
visboard file download --project <slug> <file-id> [--out ./dir]
visboard file delete --project <slug> <file-id>

# Agents
visboard agent list [--project <slug>]
visboard agent create --name "Reviewer" --scopes read,write:checklists,write:events [--project <slug>]
visboard agent revoke <agent-id>

# Context
visboard context --project <slug> [--include bodies] [--tokens]
visboard agents-md --project <slug>
visboard agents-md --project <slug> --sync

# Ops
visboard export --workspace <slug> [--out ./export.zip]
visboard doctor
visboard config set endpoint <url>
visboard config get [key]
```

---

## 11. SDK Specification

**Package:** `@visboard/sdk`

```typescript
import { VisBoardClient } from '@visboard/sdk';

const client = new VisBoardClient({
  baseUrl: 'http://localhost:8080/v1',
  token: 'vb_pat_...',
});

// Ergonomic API
await client.workspaces.list();
await client.projects.create('acme', { name: 'Pipeline', slug: 'pipeline' });
await client.notes.create('acme', 'pipeline', { title: 'Spec', body: '# Spec' });
await client.context.get('acme', 'pipeline', { include: 'headings' });
await client.agentsMd.get('acme', 'pipeline');
await client.events.append('acme', 'pipeline', {
  type: 'agent.turn.completed',
  payload: { summary: 'Checked item 1' },
});
```

All methods throw `VisBoardError` with `status`, `title`, `detail` from problem+json.

---

## 12. Web UI Specification (minimal)

### Pages
1. `/` → redirect `/app`
2. `/app` → workspace list + "bootstrap" hint if empty
3. `/app/[ws]` → project cards + recent events sidebar
4. `/app/[ws]/projects/[p]` → **3-pane layout**

### 3-pane layout
- **Left (240px):** Notes list, Checklists list, Files list (tabbed or sections)
- **Center (flex):** Editor — split textarea + markdown preview; frontmatter as JSON textarea above
- **Right (320px, collapsible):** Activity stream (poll events every 3s)

### Auth in web (OSS)
- Settings modal: paste PAT → stored in `localStorage` key `visboard_token`
- No login page MVP — token paste is fine for OSS

### Design tokens (recommendation)
```css
:root {
  --bg: #0c0c0e;
  --surface: #141418;
  --border: #2a2a32;
  --text: #e8e8ed;
  --muted: #888894;
  --accent: #5b8def;
  --accent-dim: #3d5a9e;
  --success: #4ade80;
  --font-sans: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
}
```

Subtle grid background on app shell. No card-grid dashboards — use list rows.

---

## 13. Security (OSS Phase 1)

- Tokens hashed with SHA-256 + server pepper; never store plaintext
- Every DB query filters by `workspace_id` from auth context
- Agents cannot call bootstrap, export, or revoke other agents without `admin`
- File upload: reject `application/x-executable`, max 10MB (`VISBOARD_MAX_FILE_BYTES`)
- Path traversal prevention: sanitize filenames; storage path = `{project_id}/{file_id}/{safe_name}`
- CORS: `VISBOARD_CORS_ORIGIN` env (default `http://localhost:3000`)

---

## 14. Testing Requirements

### Unit tests (Vitest)
- `@visboard/shared` — schema validation edge cases
- `@visboard/agents-md` — snapshot test against fixture project
- `@visboard/api` — auth middleware, scope checks, ID generation

### Integration tests (`apps/api`)
- Use testcontainers postgres OR `DATABASE_URL` to test DB
- Flow: bootstrap → create project → note → checklist → agent key → context

### Smoke script
`scripts/smoke.sh` runs CLI commands against docker-compose stack.

---

## 15. CI Pipeline

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    services:
      postgres: ...
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```

---

## 16. Build Order (for parallel work)

```
Wave 1 (parallel):
  ├── packages/shared
  ├── packages/db (schema + migrations)
  ├── packages/agents-md
  └── root monorepo + docker-compose + ADRs

Wave 2 (parallel, after Wave 1 types exist):
  ├── apps/api
  ├── packages/sdk
  └── packages/cli

Wave 3:
  └── apps/web (depends on API + SDK)
```

---

## 17. Non-Goals (Phase 1)

- Hosted SaaS / multi-tenant cloud
- OIDC / SSO / user registration UI
- Real-time collaboration (SSE/WS)
- MCP server
- Comments UI
- Billing
- Mobile apps
- WYSIWYG editor
- Import from Notion
- npm publish (use workspace packages)

---

## 18. Phase 2 Preview (after OSS MVP)

1. MCP server package
2. OIDC auth plugin
3. SSE event stream
4. `visboard import`
5. GitHub Action for agent context sync
6. Hosted SaaS layer (LatticeAG)
7. npm publish `@visboard/cli`, `@visboard/sdk`

---

## 19. Decision Log

| Date | Decision |
|---|---|
| 2026-07-11 | Product: VisBoard |
| 2026-07-11 | Long-term: Hybrid; **Phase 1: OSS only** |
| 2026-07-11 | MIT license |
| 2026-07-11 | Monorepo: pnpm + Turborepo |
| 2026-07-11 | API: Hono standalone in `apps/api` |
| 2026-07-11 | ORM: Drizzle + Postgres 16 |
| 2026-07-11 | Auth: PAT + agent keys (no OIDC in Phase 1) |
| 2026-07-11 | Storage: local filesystem |
| 2026-07-11 | IDs: prefixed ULIDs |
| 2026-07-11 | Web: Next.js minimal shell |

---

## 20. MVP Smoke Test

```bash
#!/usr/bin/env bash
set -euo pipefail
ENDPOINT=http://localhost:8080/v1

# 1. Bootstrap
TOKEN=$(visboard auth bootstrap --name "Smoke Test" --slug smoke --json | jq -r .token)
visboard auth set-token "$TOKEN"

# 2. Create project
visboard project create --name "Demo" --slug demo

# 3. Create note
visboard note create --project demo --title "Purpose" --slug purpose --body "# Purpose\nShip VisBoard."

# 4. Create checklist + items
CHK=$(visboard checklist create --project demo --title "Launch" --json | jq -r .id)
ITEM=$(visboard checklist add --project demo "$CHK" --text "Item 1" --json | jq -r .id)

# 5. Create agent
AGENT_TOKEN=$(visboard agent create --name "Bot" --scopes read,write:checklists,write:events --project demo --json | jq -r .token)

# 6. Agent reads context
visboard auth set-token "$AGENT_TOKEN"
visboard agents-md --project demo | grep -q "AGENTS.md"
visboard context --project demo --json | jq -e '.project.slug == "demo"'

# 7. Agent checks item
visboard checklist check --project demo "$CHK" "$ITEM"
visboard auth set-token "$TOKEN"  # back to human

# 8. Human sees event in activity
visboard context --project demo --json | jq -e '.checklists[0].items[0].done == true'

# 9. Upload file
echo '{"ok":true}' > /tmp/smoke.json
visboard file upload --project demo /tmp/smoke.json

# 10. Export
visboard export --workspace smoke --out /tmp/smoke-export.zip
test -f /tmp/smoke-export.zip

echo "SMOKE TEST PASSED"
```

---

*SPEC v0.3 — OSS Phase 1 implementation spec. SaaS deferred.*
