import { createDbFromEnv, type Database } from "@visboard/db";
import { getEnv } from "./env.js";

let dbInstance: Database | null = null;

export function getDb(): Database {
  if (!dbInstance) {
    const env = getEnv();
    process.env.DATABASE_URL = env.DATABASE_URL;
    dbInstance = createDbFromEnv(env.DATABASE_URL);
  }
  return dbInstance;
}

export function setDbForTests(db: Database): void {
  dbInstance = db;
}

export function resetDb(): void {
  dbInstance = null;
}
