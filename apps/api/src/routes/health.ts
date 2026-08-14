import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db.js";
import { serviceUnavailable } from "../lib/errors.js";

export const API_VERSION =
  process.env.VISBOARD_VERSION ?? process.env.npm_package_version ?? "0.1.0";

export const healthRoutes = new Hono();

healthRoutes.get("/health", (c) => c.json({ status: "ok", version: API_VERSION }));

healthRoutes.get("/readyz", async (c) => {
  try {
    const { db } = getDb();
    await db.execute(sql`select 1`);
    return c.json({ status: "ok", version: API_VERSION, db: "ok" });
  } catch {
    throw serviceUnavailable("Database is not ready");
  }
});
