import { createDbFromEnv } from "./client.js";

/**
 * Drop and recreate the public schema.
 * Used by CI between the test suite and the V1 smoke so the smoke's
 * one-time bootstrap (allowed only with zero workspaces) sees an empty DB.
 */
async function reset() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const { client } = createDbFromEnv(databaseUrl);
  await client.unsafe("DROP SCHEMA public CASCADE");
  await client.unsafe("CREATE SCHEMA public");
  await client.end();
  console.log("Database reset: public schema dropped and recreated");
  console.log("Run db:migrate afterwards to restore the schema.");
}

await reset();
