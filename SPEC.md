# VisBoard

**Status:** Spec-only  
**Series:** Vis (interface / workspace)  
**Pattern:** OSS CLI + SDK (MIT) + invite-only hosted SaaS  
**License:** MIT (OSS repo); hosted backend terms governed by LatticeAG SaaS  
**Tagline:** A shared workspace where agents and humans plan, write, and ship together.

---

## 1. Problem

Agentic workflows are becoming collaborative, but the tools we use to manage them are not. Today, a team running multiple agents ends up with:

- **Scattered context:** prompts, outputs, logs, and artifacts live in separate dashboards, chat threads, and local files.
- **No shared ground truth:** humans and agents cannot point to the same task, note, or checklist in one place.
- **Friction handoffs:** moving from agent output to human review, or from plan to execution, requires copy-paste across systems.
- **Onboarding cost:** every new agent joining a project needs to reconstruct context from ad-hoc documents and conversation history.

Project-management tools are human-first. Agent frameworks are code-first. There is no lightweight, web-first workspace designed for both.

---

## 2. Target Users

| Segment | Role | Primary Need |
|---|---|---|
| **Agent engineers** | Build and operate autonomous agents | A structured context surface their agents can read and write via API |
| **Product / ops teams** | Coordinate agent + human work | Shared project views, checklists, and progress tracking |
| **Studio / agency teams** | Run client projects with AI collaborators | Branded workspaces with files, notes, and deliverables |
| **LatticeAG internal teams** | Dogfood the Vis series | First production tenant; drives roadmap and integrations |

---

## 3. Core Concepts

### 3.1 Workspace

A **Workspace** is the top-level container. It owns projects, members, billing, and integrations. Workspaces map to organizations or teams.

### 3.2 Project

A **Project** is a collaborative container inside a workspace. It contains notes, checklists, files, and an event stream. Projects have:

- A slug, name, description, and status (`draft`, `active`, `archived`).
- A list of participants (humans and agents).
- An auto-generated `AGENTS.md` file that describes the project for any agent that joins.

### 3.3 Note

A **Note** is a markdown document. Notes support:

- GitHub-flavored markdown.
- Frontmatter (YAML) for metadata.
- Embedded checklists (`- [ ]`).
- Attachments referenced by ID.
- Version history.

### 3.4 Checklist

A **Checklist** is a first-class entity extracted from or linked to a note. It provides:

- Toggling state.
- Assignees (human or agent).
- Due dates.
- Blocking relationships (`blocked_by`).

### 3.5 File / Attachment

Files can be uploaded to a project or attached to a note. Supported at MVP:

- Text files, images, PDFs, JSON, YAML, markdown.
- Max file size: 10 MB per file (hosted), configurable for self-hosted.
- Files are referenced by a stable ID and can be fetched by agents via API.

### 3.6 Agent

An **Agent** is a participant with an API key and a role. Agents can:

- Read project notes, checklists, and files.
- Create and update notes and checklists.
- Append events to the project stream.
- Read `AGENTS.md` for self-onboarding.

Agents are identified by a key + optional metadata (name, description, capabilities).

### 3.7 Event Stream

Every project has an append-only **Event Stream** recording creates, updates, comments, and agent actions. It is the audit log and the substrate for real-time updates.

### 3.8 AGENTS.md

Each project auto-generates and keeps synchronized an `AGENTS.md` file containing:

- Project purpose and scope.
- Directory of existing notes and their roles.
- Active checklists and priorities.
- Conventions, naming rules, and guardrails.
- How to participate via the VisBoard Agent API.

`AGENTS.md` is the single source of truth for any agent joining a project.

---

## 4. Product Surface

### 4.1 Web Application (hosted SaaS)

- **Dashboard:** workspace switcher, project list, recent activity.
- **Project view:** three-pane layout (sidebar navigation, note/checklist editor, activity stream).
- **Editor:** markdown editor with live preview, frontmatter editing, and checklist toggling.
- **File manager:** upload, preview, copy reference links.
- **Agent registry:** create keys, set scopes, view agent activity.
- **Settings:** workspace members, billing, integrations, export.

### 4.2 CLI (open-source)

A local-first command-line interface for developers who prefer terminal workflows or need CI/CD integration.

### 4.3 SDK (open-source)

TypeScript SDK for building agents and integrations. REST API is documented and can be used directly from any language.

---

## 5. API Surface

Base URL for hosted SaaS: `https://api.visboard.io/v1`  
Base URL for self-hosted: configurable, default `/v1`

All endpoints require an `Authorization: Bearer <token>` header. Tokens are either user session tokens or agent API keys.

### 5.1 Workspaces

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces` | List workspaces for the caller |
| `GET` | `/workspaces/{ws}` | Get workspace details |
| `PATCH` | `/workspaces/{ws}` | Update workspace settings |

### 5.2 Projects

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects` | List projects |
| `POST` | `/workspaces/{ws}/projects` | Create project |
| `GET` | `/workspaces/{ws}/projects/{p}` | Get project |
| `PATCH` | `/workspaces/{ws}/projects/{p}` | Update project |
| `DELETE` | `/workspaces/{ws}/projects/{p}` | Archive project |
| `GET` | `/workspaces/{ws}/projects/{p}/agents.md` | Fetch generated AGENTS.md |

### 5.3 Notes

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects/{p}/notes` | List notes |
| `POST` | `/workspaces/{ws}/projects/{p}/notes` | Create note |
| `GET` | `/workspaces/{ws}/projects/{p}/notes/{id}` | Get note |
| `PATCH` | `/workspaces/{ws}/projects/{p}/notes/{id}` | Update note |
| `DELETE` | `/workspaces/{ws}/projects/{p}/notes/{id}` | Delete note |

### 5.4 Checklists

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects/{p}/checklists` | List checklists |
| `POST` | `/workspaces/{ws}/projects/{p}/checklists` | Create checklist |
| `GET` | `/workspaces/{ws}/projects/{p}/checklists/{id}` | Get checklist |
| `PATCH` | `/workspaces/{ws}/projects/{p}/checklists/{id}` | Update checklist item state |
| `DELETE` | `/workspaces/{ws}/projects/{p}/checklists/{id}` | Delete checklist |

### 5.5 Files

| Method | Path | Description |
|---|---|---|
| `POST` | `/workspaces/{ws}/projects/{p}/files` | Upload file (multipart) |
| `GET` | `/workspaces/{ws}/projects/{p}/files` | List files |
| `GET` | `/workspaces/{ws}/projects/{p}/files/{id}` | Download file |
| `DELETE` | `/workspaces/{ws}/projects/{p}/files/{id}` | Delete file |

### 5.6 Agent API

| Method | Path | Description |
|---|---|---|
| `GET` | `/workspaces/{ws}/projects/{p}/context` | Get full project context (notes, checklists, files, AGENTS.md) |
| `POST` | `/workspaces/{ws}/projects/{p}/events` | Append an agent event |
| `GET` | `/workspaces/{ws}/projects/{p}/events` | Stream or poll events |
| `POST` | `/workspaces/{ws}/projects/{p}/notes` | Create or update note as agent |
| `PATCH` | `/workspaces/{ws}/projects/{p}/checklists/{id}` | Toggle checklist item |

### 5.7 Common Resource Shape

```json
{
  "id": "nt_...",
  "slug": "product-spec",
  "title": "Product Spec",
  "body": "# Product Spec\n...",
  "frontmatter": { "status": "draft", "owner": "agent-1" },
  "created_at": "2026-07-11T00:00:00Z",
  "updated_at": "2026-07-11T00:00:00Z",
  "created_by": "user_...",
  "updated_by": "agent_..."
}
```

### 5.8 Real-Time Updates (post-MVP stretch)

WebSocket or SSE stream for live collaboration. MVP uses polling on the event stream.

---

## 6. CLI Commands

The open-source CLI is named `visboard`. It is the primary interface for self-hosted deployments and developer workflows.

### 6.1 Authentication

```bash
visboard auth login          # Browser-based OAuth for hosted SaaS
visboard auth status         # Show authenticated account
visboard auth logout         # Clear credentials
visboard auth use-key        # Use an agent API key directly
```

### 6.2 Workspace & Project

```bash
visboard workspace list
visboard workspace create --name "Acme Agents"
visboard workspace switch <slug>

visboard project list
visboard project create --name "Q3 Agent Pipeline" --slug q3-pipeline
visboard project show <slug>
visboard project archive <slug>
```

### 6.3 Notes

```bash
visboard note list --project <slug>
visboard note create --project <slug> --title "Spec" --file ./spec.md
visboard note edit --project <slug> <note-slug>           # Opens $EDITOR
visboard note view --project <slug> <note-slug>
visboard note delete --project <slug> <note-slug>
```

### 6.4 Checklists

```bash
visboard checklist list --project <slug>
visboard checklist create --project <slug> --title "Launch tasks"
visboard checklist check --project <slug> <checklist-id> <item-id>
visboard checklist uncheck --project <slug> <checklist-id> <item-id>
```

### 6.5 Files

```bash
visboard file upload --project <slug> ./data.json
visboard file list --project <slug>
visboard file download --project <slug> <file-id> ./downloads/
visboard file delete --project <slug> <file-id>
```

### 6.6 Agents

```bash
visboard agent list --project <slug>
visboard agent create --project <slug> --name "Reviewer" --scope read,write-checklists
visboard agent revoke --project <slug> <agent-id>
```

### 6.7 Context

```bash
visboard context --project <slug>             # Print project context for an agent
visboard agents-md --project <slug>           # Print generated AGENTS.md
visboard agents-md --project <slug> --sync    # Regenerate AGENTS.md from current state
```

### 6.8 Local / Self-Hosted

```bash
visboard config set endpoint http://localhost:8080
visboard config get endpoint
visboard status                               # Check API health
```

---

## 7. Security Model

### 7.1 Identity & Authentication

- **Human users:** OAuth 2.0 / OIDC through the hosted SaaS. Self-hosted instances can configure any OIDC provider.
- **Agents:** API keys (long-lived, revocable) scoped per workspace or per project.
- **CLI:** Stores tokens in OS keychain or `$XDG_CONFIG_HOME/visboard/credentials`.

### 7.2 Authorization

Role-based access control (RBAC) with two dimensions:

**Workspace roles:**
- `owner` — full control, billing, deletion
- `admin` — member management, settings
- `member` — create and participate in projects
- `guest` — access only explicitly shared projects

**Project roles:**
- `editor` — read/write notes, checklists, files
- `viewer` — read-only
- `agent:<scope>` — agent-specific permission set

### 7.3 Agent Scopes

| Scope | Capability |
|---|---|
| `read` | Read notes, checklists, files, AGENTS.md |
| `write:notes` | Create and update notes |
| `write:checklists` | Create and toggle checklists |
| `write:files` | Upload and delete files |
| `write:events` | Append to event stream |
| `admin` | Full project access |

### 7.4 Data Safety

- All data encrypted at rest (AES-256) and in transit (TLS 1.3).
- File uploads scanned for malware in hosted SaaS.
- Workspace export available at any time (JSON + attachments zip).
- Audit log retained for the lifetime of the workspace.

---

## 8. Deployment Model

### 8.1 Hosted SaaS (invite-only)

LatticeAG operates the hosted backend at `https://visboard.io`.

- **Availability target:** 99.9% uptime.
- **Regions:** start with US-East; expand based on demand.
- **Tenancy:** workspace-scoped data isolation in a multi-tenant architecture.
- **Backups:** daily point-in-time recovery with 30-day retention.
- **Invites:** workspace creation is invite-only; public signup is disabled.

### 8.2 Self-Hosted (OSS)

The server is open-sourced under MIT and can be self-hosted.

- **Runtime:** Node.js or container image.
- **Database:** PostgreSQL 15+.
- **Object storage:** S3-compatible (optional; local filesystem for small installs).
- **Authentication:** OIDC provider required.
- **No telemetry by default.** Optional anonymous usage stats, opt-in.

### 8.3 CLI / SDK Distribution

- CLI binaries distributed via GitHub Releases and npm (`@latticeag/visboard`).
- SDK published as `@latticeag/visboard-sdk` on npm.
- Rust or Python SDKs considered after TypeScript SDK stabilizes.

---

## 9. Six-Day MVP Milestones

### Day 1 — Foundation

- [ ] Finalize SPEC.md and create private GitHub repo.
- [ ] Bootstrap server repo structure (no feature code, just conventions).
- [ ] Choose ORM + migration framework; commit ADR.
- [ ] Set up CI skeleton (lint, typecheck, test placeholder).

### Day 2 — Workspace & Project

- [ ] Database schema for workspaces, projects, members.
- [ ] REST endpoints: workspace CRUD, project CRUD.
- [ ] JWT / session auth for human users.
- [ ] CLI: `auth`, `workspace`, `project` commands.

### Day 3 — Notes & Markdown

- [ ] Note CRUD endpoints with frontmatter parsing.
- [ ] Markdown editor in web app (basic textarea + preview).
- [ ] CLI: `note` commands.
- [ ] Version history table (one snapshot per update).

### Day 4 — Checklists & Files

- [ ] Checklist entity and endpoints.
- [ ] Inline checklist parsing from markdown notes.
- [ ] File upload / download endpoints (local storage for MVP).
- [ ] CLI: `checklist` and `file` commands.

### Day 5 — Agent API & AGENTS.md

- [ ] Agent API key model and scopes.
- [ ] `/context` endpoint returning project snapshot.
- [ ] AGENTS.md generation and sync endpoint.
- [ ] CLI: `agent`, `context`, `agents-md` commands.

### Day 6 — Web Shell & Polish

- [ ] Minimal web UI covering dashboard, project view, editor, file list.
- [ ] End-to-end smoke test: human creates project → agent reads context → agent updates checklist.
- [ ] README, API docs stub, and repo hygiene.
- [ ] Tag `v0.1.0-mvp` and deploy private SaaS preview.

---

## 10. Pricing & Positioning

### 10.1 Positioning

VisBoard is the **shared context layer** for agent-human teams. It sits between general-purpose project management and agent framework logs, giving both sides a single place to coordinate.

- **For agent engineers:** a structured surface their agents can read and write.
- **For operators:** visibility into what agents are doing without losing human control.
- **Differentiator:** first-class agent participants, auto-generated `AGENTS.md`, and API-native design.

### 10.2 Pricing (hosted SaaS)

| Tier | Price | Includes |
|---|---|---|
| **Open Source** | Free | Self-hosted; unlimited users, projects, and agents (community support) |
| **Starter** | Free (invite-only) | 1 workspace, 3 projects, 5 agents, 1 GB storage |
| **Team** | $29 / seat / month | Unlimited projects, 50 agents, 100 GB storage, SSO, priority support |
| **Enterprise** | Custom | SLA, dedicated infra, audit exports, custom integrations |

Invite-only launch starts with Starter; Team billing added post-MVP.

### 10.3 OSS / SaaS Split

- **Open-source (MIT):** server, CLI, SDK, API specification.
- **Hosted (invite-only):** managed infrastructure, real-time sync, SSO, audit exports, and support.

Speed of iteration and managed integrations are the hosted moat; trust and extensibility come from open source.

---

## 11. Non-Goals (MVP)

To keep the MVP focused, the following are explicitly out of scope for the first six days:

- Real-time collaborative editing (use polling / event stream).
- Rich text / WYSIWYG editor.
- Mobile apps.
- Advanced permissions (e.g., row-level note ACLs).
- Marketplace or third-party plugins.
- Billing / subscription machinery.
- Public-facing project pages.

---

## 12. Success Metrics

| Metric | Target (90 days post-MVP) |
|---|---|
| Private beta workspaces | 20 |
| Projects created per workspace (median) | 3 |
| Agent API calls per week | 1,000 |
| Notes with AGENTS.md referenced | 80% of active projects |
| NPS from beta users | > 40 |

---

## 13. Open Questions

1. Should the hosted SaaS use Cloudflare Workers or a traditional Node.js server for the MVP?
2. Which OIDC provider(s) should be supported at launch for self-hosted installs?
3. Should file storage support Git LFS-style deduplication, or simple per-file blobs for MVP?
4. What is the migration path for users who later want to move from hosted to self-hosted?

---

## 14. License

Open-source components are released under the MIT License. The hosted service is subject to separate LatticeAG Terms of Service.
