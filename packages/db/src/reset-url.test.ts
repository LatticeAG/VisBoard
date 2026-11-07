import { describe, expect, it } from "vitest";
import { resolveResetDatabaseUrl } from "./reset-url.js";

describe("reset database URL", () => {
  it("prefers the environment, then the project env file, then the Compose default", () => {
    expect(resolveResetDatabaseUrl("postgres://environment/db", "postgres://file/db")).toBe(
      "postgres://environment/db",
    );
    expect(resolveResetDatabaseUrl(undefined, "postgres://file/db")).toBe("postgres://file/db");
    expect(resolveResetDatabaseUrl(undefined, undefined)).toBe(
      "postgresql://visboard:visboard@localhost:5433/visboard",
    );
  });
});
