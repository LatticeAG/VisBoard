import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
}

const ERROR_TYPES: Record<number, string> = {
  400: "https://visboard.dev/errors/bad-request",
  401: "https://visboard.dev/errors/unauthorized",
  403: "https://visboard.dev/errors/forbidden",
  404: "https://visboard.dev/errors/not-found",
  409: "https://visboard.dev/errors/conflict",
  412: "https://visboard.dev/errors/precondition-failed",
  413: "https://visboard.dev/errors/payload-too-large",
  429: "https://visboard.dev/errors/rate-limited",
  500: "https://visboard.dev/errors/internal",
  501: "https://visboard.dev/errors/not-implemented",
  503: "https://visboard.dev/errors/unavailable",
};

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public title: string,
    public detail?: string,
  ) {
    super(detail ?? title);
    this.name = "ApiError";
  }
}

export function problem(
  status: ContentfulStatusCode,
  title: string,
  detail?: string,
  instance?: string,
): ProblemDetails {
  return {
    type: ERROR_TYPES[status] ?? "https://visboard.dev/errors/unknown",
    title,
    status,
    detail,
    instance,
  };
}

export function jsonError(c: Context, err: ApiError) {
  return c.json(problem(err.status, err.title, err.detail, c.req.path), err.status, {
    "Content-Type": "application/problem+json",
  });
}

export function notFound(detail: string): ApiError {
  return new ApiError(404, "Not Found", detail);
}

export function unauthorized(detail = "Invalid or missing token"): ApiError {
  return new ApiError(401, "Unauthorized", detail);
}

export function forbidden(detail: string): ApiError {
  return new ApiError(403, "Forbidden", detail);
}

export function badRequest(detail: string): ApiError {
  return new ApiError(400, "Bad Request", detail);
}

export function conflict(detail: string): ApiError {
  return new ApiError(409, "Conflict", detail);
}

export function preconditionFailed(detail: string): ApiError {
  return new ApiError(412, "Precondition Failed", detail);
}

export function payloadTooLarge(detail: string): ApiError {
  return new ApiError(413, "Payload Too Large", detail);
}

export function rateLimited(detail = "Rate limit exceeded"): ApiError {
  return new ApiError(429, "Too Many Requests", detail);
}

export function serviceUnavailable(detail = "Database is not ready"): ApiError {
  return new ApiError(503, "Service Unavailable", detail);
}

export function notImplemented(detail: string): ApiError {
  return new ApiError(501, "Not Implemented", detail);
}

/**
 * True when the error is a PostgreSQL foreign key violation (SQLSTATE 23503).
 * Checked structurally because pg, drizzle, and tx wrappers surface different
 * error classes.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: unknown }).code === "23503") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Best-effort entity name behind a failed FK reference, e.g. 'agent' from
 * 'agent_runs_agent_id_fkey'. Used only to name the offending entity in a 4xx.
 */
export function foreignKeyReferenceDetail(error: unknown): string | null {
  const constraint =
    error && typeof error === "object"
      ? ((error as { constraint_name?: unknown }).constraint_name ??
        (error as { constraint?: unknown }).constraint)
      : undefined;
  if (typeof constraint === "string") {
    // Constraint digests look like 'agent_runs_agent_id_fkey' where the part
    // before the final '..._id_fkey' suffix names the referenced entity.
    const parts = constraint.split("_");
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (parts[index] === "id" && index > 0) {
        const entity = parts[index - 1];
        if (entity) return entity;
      }
    }
  }
  return null;
}
