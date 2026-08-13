import { Hono } from "hono";
import { cors } from "hono/cors";
import { getEnv } from "./env.js";
import { ApiError, jsonError } from "./lib/errors.js";
import { healthRoutes } from "./routes/health.js";
import { bootstrapRoutes } from "./routes/bootstrap.js";
import { workspaceRoutes } from "./routes/workspaces.js";
import { projectRoutes } from "./routes/projects.js";
import { noteRoutes } from "./routes/notes.js";
import { checklistRoutes } from "./routes/checklists.js";
import { fileRoutes } from "./routes/files.js";
import { agentRoutes } from "./routes/agents.js";
import { eventRoutes } from "./routes/events.js";
import { contextRoutes } from "./routes/context.js";
import { boardRoutes } from "./routes/boards.js";
import { templateRoutes } from "./routes/templates.js";
import { blockTypeRoutes } from "./routes/block-types.js";
import { agentWorkflowRoutes } from "./routes/agent-workflows.js";
import { automationRoutes } from "./routes/automations.js";
import { integrationRoutes } from "./routes/integrations.js";
import { interchangeRoutes } from "./routes/interchange.js";

export function createApp() {
  const env = getEnv();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: env.VISBOARD_CORS_ORIGIN,
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "If-Match",
        "If-Board-Revision",
        "If-Board-Document",
        "Idempotency-Key",
        "X-Bootstrap-Token",
      ],
      exposeHeaders: ["ETag", "Retry-After"],
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return jsonError(c, err);
    }
    console.error(err);
    return jsonError(
      c,
      new ApiError(500, "Internal Server Error", "An unexpected error occurred"),
    );
  });

  app.route("/", healthRoutes);

  const v1 = new Hono();
  v1.route("/", bootstrapRoutes);
  v1.route("/workspaces", workspaceRoutes);
  v1.route("/workspaces/:ws/projects", projectRoutes);
  v1.route("/workspaces/:ws/projects/:p/notes", noteRoutes);
  v1.route("/workspaces/:ws/projects/:p/checklists", checklistRoutes);
  v1.route("/workspaces/:ws/projects/:p/files", fileRoutes);
  v1.route("/workspaces/:ws/agents", agentRoutes);
  v1.route("/workspaces/:ws/projects/:p/events", eventRoutes);
  v1.route("/workspaces/:ws/projects/:p", contextRoutes);

  app.route("/v1", v1);

  const v2 = new Hono();
  v2.route("/workspaces/:workspace/boards", boardRoutes);
  v2.route("/workspaces/:workspace/boards", interchangeRoutes);
  v2.route("/workspaces/:workspace/boards", agentWorkflowRoutes);
  v2.route("/templates", templateRoutes);
  v2.route("/block-types", blockTypeRoutes);
  v2.route("/", integrationRoutes);
  v2.route("/", automationRoutes);
  app.route("/v2", v2);

  return app;
}
