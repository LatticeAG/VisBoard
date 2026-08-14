import { afterEach, describe, expect, it } from "vitest";
import { DISALLOWED_PEPPERS, EnvError, parseEnv, resetEnvForTests } from "./env.ts";

const validBase = {
  DATABASE_URL: "postgresql://visboard:visboard@localhost:5432/visboard",
  VISBOARD_TOKEN_PEPPER: "a-unique-operator-pepper-value-32xx",
  NODE_ENV: "test",
};

describe("parseEnv", () => {
  afterEach(() => {
    resetEnvForTests();
  });

  it("resetEnvForTests still returns a parsed env", () => {
    const env = resetEnvForTests();
    expect(env.VISBOARD_TOKEN_PEPPER.length).toBeGreaterThanOrEqual(32);
    expect(env.VISBOARD_AUTO_MIGRATE).toBe(false);
    expect(env.NODE_ENV).toBe("test");
  });

  it("coerces VISBOARD_AUTO_MIGRATE from 1/0 strings", () => {
    expect(parseEnv({ ...validBase, VISBOARD_AUTO_MIGRATE: "1" }).VISBOARD_AUTO_MIGRATE).toBe(true);
    expect(parseEnv({ ...validBase, VISBOARD_AUTO_MIGRATE: "0" }).VISBOARD_AUTO_MIGRATE).toBe(
      false,
    );
  });

  it("refuses documented example peppers in production", () => {
    for (const pepper of DISALLOWED_PEPPERS) {
      if (pepper.length < 32) continue;
      expect(() =>
        parseEnv({
          ...validBase,
          NODE_ENV: "production",
          VISBOARD_TOKEN_PEPPER: pepper,
        }),
      ).toThrow(EnvError);
    }
  });

  it("refuses production visboard/visboard credentials unless allowed", () => {
    expect(() =>
      parseEnv({
        ...validBase,
        NODE_ENV: "production",
      }),
    ).toThrow(/visboard\/visboard/);

    const env = parseEnv({
      ...validBase,
      NODE_ENV: "production",
      VISBOARD_ALLOW_INSECURE_DEFAULTS: "1",
    });
    expect(env.VISBOARD_ALLOW_INSECURE_DEFAULTS).toBe(true);
  });

  it("allows a custom pepper and database url in production", () => {
    const env = parseEnv({
      DATABASE_URL: "postgresql://op:secret-pass@db:5432/visboard",
      VISBOARD_TOKEN_PEPPER: "a-unique-operator-pepper-value-32xx",
      NODE_ENV: "production",
    });
    expect(env.NODE_ENV).toBe("production");
  });
});
