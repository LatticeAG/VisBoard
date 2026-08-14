import type { Context } from "hono";
import type { ZodType } from "zod";
import { badRequest } from "./errors.js";

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
