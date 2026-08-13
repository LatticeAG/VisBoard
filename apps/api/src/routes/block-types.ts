import { BLOCK_TYPE_REGISTRY } from "@visboard/shared";
import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";

/** Shared registry discovery lets clients render safely without inventing types. */
export const blockTypeRoutes = new Hono();

blockTypeRoutes.use("*", authMiddleware);
blockTypeRoutes.get("/", requireScope("read", "admin"), (c) =>
  c.json({ data: BLOCK_TYPE_REGISTRY }),
);
