import type { Database } from "@visboard/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import { resetDb, setDbForTests } from "../db.ts";
import { resetEnvForTests } from "../env.ts";
import { createEmptyStore, createInMemoryDb } from "../test/mock-db.ts";

describe("health routes", () => {
  beforeEach(() => {
    resetEnvForTests();
  });

  afterEach(() => {
    resetDb();
  });

  it("GET /health is liveness and does not need the database", async () => {
    const app = createApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe("0.1.0");
  });

  it("GET /readyz is 200 when select 1 succeeds", async () => {
    const memory = createInMemoryDb(createEmptyStore());
    setDbForTests({
      ...memory,
      db: Object.assign(memory.db, {
        execute: async () => [{ ok: 1 }],
      }),
    });
    const app = createApp();
    const res = await app.request("/readyz");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", version: "0.1.0", db: "ok" });
  });

  it("GET /readyz is 503 problem+json when select 1 throws", async () => {
    setDbForTests({
      db: {
        execute: async () => {
          throw new Error("connection refused");
        },
      } as unknown as Database["db"],
      client: { end: async () => undefined } as Database["client"],
    });
    const app = createApp();
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = await res.json();
    expect(body.title).toBe("Service Unavailable");
    expect(body.detail).toBe("Database is not ready");
  });
});
