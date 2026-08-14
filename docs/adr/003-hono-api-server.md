# ADR 003: Hono API server

**Status:** Accepted  
**Date:** 2026-07-11

## Context

VisBoard is API-native: agents and the CLI treat HTTP endpoints as ground truth. The server must be lightweight, TypeScript-first, and deployable in Docker without platform lock-in.

## Decision

Use **Hono 4.x** as the standalone HTTP framework in `apps/api`:

- Single Node.js process listening on `PORT` (default 8080)
- Middleware chain for auth, rate limiting, and RFC 7807 error responses
- Route modules per resource (`workspaces`, `projects`, `notes`, etc.)
- Base path `/v1` for versioned API surface

## Consequences

- No Next.js API routes: API is independently deployable and testable
- Hono's small footprint suits self-hosted OSS deployments
- OpenAPI spec can be generated or maintained alongside routes
- Wave 2 builds `apps/api` on top of `@visboard/db` and `@visboard/shared`

## Alternatives considered

- **Express**: larger ecosystem but less ergonomic TypeScript DX
- **Fastify**: viable; Hono chosen for middleware composition and edge portability
- **tRPC**: explicitly excluded; REST + OpenAPI preferred for agent interoperability
