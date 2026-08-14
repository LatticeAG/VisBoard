# ADR 002: Drizzle ORM with PostgreSQL 16

**Status:** Accepted  
**Date:** 2026-07-11

## Context

VisBoard stores workspaces, projects, notes, checklists, files, agents, and an append-only event stream. We need type-safe queries, migration management, and compatibility with self-hosted Docker Compose deployments.

## Decision

Use **Drizzle ORM** with **PostgreSQL 16**:

- Schema defined in TypeScript under `packages/db/src/schema/`
- `drizzle-kit` for migration generation and application
- `timestamptz` columns with `now()` defaults for all timestamps
- Prefixed ULID text primary keys (see ADR on IDs in SPEC §7.1)

## Consequences

- Schema and migrations live in `@visboard/db`, consumed by `@visboard/api`
- No Prisma code generation step; SQL migrations are explicit and reviewable
- Postgres 16 runs in Docker Compose with a healthcheck before API startup
- Soft deletes via `deleted_at` nullable columns where specified

## Alternatives considered

- **Prisma**: explicitly excluded in Phase 1 spec
- **Raw SQL**: loses TypeScript inference and migration tooling
- **SQLite**: insufficient for concurrent multi-user OSS deployments
