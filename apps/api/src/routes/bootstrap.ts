import { Hono } from "hono";
import { getDb } from "../db.js";
import { bootstrap } from "../services/workspace.js";

export const bootstrapRoutes = new Hono();

bootstrapRoutes.post("/bootstrap", async (c) => {
  const body = await c.req.json<{
    name: string;
    slug?: string;
  }>();
  const bootstrapToken = c.req.header("X-Bootstrap-Token");
  const { db } = getDb();
  const result = await bootstrap(db, {
    name: body.name,
    slug: body.slug,
    bootstrapToken,
  });
  return c.json(result, 201);
});
