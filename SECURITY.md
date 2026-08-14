# Security Policy

Report vulnerabilities through GitHub Security Advisories on [LatticeAG/VisBoard](https://github.com/LatticeAG/VisBoard/security/advisories). Do not open a public issue for a live credential leak or remote code execution report.

## Token hashing

Personal access tokens (`vb_pat_...`) and agent keys (`vb_agent_...`) are stored as HMAC-SHA-256 of the full token using `VISBOARD_TOKEN_PEPPER`. The pepper must be at least 32 characters. Documented example peppers are refused when `NODE_ENV=production`.

Tokens are shown once at bootstrap or agent create. Only the hash and an 8-character prefix are stored.

## Connector secrets

Integration webhook secrets are encrypted with AES-256-GCM.

- Preferred: set `VISBOARD_SECRETS_KEY` to 64 lowercase hex characters (32 bytes).
- Fallback: if unset, the API derives a key from `VISBOARD_TOKEN_PEPPER` and prints a stderr warning. Rotating the pepper will orphan stored connector secrets.

Never put provider secrets in board events, revisions, handoff packets, or workspace exports.

## Production defaults

Compose ships `visboard` / `visboard` for local Postgres. Production must set `POSTGRES_PASSWORD` and `DATABASE_URL` together. The API refuses `NODE_ENV=production` with those demo credentials unless `VISBOARD_ALLOW_INSECURE_DEFAULTS=1`.

## Web UI

The OSS web app stores the PAT in `localStorage` (`visboard_token`). That is XSS-sensitive. Content-Security-Policy on `/app` is `default-src 'self'` with `connect-src` limited to the API origin, `script-src 'self'`, and no `unsafe-eval`. Treat a compromised page as a compromised token: revoke it.

## Files

Uploads are capped by `VISBOARD_MAX_FILE_BYTES` (10MB default). Executables are rejected by MIME and magic bytes. SHA-256 of file bytes is stored on the row.
