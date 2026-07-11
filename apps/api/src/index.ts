import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { getEnv } from "./env.js";

const env = getEnv();
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
