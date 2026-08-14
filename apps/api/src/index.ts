import { serve } from "@hono/node-server";
import { runMigrations } from "@visboard/db";
import { createApp } from "./app.js";
import { getDb, listenClient } from "./db.js";
import { getEnv } from "./env.js";
import { resolveSecretsKey } from "./lib/secrets.js";
import { setAgentWorkflowTransport } from "./routes/agent-workflows.js";
import { setAutomationEngine } from "./routes/automations.js";
import { PostgresAgentTransport } from "./services/agent-transport-pg.js";
import { flushAgentsMdSync } from "./services/agents-md-sync.js";
import { loadAutomationEngineFromDb, recoverAutomationRuns } from "./services/automation.js";
import { dispatchProjectEventFromNotify } from "./services/event.js";

async function main(): Promise<void> {
  const env = getEnv();

  if (env.VISBOARD_AUTO_MIGRATE) {
    console.log("VISBOARD_AUTO_MIGRATE=1: applying Drizzle migrations");
    await runMigrations(env.DATABASE_URL);
    console.log(
      "Existing PATs and agent keys were revoked. Run visboard auth bootstrap or create new keys.",
    );
  }

  resolveSecretsKey(env);
  setAgentWorkflowTransport(new PostgresAgentTransport(getDb()));
  const automationEngine = await loadAutomationEngineFromDb(getDb().db);
  setAutomationEngine(automationEngine);
  await recoverAutomationRuns(getDb().db, automationEngine);
  await listenClient().listen("visboard_events", (payload) => {
    dispatchProjectEventFromNotify(payload);
  });

  const app = createApp();

  serve(
    {
      fetch: app.fetch,
      port: env.PORT,
    },
    (info) => {
      console.log(`VisBoard API listening on http://localhost:${info.port}`);
    },
  );

  const shutdown = () => {
    void flushAgentsMdSync().finally(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
