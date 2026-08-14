import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export function resolveMigrationsFolder(): string {
  const fromEnv = process.env.VISBOARD_MIGRATIONS_DIR;
  if (fromEnv && existsSync(join(fromEnv, "meta/_journal.json"))) {
    return fromEnv;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "../src/migrations"),
    join(here, "../../src/migrations"),
    join(process.cwd(), "packages/db/src/migrations"),
    join(process.cwd(), "../packages/db/src/migrations"),
    join(process.cwd(), "../../packages/db/src/migrations"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "meta/_journal.json"))) {
      return candidate;
    }
  }

  throw new Error(
    "Could not find Drizzle migrations folder. Set VISBOARD_MIGRATIONS_DIR to packages/db/src/migrations.",
  );
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder();
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder });
    console.log(
      "Existing PATs and agent keys were revoked. Run visboard auth bootstrap or create new keys.",
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}
