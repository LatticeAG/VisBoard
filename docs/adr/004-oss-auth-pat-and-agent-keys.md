# ADR 004: OSS auth with PAT and agent API keys

**Status:** Accepted  
**Date:** 2026-07-11

## Context

Phase 1 is self-hosted OSS with no OIDC/SSO. Humans (CLI, web UI) and autonomous agents both need credentials that map to scopes and workspace access.

## Decision

Implement two credential types, both via `Authorization: Bearer`:

1. **Personal Access Tokens (PAT)** — `vb_pat_<32 base62 chars>`, stored as SHA-256 hash with server pepper
2. **Agent API keys** — `vb_agent_<32 base62 chars>`, same hashing model

Auth middleware resolution order:

1. Hash token with `VISBOARD_TOKEN_PEPPER`
2. Lookup `personal_access_tokens` (not revoked/expired)
3. Else lookup `agents` where `status = active`
4. Else 401

Bootstrap via `POST /v1/bootstrap` when zero workspaces exist or `X-Bootstrap-Token` matches env.

## Consequences

- No Clerk, Auth0, or user registration UI in Phase 1
- Scopes enforced in `@visboard/shared` (`scopes.ts`) and API middleware
- Tokens shown once on creation; only hash + 8-char prefix stored
- Web UI stores PAT in `localStorage` for OSS MVP

## Alternatives considered

- **OIDC/SSO** — deferred to Phase 2 plugin
- **Session cookies** — less suitable for CLI and agent automation
- **API keys only** — insufficient distinction between human and agent principals
