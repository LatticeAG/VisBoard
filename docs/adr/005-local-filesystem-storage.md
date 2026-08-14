# ADR 005: Local filesystem storage

**Status:** Accepted  
**Date:** 2026-07-11

## Context

Phase 1 file uploads (JSON exports, attachments) must work in self-hosted Docker without cloud object storage credentials.

## Decision

Store uploaded files on the **local filesystem** under `VISBOARD_DATA_DIR`:

- Default `./data` for local dev; `/data` volume in Docker Compose
- Storage path pattern: `{project_id}/{file_id}/{safe_name}`
- Filename sanitization to prevent path traversal
- Max file size 10MB; reject `application/x-executable`
- Metadata in `files` table (`storage_path`, `mime_type`, `size_bytes`, optional `sha256`)

## Consequences

- No Vercel Blob, S3, or Redis in Phase 1
- Single-node deployments are straightforward; multi-node replication is out of scope
- Export endpoint can zip DB JSON + files from the same data directory
- Phase 2 may add S3-compatible storage as an optional backend

## Alternatives considered

- **S3/MinIO**: adds operational complexity for OSS quick start
- **Database BLOBs**: poor performance for larger files
- **Vercel Blob**: platform-specific; excluded for OSS-first phase
