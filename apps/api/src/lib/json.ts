import type { Context } from "hono";
import type { ZodType } from "zod";
import { badRequest, foreignKeyReferenceDetail, isForeignKeyViolation, notFound } from "./errors.js";

export async function readJson<T>(c: Context, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw badRequest(JSON.stringify(parsed.error.flatten()));
  }
  return parsed.data;
}

/**
 * Reads the request body as JSON for routes that validate fields manually.
 * Malformed JSON surfaces as a 400 instead of bubbling up as a 500.
 */
export async function readJsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
}

/**
 * Maps unknown referenced entities (PostgreSQL FK violations, SQLSTATE 23503)
 * to a 404 naming the missing entity. No-op for every other error class so
 * real 500s still surface.
 */
export function rethrowAsNotFoundIfForeignKey(error: unknown): void {
  if (!isForeignKeyViolation(error)) return;
  const entity = foreignKeyReferenceDetail(error) ?? "resource";
  throw notFound(`The referenced ${entity} does not exist`);
}
