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
  return c.json(
    problem(err.status, err.title, err.detail, c.req.path),
    err.status,
    { "Content-Type": "application/problem+json" },
  );
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
