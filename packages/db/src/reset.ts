import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createDbFromEnv } from "./client.js";
import { resolveResetDatabaseUrl } from "./reset-url.js";

/**
 * Drop and recreate the public schema.
 * Used by CI between the test suite and the V1 smoke so the smoke's
 * one-time bootstrap (allowed only with zero workspaces) sees an empty DB.
 */
async function reset() {
  let envFileUrl: string | undefined;
  try {
    envFileUrl = parseEnv(
      readFileSync(fileURLToPath(new URL("../../../.env", import.meta.url)), "utf8"),
    ).DATABASE_URL;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const databaseUrl = resolveResetDatabaseUrl(process.env.DATABASE_URL, envFileUrl);
  const target = new URL(databaseUrl);
  console.log(
    `Resetting database ${target.pathname.slice(1)} on ${target.hostname}:${target.port || "5432"}`,
  );

  const { client } = createDbFromEnv(databaseUrl);
  // public: application tables. drizzle: drizzle-kit's __drizzle_migrations
  // bookkeeping. Both must go or migrate sees "already applied" and skips.
  await client.unsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await client.unsafe("CREATE SCHEMA public");
  await client.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await client.end();
  console.log("Database reset: public + drizzle schemas dropped; public recreated");
  console.log("Run db:migrate afterwards to restore the schema.");
}

await reset();
