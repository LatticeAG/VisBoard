import { createDbFromEnv } from "./client.js";

/**
 * Drop and recreate the public schema.
 * Used by CI between the test suite and the V1 smoke so the smoke's
 * one-time bootstrap (allowed only with zero workspaces) sees an empty DB.
 */
async function reset() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required. Set it to the database to reset, for example:\n  export DATABASE_URL=postgresql://visboard:visboard@localhost:5433/visboard");
    process.exit(1);
  }

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
