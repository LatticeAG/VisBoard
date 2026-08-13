import {
  createTemplateSchema,
  createTemplateVersionSchema,
} from "@visboard/shared";
import { Hono } from "hono";
import { authMiddleware, requireScope } from "../auth/middleware.js";
import { getDb } from "../db.js";
import { badRequest } from "../lib/errors.js";
import {
  createTemplate,
  createTemplateVersion,
  getTemplate,
  listTemplates,
} from "../services/template.js";

export const templateRoutes = new Hono();

templateRoutes.use("*", authMiddleware);

function parseJson<T>(parsed: { success: boolean; data?: T; error?: { message: string } }): T {
  if (!parsed.success || parsed.data === undefined) {
    throw badRequest(parsed.error?.message ?? "Invalid request body");
  }
  return parsed.data;
}

templateRoutes.get("/", requireScope("read", "admin"), async (c) => {
  const auth = c.get("auth");
  const { db } = getDb();
  return c.json({ data: await listTemplates(db, auth.workspaceIds) });
});

templateRoutes.post("/", requireScope("admin"), async (c) => {
  const auth = c.get("auth");
  const { db } = getDb();
  const input = parseJson(createTemplateSchema.safeParse(await c.req.json()));
  return c.json(await createTemplate(db, auth, input), 201);
});

templateRoutes.post(
  "/:template/versions",
  requireScope("admin"),
  async (c) => {
    const auth = c.get("auth");
    const templateId = c.req.param("template");
    if (!templateId) throw badRequest("Missing template path parameter");
    const { db } = getDb();
    const input = parseJson(
      createTemplateVersionSchema.safeParse(await c.req.json()),
    );
    return c.json(await createTemplateVersion(db, auth, templateId, input), 201);
  },
);

templateRoutes.get("/:template", requireScope("read", "admin"), async (c) => {
  const templateId = c.req.param("template");
  if (!templateId) throw badRequest("Missing template path parameter");
  const { db } = getDb();
  return c.json(await getTemplate(db, templateId));
});
