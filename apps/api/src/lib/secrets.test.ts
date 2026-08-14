import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { parseEnv, resetEnvForTests } from "../env.ts";
import { decryptSecret, encryptSecret, resolveSecretsKey } from "./secrets.ts";

describe("connection secrets", () => {
  afterEach(() => {
    resetEnvForTests();
  });

  it("round-trips aes-256-gcm with a 32-byte key", () => {
    const key = createHash("sha256").update("fixture-key").digest();
    const encrypted = encryptSecret("plain-token", key);
    expect(encrypted.ciphertext).not.toBe("plain-token");
    expect(Buffer.from(encrypted.iv, "base64")).toHaveLength(12);
    expect(decryptSecret(encrypted, key)).toBe("plain-token");
  });

  it("uses VISBOARD_SECRETS_KEY when set", () => {
    const hex = "ab".repeat(32);
    const env = parseEnv({
      DATABASE_URL: "postgresql://visboard:visboard@localhost:5432/visboard",
      VISBOARD_TOKEN_PEPPER: "a-unique-operator-pepper-value-32xx",
      VISBOARD_SECRETS_KEY: hex,
      NODE_ENV: "test",
    });
    expect(resolveSecretsKey(env).equals(Buffer.from(hex, "hex"))).toBe(true);
  });
});
