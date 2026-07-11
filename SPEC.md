# VisBoard — Product & Engineering Spec

**Status:** Spec-only (v0.2 — planning expansion)  
**Series:** Vis (interface / workspace)  
**Owner:** LatticeAG  
**Repo:** github.com/LatticeAG/VisBoard  
**Tagline:** A shared workspace where agents and humans plan, write, and ship together.

---

## 0. Executive Decision: OSS vs SaaS vs Hybrid?

### Verdict: **Hybrid** (recommended and adopted)

| Option | What it means | Verdict |
|---|---|---|
| **Pure OSS** | Open-source only; no hosted product; monetize support/consulting | ❌ Too slow to learn from real usage; weak distribution for non-infra buyers |
| **Pure SaaS** | Closed source; hosted only | ❌ Agents/devs distrust black-box context stores; kill adoption among the primary ICP |
| **Hybrid** | MIT OSS (server + CLI + SDK + API spec) + invite-only hosted SaaS | ✅ **Chosen** |

### Why Hybrid is the right model for VisBoard

1. **Trust is the product.** VisBoard holds prompts, plans, files, and agent actions. Agent engineers will not point production agents at a closed context store without the option to audit, fork, or self-host.
2. **Agents need SDKs, not just a website.** The CLI/SDK *must* be OSS for agents, CI, and frameworks to depend on them. Closing those creates friction that kills the core loop.
3. **Hosted is how you get paid and learn.** Self-hosters are valuable advocates but slow to convert. Invite-only SaaS gives LatticeAG dogfooding, telemetry (with consent), support leverage, and a path to Team/Enterprise revenue without waiting for consulting deals.
4. **The moat is not the CRUD.** Notes + checklists are commoditized. The moat is: agent-native APIs, `AGENTS.md` protocol, event stream semantics, integrations (GitHub, Slack, Cursor, Vercel), managed reliability, SSO, and support. Those live naturally in hosted + ecosystem.
5. **Escape hatch reduces sales friction.** Enterprise buyers ask “can we leave?” Early: export + self-host path. Later: Enterprise SLA on LatticeAG infra. Hybrid answers both.

### Hybrid split (concrete)

| Layer | License / Model | Rationale |
|---|---|---|
| Core server (API, data model, auth plugins) | **MIT** | Trust, forks, self-host, community PRs |
| CLI (`visboard`) | **MIT** | CI/CD, scripts, agent tooling |
| TypeScript SDK | **MIT** | Agent frameworks must depend freely |
| OpenAPI / AGENTS.md protocol | **MIT / CC0 for protocol docs** | Standardize the surface |
| Web UI (basic) | **MIT** | Self-hosters need a usable UI |
| Hosted ops (multi-tenant isolation, backups, malware scan, CDN) | **SaaS-only** | Operational value |
| SSO / SAML, SCIM, audit export packs, SOC2 controls | **SaaS Team/Enterprise** | Classic B2B upgrade path |
| Real-time collaboration (post-MVP), managed webhooks, premium connectors | **SaaS-first, OSS later if strategic** | Iteration speed + monetization |
| Brand, marketing site, invite system | **Proprietary ops** | Go-to-market |

**Recommendation locked:** do **not** dual-license the core. Dual-license (AGPL/BSL + commercial) creates FUD in the agent ecosystem. MIT + paid hosted is clearer and matches developer expectations in 2026.

---

## 1. Problem

Agentic workflows are becoming collaborative, but the tools we use to manage them are not. A team running multiple agents ends up with:

- **Scattered context:** prompts, outputs, logs, and artifacts live in separate dashboards, chat threads, and local files.
- **No shared ground truth:** humans and agents cannot point to the same task, note, or checklist in one place.
- **Friction handoffs:** moving from agent output to human review, or from plan to execution, requires copy-paste across systems.
- **Onboarding cost:** every new agent joining a project reconstructs context from ad-hoc documents and conversation history.
- **Opaque agent behavior:** operators cannot see what an agent read, wrote, or claimed without digging through framework logs.
- **Permission mismatch:** human tools assume seats and UI clicks; agent tools assume unbounded filesystem/API access.

Project-management tools are human-first. Agent frameworks are code-first. There is no lightweight, **web-first + API-native** workspace designed for both.

### Problem statement (one sentence)

> Humans and agents need a shared, structured, permissioned workspace for plans, notes, checklists, and files — with an API agents can treat as ground truth and a UI humans can trust.

---

## 2. Opportunity & Product Thesis

**Thesis:** The next layer after “agent runtimes” is **shared operational context**. VisBoard is that layer: a thin, durable workspace that both sides read and write.

**Why now:**
- Multi-agent systems are leaving demos and entering team workflows.
- `AGENTS.md`-style conventions are emerging as the handshake between tools and agents.
- Teams already bolt together Notion + GitHub Issues + Slack + custom JSON — VisBoard collapses that for agent-heavy work.

**What VisBoard is not:**
- Not a general Notion/Confluence replacement.
- Not an agent runtime / orchestrator (no LangGraph competitor).
- Not a chat UI for LLMs (no ChatGPT clone).
- Not a full ticketing system (Linear/Jira competitor).

**What VisBoard is:**
- The **shared context board** agents join via API keys and humans join via browser/CLI.
- The **source of truth** for project purpose, open work, and artifacts mid-flight.
- The **audit surface** for “what did agents do in this project?”

---

## 3. Target Users & Personas

| Segment | Role | Primary Need | Priority |
|---|---|---|---|
| **Agent engineers** | Build/operate autonomous agents | Structured context surface agents read/write via API | P0 |
| **Product / ops teams** | Coordinate agent + human work | Shared project views, checklists, progress | P0 |
| **Studio / agency teams** | Client projects with AI collaborators | Branded workspaces, files, notes, deliverables | P1 |
| **LatticeAG internal** | Dogfood Vis series | First production tenant; roadmap fuel | P0 |
| **Platform / DevRel** | Publish agent templates | SDK + sample agents that bind to VisBoard | P1 |
| **Security / IT** | Approve tools | Self-host option, RBAC, audit, SSO path | P2 (blocks Enterprise) |

### Personas (recommended detail)

**Ava — Agent Engineer (primary)**  
Wants: `/context` in one call, scoped keys, idempotent writes, clear events.  
Hates: scraping Notion HTML, brittle prompt dumps, no audit trail.

**Omar — Ops / PM hybrid**  
Wants: see open checklists, who (human/agent) owns what, activity feed.  
Hates: Slack archaeology, “the agent said it was done.”

**Kim — Agency lead**  
Wants: client-safe workspaces, file handoff, export.  
Hates: agents dumping secrets into shared docs (needs scopes + redaction later).

---

## 4. Jobs To Be Done

1. When I start an agent on a project, I want it to **self-onboard from `AGENTS.md` + context** so I don’t paste a novel into the prompt.
2. When an agent finishes a step, I want it to **update a checklist / note** so humans see progress without reading logs.
3. When a human reviews work, I want to **comment / reassign / block** items agents respect on next poll.
4. When something goes wrong, I want an **event stream** that answers “what changed, by whom, when?”
5. When I leave the hosted product, I want a **full export** that boots on self-hosted VisBoard.

---

## 5. Competitive Landscape (positioning map)

| Tool | Strength | Gap vs VisBoard |
|---|---|---|
| Notion / Confluence | Human docs UX | Weak agent API, no first-class agent identity |
| Linear / Jira | Issue workflows | Ticket-centric; agents are second-class |
| GitHub Issues + Projects | Dev-native | Repo-bound; not a shared workspace for non-code artifacts |
| Agent frameworks (LangGraph, Crew, Autogen) | Execution | No durable shared human UI / org workspace |
| Mem0 / vector memory products | Long-term memory | Memory ≠ collaborative workspace + permissions |
| Cursor / IDE agents | Coding agents | Local/repo scoped; not multi-human multi-agent project board |

**Differentiator (keep repeating):** first-class agent participants, auto-generated `AGENTS.md`, API-native design, Hybrid trust model.

---

## 6. Product Principles

1. **API-first, UI-second.** Anything a human can do in the UI, an agent can do via API (with scopes).
2. **Agents are participants, not integrations.** They have identity, roles, and an activity trail.
3. **One project = one ground truth.** Notes, checklists, files, and events cohere; don’t fork into chat silos.
4. **Markdown is the lingua franca.** Prefer portable text over proprietary blocks at MVP.
5. **Least privilege by default.** Agent keys start read-only until scopes are granted.
6. **Exportability is non-negotiable.** Hosted users can leave; self-hosters can import.
7. **Boring reliability over clever AI.** VisBoard stores and coordinates; it does not “think” for you at MVP.
8. **Thin core, sharp edges.** Ship the smallest correct model; resist becoming Notion.

---

## 7. Core Concepts

### 7.1 Workspace

Top-level container. Owns projects, members, billing (hosted), integrations.

**Recommended defaults:**
- Slug unique globally on hosted; unique per instance when self-hosted.
- Soft-delete with 30-day purge window on hosted.
- One owner minimum; transfer ownership required before owner leave.

### 7.2 Project

Collaborative container: notes, checklists, files, event stream, participants.

**Fields:** `id`, `slug`, `name`, `description`, `status` (`draft` | `active` | `archived`), `created_at`, `updated_at`.

**Recommended conventions:**
- Slug immutable after creation (avoid breaking agent configs); rename = display name only.
- Archive ≠ delete; archived projects are read-only to agents by default.
- Every project always has a generated `AGENTS.md` (system note, special flag).

### 7.3 Note

Markdown document with optional YAML frontmatter, version history, attachments by ID.

**Recommended:**
- Store canonical body as markdown string; render on read.
- Frontmatter keys are free-form at MVP; reserve `status`, `owner`, `tags`, `visboard` namespace.
- Version on every successful PATCH (full snapshot for MVP; diff compression later).
- Soft-delete with tombstone event.

### 7.4 Checklist

First-class entity (not only markdown syntax sugar).

**Why first-class (recommendation):** agents need stable IDs for items; parsing `- [ ]` alone is fragile across edits. Support **both**:
- Embedded checklists in notes (parsed + synced).
- Standalone checklists (API-native).

**Item fields:** `id`, `text`, `done`, `assignee_id` (user|agent|null), `due_at`, `blocked_by[]`, `order`.

### 7.5 File / Attachment

Uploaded blobs referenced by stable ID.

**MVP limits (hosted):** 10 MB/file, 1 GB/workspace on Starter.  
**Self-hosted:** configurable.

**Types:** text, images, PDF, JSON, YAML, markdown. Reject executables on hosted.

**Recommendation:** content-addressed storage keys (`sha256`) for dedupe later; simple UUID paths for MVP (see Open Questions — recommend simple blobs for MVP).

### 7.6 Agent

Participant with API key + metadata + scopes.

**Fields:** `id`, `name`, `description`, `capabilities[]` (informational), `scopes[]`, `project_ids[]` or workspace-wide, `created_by`, `last_seen_at`, `status` (`active`|`revoked`).

**Recommendation:** keys shown once at creation; store only hashed secret (`sha256` + pepper). Prefix keys `vb_agent_...` for leak detection.

### 7.7 Human User

OIDC/OAuth identity. Session tokens distinct from agent keys.

### 7.8 Event Stream

Append-only log per project: creates, updates, comments, agent actions, system events.

**Recommendation:** this is the **collaboration substrate** and audit log. Shape:

```json
{
  "id": "evt_...",
  "project_id": "prj_...",
  "type": "checklist.item.checked",
  "actor_type": "agent",
  "actor_id": "agent_...",
  "resource_type": "checklist_item",
  "resource_id": "cli_...",
  "payload": { "before": false, "after": true },
  "created_at": "2026-07-11T12:00:00Z"
}
```

MVP: polling. Post-MVP: SSE then WebSocket.

### 7.9 AGENTS.md

Auto-generated, project-scoped onboarding document for agents.

**Recommended sections (canonical template):**
1. Project purpose & status  
2. Participants (humans + agents)  
3. Directory of notes (title, slug, role/summary)  
4. Active checklists & priorities  
5. Files of interest  
6. Conventions / guardrails  
7. How to use the VisBoard Agent API (endpoint + scopes needed)  
8. “Do not” list (secrets, destructive actions)

**Sync rules (recommendation):**
- Regenerate on project structural changes (note create/delete, checklist changes, participant changes).
- Debounce regenerations (e.g. 2s) to avoid thrash.
- Store as a system note with `frontmatter.visboard.system = "agents.md"` — readable via normal note APIs **and** dedicated endpoint.
- Humans may add a `AGENTS.local.md` override note that is **appended** (never overwritten by generator).

### 7.10 Comment (recommended for post-MVP, stub in schema)

Threaded comments on notes/checklist items. Out of MVP UI, but reserve `comment.created` event types so the stream model doesn’t paint us into a corner.

### 7.11 Integration (post-MVP)

GitHub, Slack, webhooks. Model as workspace-level connection objects.

---

## 8. Information Architecture (Web)

```
/                           → marketing (hosted) or redirect to login (self-host)
/login                      → OIDC start
/app                        → workspace picker / last workspace
/app/:ws                    → dashboard (projects + recent events)
/app/:ws/projects/:p        → project shell (3-pane)
/app/:ws/projects/:p/notes/:n
/app/:ws/projects/:p/checklists/:c
/app/:ws/projects/:p/files
/app/:ws/projects/:p/agents
/app/:ws/projects/:p/activity
/app/:ws/settings           → members, keys, billing (hosted), export
```

### Project shell (recommendation)

**Three-pane layout:**
1. **Left:** notes / checklists / files nav  
2. **Center:** editor or detail  
3. **Right:** activity stream (collapsible on mobile → bottom sheet)

Mobile: single column with tab switcher (Content | Activity | Agents).

**Design direction (recommendation):**
- Dark, dense, developer-tool aesthetic — but **not** generic purple glow.
- CSS variables; expressive mono + UI sans (e.g. IBM Plex Sans + IBM Plex Mono, or Geist Mono + something non-Inter).
- Atmosphere via subtle grid / noise, not flat white.
- Brand “VisBoard” must be visible in app chrome without overpowering content.
- Motion: pane transitions, stream item insert animation, checklist check micro-interaction (2–3 intentional motions).
- **No cards in hero/marketing first viewport**; product UI may use list rows, not card grids.

---

## 9. Product Surfaces

### 9.1 Web Application (hosted + self-hostable)

MVP:
- Dashboard, project view, markdown editor (textarea + preview), file manager, agent registry, settings/export.

Post-MVP:
- Live presence, comments, richer editor, integration settings, billing portal.

### 9.2 CLI (`visboard`) — OSS

Primary interface for CI, power users, self-host ops. See §11.

### 9.3 SDK — OSS

TypeScript first (`@latticeag/visboard-sdk`). Thin REST wrapper + helpers:
- `client.projects.context(projectId)`
- `client.agentsMd.get(projectId)`
- `client.checklists.check(itemId)`
- Typed resources matching OpenAPI.

**Recommendation:** generate types from OpenAPI; hand-write ergonomic helpers on top.

### 9.4 MCP Server (strong recommendation — include in roadmap week 2–3)

Expose VisBoard as an MCP tool server so Cursor / Claude / other MCP clients can read/write projects without custom glue.

Tools (proposed): `list_projects`, `get_context`, `get_agents_md`, `upsert_note`, `list_checklists`, `set_checklist_item`, `append_event`, `upload_file`.

This is a **distribution multiplier** for agent engineers. Prioritize soon after MVP API stabilizes.

### 9.5 Docs site

OpenAPI reference + guides: “Build your first agent”, “Self-host”, “AGENTS.md protocol”, “Migration hosted → self-host”.

---

## 10. API Surface

**Hosted base:** `https://api.visboard.io/v1`  
**Self-hosted default:** `/v1`  
**Auth:** `Authorization: Bearer <token>` (user session or agent key)

### Design rules (recommendations)

1. **Consistent IDs** with prefixes: `ws_`, `prj_`, `nt_`, `chk_`, `item_`, `file_`, `agent_`, `evt_`, `user_`.
2. **Idempotency-Key** header on creates that agents retry.
3. **Optimistic concurrency:** `If-Match` / `etag` on note PATCH to prevent lost updates.
4. **Pagination:** cursor-based (`?cursor=&limit=`) everywhere lists exist.
5. **Errors:** RFC 7807 problem+json.
6. **Rate limits:** return `429` + `Retry-After`; hosted defaults: 120 rpm user, 600 rpm agent (configurable).
7. **Versioning:** URL `/v1`; additive changes only; breaking = `/v2`.

### 10.1 Workspaces

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces` | List workspaces for caller |
| `POST` | `/workspaces` | Create (hosted: invite-gated) |
| `GET` | `/workspaces/{ws}` | Get |
| `PATCH` | `/workspaces/{ws}` | Update |
| `POST` | `/workspaces/{ws}/export` | Start export job |
| `GET` | `/workspaces/{ws}/exports/{id}` | Export status / download |

### 10.2 Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects` | List |
| `POST` | `/workspaces/{ws}/projects` | Create |
| `GET` | `/workspaces/{ws}/projects/{p}` | Get |
| `PATCH` | `/workspaces/{ws}/projects/{p}` | Update |
| `DELETE` | `/workspaces/{ws}/projects/{p}` | Archive |
| `GET` | `/workspaces/{ws}/projects/{p}/agents.md` | Fetch AGENTS.md |
| `POST` | `/workspaces/{ws}/projects/{p}/agents.md/sync` | Force regenerate |

### 10.3 Notes

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects/{p}/notes` | List |
| `POST` | `/workspaces/{ws}/projects/{p}/notes` | Create |
| `GET` | `/workspaces/{ws}/projects/{p}/notes/{id}` | Get |
| `PATCH` | `/workspaces/{ws}/projects/{p}/notes/{id}` | Update |
| `DELETE` | `/workspaces/{ws}/projects/{p}/notes/{id}` | Delete |
| `GET` | `/workspaces/{ws}/projects/{p}/notes/{id}/versions` | Version list |
| `GET` | `/workspaces/{ws}/projects/{p}/notes/{id}/versions/{v}` | Version get |

### 10.4 Checklists

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects/{p}/checklists` | List |
| `POST` | `/workspaces/{ws}/projects/{p}/checklists` | Create |
| `GET` | `/workspaces/{ws}/projects/{p}/checklists/{id}` | Get |
| `PATCH` | `/workspaces/{ws}/projects/{p}/checklists/{id}` | Update checklist meta |
| `POST` | `/workspaces/{ws}/projects/{p}/checklists/{id}/items` | Add item |
| `PATCH` | `/workspaces/{ws}/projects/{p}/checklists/{id}/items/{item}` | Update/toggle item |
| `DELETE` | `/workspaces/{ws}/projects/{p}/checklists/{id}` | Delete |

### 10.5 Files

| Method | Path | Description |
|---|---|---|
| `POST` | `/workspaces/{ws}/projects/{p}/files` | Upload (multipart) |
| `GET` | `/workspaces/{ws}/projects/{p}/files` | List |
| `GET` | `/workspaces/{ws}/projects/{p}/files/{id}` | Download / metadata |
| `DELETE` | `/workspaces/{ws}/projects/{p}/files/{id}` | Delete |

### 10.6 Agents

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/agents` | List workspace agents |
| `POST` | `/workspaces/{ws}/agents` | Create key |
| `PATCH` | `/workspaces/{ws}/agents/{id}` | Update scopes/meta |
| `POST` | `/workspaces/{ws}/agents/{id}/revoke` | Revoke |

### 10.7 Agent-optimized

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects/{p}/context` | Snapshot: meta + AGENTS.md + notes index + checklists + files index |
| `POST` | `/workspaces/{ws}/projects/{p}/events` | Append agent/system event |
| `GET` | `/workspaces/{ws}/projects/{p}/events` | Poll events (`since`, `types`) |

**`/context` recommendation:** support `?include=bodies|headings` — default headings/summaries to keep tokens small; `include=bodies` for full notes when needed.

### 10.8 Common resource shape

```json
{
  "id": "nt_01HZX...",
  "slug": "product-spec",
  "title": "Product Spec",
  "body": "# Product Spec\n...",
  "frontmatter": { "status": "draft", "owner": "agent-1" },
  "etag": "W/\"3\"",
  "created_at": "2026-07-11T00:00:00Z",
  "updated_at": "2026-07-11T00:00:00Z",
  "created_by": { "type": "user", "id": "user_..." },
  "updated_by": { "type": "agent", "id": "agent_..." }
}
```

### 10.9 Real-time (post-MVP)

SSE first (`GET /events/stream`), then WebSocket if bidirectional presence is needed. MVP = polling every 2–5s from UI; agents poll with backoff.

---

## 11. CLI Commands

Binary: `visboard`  
Config: `$XDG_CONFIG_HOME/visboard/` (credentials in OS keychain when available)

### Auth

```bash
visboard auth login
visboard auth status
visboard auth logout
visboard auth use-key
```

### Workspace & project

```bash
visboard workspace list
visboard workspace create --name "Acme Agents"
visboard workspace switch <slug>
visboard project list
visboard project create --name "Q3 Agent Pipeline" --slug q3-pipeline
visboard project show <slug>
visboard project archive <slug>
```

### Notes / checklists / files / agents / context

(As in v0.1 — retain full command set from initial draft; ensure `--json` on all read commands for scripting.)

**Additional recommendations:**
- Global `--json` / `--quiet` / `--endpoint`.
- `visboard context --project <slug> --tokens` approximate token count for LLM packing.
- `visboard export --workspace <slug> ./out.zip`.
- `visboard doctor` for self-host health (db, storage, oidc).

---

## 12. Data Model (logical)

```
Workspace
  ├── Membership (user, role)
  ├── Agent (key hash, scopes)
  ├── Integration* (post-MVP)
  └── Project
        ├── ProjectMembership (user|agent, role)
        ├── Note
        │     └── NoteVersion
        ├── Checklist
        │     └── ChecklistItem
        ├── File
        └── Event
```

**Recommendation — Postgres schemas:**
- `core` for tenants/projects
- `audit` optional for long retention partitions  
Use ULIDs/UUIDv7 for sortable IDs.

**Soft deletes:** `deleted_at` on user-facing resources; hard purge via job.

---

## 13. Security Model

### 13.1 Authentication

- **Humans (hosted):** OAuth 2.0 / OIDC — **recommendation: Auth0 or Clerk via Vercel Marketplace**, or WorkOS if SSO is near-term. Prefer one vendor; don’t build auth.
- **Humans (self-host):** any OIDC provider (Auth.js / custom OIDC client). Document Dex, Keycloak, Google, GitHub.
- **Agents:** long-lived API keys, hashed at rest, revocable, scoped.
- **CLI:** OS keychain; fallback encrypted file.

### 13.2 Authorization (RBAC)

**Workspace roles:** `owner` | `admin` | `member` | `guest`  
**Project roles:** `editor` | `viewer` | `agent:<scopes>`

### 13.3 Agent scopes

| Scope | Capability |
|---|---|
| `read` | Read notes, checklists, files, AGENTS.md, events |
| `write:notes` | Create/update notes |
| `write:checklists` | Create/toggle checklists |
| `write:files` | Upload/delete files |
| `write:events` | Append events |
| `admin` | Full project access |

**Recommendation:** deny-by-default; `read` alone for new keys; no workspace-destructive scopes for agents ever (no billing, no delete workspace).

### 13.4 Data safety

- TLS 1.3 in transit; AES-256 at rest (hosted volume + object storage encryption).
- Hosted malware scan on uploads (ClamAV or vendor).
- Secrets scanning heuristic on note bodies (warn on `sk-`, `AKIA`, private keys) — post-MVP nice; flag in roadmap.
- Export anytime.
- Audit log lifetime of workspace (hosted); configurable retention self-host.

### 13.5 Threat model (MVP-aware)

| Threat | Mitigation |
|---|---|
| Stolen agent key | Hash storage, revoke, short activity anomaly alerts (post-MVP) |
| Prompt injection via notes | Document that VisBoard is data, not a sandbox; scopes limit blast radius |
| Cross-tenant leak | workspace_id on every query; integration tests for isolation |
| SSRF via file URLs | No server-side fetch of user URLs at MVP |
| Export exfil by guest | Guests cannot export workspace |

---

## 14. Recommended Tech Stack

### 14.1 Monorepo layout (recommendation)

```
/apps
  /web          Next.js App Router UI
  /api          API server (see below)
  /docs         Docs (Nextra or Mintlify)
/packages
  /sdk          TypeScript SDK
  /cli          CLI (Node or Bun)
  /shared       Zod schemas / types
  /agents-md    AGENTS.md generator pure functions
```

### 14.2 API runtime — **recommendation: Node.js on Vercel Fluid Compute (hosted) + Docker for self-host**

| Option | Pros | Cons | Decision |
|---|---|---|---|
| Cloudflare Workers | Fast edge | Compatibility friction for Postgres drivers, uploads, longer jobs | ❌ Not for MVP core API |
| Traditional always-on Node (ECS/Fly) | Simple mental model | More ops early | Optional later |
| **Vercel Fluid Compute + Next.js route handlers or Hono** | Fast iteration, LatticeAG/Vercel alignment, 300s default timeout, Node 24 | Self-host story needs Docker twin | ✅ **Hosted MVP** |

**Self-host:** same codebase packaged as Docker Compose: `api` + `web` + `postgres` + `minio` (optional).

**Do not** use Edge Functions / Edge-only runtime for the core API.

### 14.3 Framework choices (recommendations)

| Concern | Choice | Why |
|---|---|---|
| Web | **Next.js App Router** | Fits Vercel; RSC for dashboard shells |
| API | **Hono** or Next route handlers | Hono if we want cleaner self-host; Next routes OK for speed |
| Language | **TypeScript** everywhere MVP | One language across web/cli/sdk |
| Validation | **Zod** | Share with SDK |
| ORM | **Drizzle** | SQL-transparent, great migrations, fits Postgres |
| DB | **PostgreSQL 16** via Vercel Marketplace (**Neon**) | Serverless-friendly, PITR |
| Object storage | **Vercel Blob** (hosted) / S3-compatible (self-host) | Simple; private blobs |
| Auth hosted | **Clerk or Auth0** | Don’t build auth |
| Auth self-host | OIDC plugin | Documented providers |
| UI components | **shadcn/ui + Tailwind** | Fast, controllable |
| Testing | **Vitest** + Playwright smoke | Unit + one e2e path |
| Lint/format | **Oxlint/ESLint + Prettier** or Biome | Pick one — recommend **Biome** for speed |
| CI | GitHub Actions | Lint, typecheck, test, build containers |
| Observability | **Sentry** | Errors + perf; add later for agent tracing if needed |
| Feature flags | Simple env flags MVP | LaunchDarkly later if needed |

### 14.4 ADR required on Day 1

Commit ADRs for: ORM (Drizzle), auth vendor, API framework (Hono vs Next), storage (Blob vs S3), monorepo tool (**pnpm + Turborepo** recommended).

---

## 15. Architecture

### 15.1 Hosted (logical)

```
[Browser / CLI / Agent]
        │ HTTPS
        ▼
[Vercel — Web + API (Fluid Compute)]
        │
        ├── Neon Postgres (primary)
        ├── Vercel Blob (files)
        ├── Auth provider
        └── Sentry
```

Multi-tenant: shared DB, hard `workspace_id` isolation. Row-Level Security as defense-in-depth **post-MVP** (app-layer checks at MVP, with tests).

### 15.2 Self-hosted

```
Docker Compose
  web + api + postgres + minio + caddy/traefik
```

Single-tenant per deployment by default; multi-workspace still supported inside one instance.

### 15.3 Background jobs (MVP-light)

- Export zip generation  
- AGENTS.md debounce regenerate  
- Hard-delete purge  

**Recommendation:** start with in-process queue (or Neon-backed job table + cron). Add Redis/Upstash only when needed.

---

## 16. Deployment Model

### 16.1 Hosted SaaS (invite-only)

- Domain: `visboard.io` / `api.visboard.io`
- Availability target: 99.9%
- Region: US-East first
- Backups: PITR 30 days (Neon)
- Signup: invite-only; waitlist form on marketing site
- Preview deployments per PR

### 16.2 Self-hosted OSS

- `docker compose up` happy path in <10 minutes
- Required: Postgres, OIDC client id/secret, storage path or S3 creds
- No telemetry by default; opt-in anonymous stats

### 16.3 Distribution

- CLI: npm `@latticeag/visboard` + GitHub Releases binaries (optional later via `bun build` / pkg)
- SDK: `@latticeag/visboard-sdk`
- Container: `ghcr.io/latticeag/visboard`

---

## 17. AGENTS.md Protocol (spec-within-spec)

Treat this as a **versioned protocol** agents can rely on.

```markdown
<!-- visboard-agents-md:1 -->
# AGENTS.md — {project_name}

> Generated by VisBoard. Do not edit this file directly.
> Optional overrides: see note `AGENTS.local.md`.

## Purpose
...

## Status
active | draft | archived

## Participants
- humans: ...
- agents: ...

## Notes
| slug | title | role |
|---|---|---|

## Checklists
### {title} (`chk_...`)
- [ ] item (`item_...`) @assignee

## Files
| id | name | mime |

## Conventions
...

## API
Base: {base_url}
Project: {ws}/{p}
Suggested scopes: read, write:checklists, write:events
```

**Compatibility:** bump `visboard-agents-md:N` when section semantics break. Agents should read the version comment.

---

## 18. UX Flows (MVP)

### Flow A — Human creates project, invites agent
1. Create workspace (invite) → create project  
2. Write purpose note  
3. Create checklist “Launch”  
4. Create agent key with `read,write:checklists,write:events`  
5. Copy onboarding snippet (endpoint + key + `visboard context`)

### Flow B — Agent loop
1. `GET /context` or `GET /agents.md`  
2. Plan locally  
3. PATCH checklist items / POST notes  
4. POST event `agent.turn.completed` with summary  
5. Poll events for human changes

### Flow C — Human review
1. Open project activity  
2. See agent updates  
3. Uncheck / reword / add blocking item  
4. Agent observes on next poll

### Flow D — Export / leave
1. Settings → Export  
2. Download zip (JSON + files)  
3. `visboard import` on self-host (import can be week-2; export mandatory MVP)

---

## 19. Pricing & Packaging

### Positioning

VisBoard = **shared context layer for agent–human teams**.

### Tiers (recommendation)

| Tier | Price | Includes |
|---|---|---|
| **Open Source** | Free | Self-host everything core; community support |
| **Starter** | Free (invite-only) | 1 workspace, 3 projects, 5 agents, 1 GB storage |
| **Team** | $29 / seat / month | Unlimited projects, 50 agents/workspace, 100 GB, SSO add-on path, priority support |
| **Enterprise** | Custom | SLA, dedicated/VPC options, audit exports, SCIM, custom integrations, DPA |

**Billing recommendation:** seat = human user. Agents are metered separately (included packs, then overage) — avoids punishing agent-heavy teams on seat count alone. For MVP: **don’t build billing**; hard-cap Starter in code; invoice Team manually.

**OSS/SaaS split reminder:** speed, managed infra, SSO, support = hosted moat; trust + extensibility = OSS.

---

## 20. Go-to-Market (recommendations)

1. **Dogfood** on LatticeAG internal projects day 1.  
2. **Invite-only** beta: 20 workspaces target.  
3. **Content:** “AGENTS.md as a protocol” blog + sample agents (Cursor, plain Node).  
4. **MCP launch** as a second PR wave for distribution.  
5. **Design partners:** 3 agent startups + 2 agencies.  
6. Avoid Product Hunt until Team billing + reliability exist.  
7. GitHub README must run a self-host path and a 60-second agent demo.

---

## 21. Roadmap

### Phase 0 — Spec & bootstrap (this document)
Finalize decisions, ADRs, repo layout. **No feature code until SPEC sign-off.**

### Phase 1 — MVP (six-day spike; see §22)
API + CLI + minimal web + agent context loop.

### Phase 2 — Hardening (post-MVP)
- SSE events  
- Import path  
- MCP server  
- Secrets warnings  
- RLS exploration  
- Better editor (CodeMirror markdown)  
- Workspace invites UX  

### Phase 3 — Collaboration
- Comments  
- Presence  
- Webhooks  
- GitHub sync (issues ↔ checklists)  

### Phase 4 — Scale / Enterprise
- SSO/SAML (WorkOS)  
- SCIM  
- SOC2 evidence collection  
- Regional hosting  
- Python SDK  

---

## 22. Six-Day MVP Milestones

> Aggressive spike to validate the loop — not production polish.

### Day 1 — Foundation
- [ ] SPEC sign-off (this doc)
- [ ] Repo bootstrap (pnpm + Turborepo), ADRs
- [ ] Drizzle + Neon schema skeleton
- [ ] CI: lint, typecheck, test placeholder
- [ ] Sentry stub (optional)

### Day 2 — Workspace & Project
- [ ] Schema: workspaces, projects, members
- [ ] REST: workspace + project CRUD
- [ ] Human auth (vendor)
- [ ] CLI: `auth`, `workspace`, `project`

### Day 3 — Notes & Markdown
- [ ] Note CRUD + frontmatter
- [ ] Web: textarea + preview
- [ ] CLI: `note`
- [ ] Note versions table

### Day 4 — Checklists & Files
- [ ] Checklist entities + endpoints
- [ ] Parse embedded `- [ ]` from notes (best-effort sync)
- [ ] File upload/download (Blob or local)
- [ ] CLI: `checklist`, `file`

### Day 5 — Agent API & AGENTS.md
- [ ] Agent keys + scopes
- [ ] `/context` + `/agents.md` + sync
- [ ] Events append/list
- [ ] CLI: `agent`, `context`, `agents-md`

### Day 6 — Web Shell & Polish
- [ ] Dashboard + project 3-pane shell
- [ ] Agent registry UI
- [ ] E2E smoke: human → agent → checklist
- [ ] README, OpenAPI stub, `v0.1.0-mvp` tag, private preview deploy

---

## 23. Non-Goals (MVP)

- Real-time collaborative editing  
- WYSIWYG / block editor  
- Mobile apps  
- Row-level note ACLs  
- Plugin marketplace  
- Billing machinery  
- Public project pages  
- Built-in LLM / agent runner  
- Multi-region  
- Full Notion import  

---

## 24. Success Metrics

| Metric | Target (90 days post-MVP) |
|---|---|
| Private beta workspaces | 20 |
| Median projects / workspace | 3 |
| Agent API calls / week | 1,000 |
| Active projects with AGENTS.md fetched ≥1x/week | 80% |
| Time-to-first-agent-write (new workspace) | < 15 minutes |
| Hosted → export successful | 100% of requests |
| NPS (beta) | > 40 |
| Sev-1 incidents | 0 lasting > 4h |

**North-star (recommendation):** *Weekly Agent-Updated Projects* — projects where ≥1 agent wrote a note/checklist item in the last 7 days.

---

## 25. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Becomes “yet another doc tool” | Ruthlessly agent-native; MCP + `/context` demos |
| Scope creep to orchestrator | Non-goals; refuse runtimes |
| Lost updates human vs agent | ETags on notes; events for checklists |
| OSS free-rider, no SaaS conversion | Invite-only hosted value; SSO/support later |
| Prompt injection via shared notes | Docs + scopes; optional allowlisted write paths later |
| Six-day MVP too aggressive | Cut web polish before cutting Agent API |

---

## 26. Compliance, Legal, Brand

- OSS: **MIT** (all core packages)  
- Hosted: LatticeAG ToS + Privacy Policy before public invites  
- DPA for Enterprise  
- Trademark: VisBoard / Vis series naming reserved by LatticeAG  
- Do not collect model training data from customer content  
- Cookie/minimal analytics on marketing only; product telemetry opt-in for self-host  

---

## 27. Documentation Deliverables (before coding features)

1. This SPEC.md  
2. ADR folder (`/docs/adr`)  
3. OpenAPI draft (`/openapi/openapi.yaml`) — can be stubbed Day 1–2  
4. AGENTS.md protocol doc  
5. Threat model one-pager  
6. Self-host Compose README outline  

---

## 28. Open Questions — with recommendations

| # | Question | Recommendation | Confidence |
|---|---|---|---|
| 1 | Cloudflare Workers vs Node for MVP? | **Node via Vercel Fluid Compute**; Docker for self-host. Avoid Workers for core API. | High |
| 2 | OIDC providers for self-host launch? | Document **GitHub + Google + generic OIDC** (Keycloak/Dex). Hosted: **Clerk or Auth0** (pick one Day 1). | High |
| 3 | File storage dedupe (content-addressed) vs simple blobs? | **Simple UUID/blob paths for MVP**; add sha256 dedupe in Phase 2. | High |
| 4 | Hosted → self-host migration path? | **Export zip MVP**; `visboard import` in Phase 2. Document mapping. | High |
| 5 | Hono standalone vs Next route handlers? | Prefer **Hono mounted in Next *or* separate `apps/api`** for clean Docker self-host. Slight lean: **separate `apps/api` with Hono**. | Medium-High |
| 6 | Auth vendor? | **Clerk** if speed/UI matter; **WorkOS** if SSO in <90 days is certain. Default: **Clerk for MVP**. | Medium |
| 7 | Checklist-only in markdown vs first-class? | **First-class + markdown sync** (see §7.4). | High |
| 8 | Real-time in MVP? | **No** — polling. SSE in Phase 2. | High |
| 9 | Public OSS day-1 vs after private dogfood? | **Private repo until MVP tag**, then public MIT once smoke-tested (avoid broken first impression). | Medium-High |
| 10 | MCP in MVP week? | **Not in 6-day MVP**; first item in Phase 2. | High |
| 11 | Multi-region? | **No** until Enterprise demand. | High |
| 12 | Python SDK? | After TS SDK stable; community contributions welcome. | High |
| 13 | Comments in schema now? | Reserve event types; **no UI** in MVP. | High |
| 14 | Brand domain? | `visboard.io` if owned; else `vis.latticeag.com` interim. Confirm DNS. | Need input |
| 15 | Seat vs agent pricing? | Humans as seats; agents pooled — finalize before Team launch, not MVP. | Medium |
| 16 | Monorepo vs polyrepo? | **Monorepo** (pnpm + Turborepo). | High |
| 17 | RLS in Postgres at MVP? | App-layer + tests at MVP; RLS Phase 2. | High |
| 18 | Marketing site in same app? | Separate lightweight marketing route or site; don’t block API. | Medium |

---

## 29. Questions for you (LatticeAG)

Please answer these where you disagree or have hard constraints. Where silent, we proceed with the recommendations above.

1. **Hybrid confirmation:** Agree MIT core + invite-only hosted SaaS (no BSL/AGPL)?  
2. **Auth vendor preference:** Clerk vs Auth0 vs WorkOS vs other?  
3. **Domain:** Do we have `visboard.io`?  
4. **Invite gate:** Who issues invites (you manually, LatticeAG admin UI, waitlist Airtable)?  
5. **Dogfood project:** Which internal LatticeAG workflow is the first real tenant?  
6. **Design language:** Any existing Vis-series visual system to inherit?  
7. **Hard deadline:** Is the six-day MVP a real calendar constraint or a scoping metaphor?  
8. **Public GitHub timing:** Private until `v0.1.0-mvp`, then public — OK?  
9. **Agent key UX:** Workspace-scoped keys vs project-scoped only at MVP? (**Rec: project-scoped by default, optional workspace read**.)  
10. **Name lock:** VisBoard final, or still exploring Vis* names?

---

## 30. Decision Log (working)

| Date | Decision | Notes |
|---|---|---|
| 2026-07-11 | Product: VisBoard shared agent-human workspace | Initial SPEC |
| 2026-07-11 | Business model: **Hybrid** (MIT OSS + invite-only SaaS) | Expanded SPEC v0.2 |
| 2026-07-11 | License: MIT for core; no dual-license | Trust / ecosystem |
| 2026-07-11 | Hosted API on Vercel Fluid Compute (Node), not Workers | Ops + compatibility |
| 2026-07-11 | DB: Postgres (Neon on hosted) | Marketplace |
| 2026-07-11 | ORM: Drizzle | ADR to formalize |
| 2026-07-11 | Real-time deferred; polling MVP | Scope control |
| 2026-07-11 | MCP server = Phase 2 priority | Distribution |

---

## 31. License

Open-source components: **MIT License**.  
Hosted service: LatticeAG Terms of Service (to be drafted before wider invites).

---

## 32. Appendix — MVP Smoke Test Script

```text
1. Human authenticates
2. Create workspace + project
3. Create note "Purpose"
4. Create checklist with 3 items
5. Create agent key (read, write:checklists, write:events)
6. Agent: GET /agents.md and GET /context
7. Agent: check item 1; POST event agent.turn.completed
8. Human: refresh activity; see event; uncheck item 1
9. Agent: poll events; observe human change
10. Upload file; agent lists files
11. Export workspace
```

If all 11 pass, MVP is real.

---

*End of SPEC v0.2 — planning only; no implementation until sign-off on §29 questions (defaults apply if unanswered).*
