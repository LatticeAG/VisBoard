# ADR 001: Monorepo with pnpm and Turborepo

**Status:** Accepted  
**Date:** 2026-07-11

## Context

VisBoard Phase 1 spans multiple deployable apps (API, web) and shared libraries (schemas, DB, SDK, CLI, agents-md). We need a structure that supports parallel development, shared TypeScript types, and consistent tooling.

## Decision

Use a **pnpm workspace monorepo** orchestrated by **Turborepo**:

- `pnpm` for fast, disk-efficient dependency management with workspace protocol (`workspace:*`)
- `turbo` for cached, parallel `build`, `test`, and `typecheck` tasks across packages
- Root-level Biome for lint/format and shared `tsconfig.base.json`

## Consequences

- All packages share one lockfile and consistent dependency versions
- Turborepo task graph ensures `@visboard/shared` builds before dependents
- Apps under `apps/` and libraries under `packages/` follow a predictable layout
- CI runs a single `pnpm install` at the root

## Alternatives considered

- **npm workspaces** — slower installs, weaker workspace linking
- **Nx** — heavier than needed for Phase 1 scope
- **Separate repos** — duplicates types and slows cross-package changes
