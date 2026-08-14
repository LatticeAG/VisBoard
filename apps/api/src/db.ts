import { type Database, createDbFromEnv } from "@visboard/db";
import postgres from "postgres";
import { getEnv } from "./env.js";
import { dispatchProjectEventFromNotify } from "./services/event.js";

let dbInstance: Database | null = null;
let listenClientInstance: ReturnType<typeof postgres> | null = null;
let listenStarted = false;

export function isPersistableDb(db: unknown): boolean {
  return typeof db === "object" && db !== null && "_" in db;
}

export function getDb(): Database {
  if (!dbInstance) {
    const env = getEnv();
    process.env.DATABASE_URL = env.DATABASE_URL;
    dbInstance = createDbFromEnv(env.DATABASE_URL);
  }
  return dbInstance;
}

export function listenClient(): ReturnType<typeof postgres> {
  if (!listenClientInstance) {
    const env = getEnv();
    listenClientInstance = postgres(env.DATABASE_URL, { max: 1 });
  }
  return listenClientInstance;
}

export function getListenClient(): ReturnType<typeof postgres> {
  return listenClient();
}

export async function startEventListener(): Promise<void> {
  if (listenStarted) return;
  listenStarted = true;
  try {
    await listenClient().listen("visboard_events", (payload) => {
      dispatchProjectEventFromNotify(payload);
    });
  } catch (err) {
    console.error("LISTEN visboard_events failed", err);
  }
}

export function setDbForTests(db: Database): void {
  dbInstance = db;
}

export function resetDb(): void {
  dbInstance = null;
}
