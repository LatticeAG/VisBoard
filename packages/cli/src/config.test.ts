import { describe, expect, it } from "vitest";
import { DEFAULT_ENDPOINT } from "./config.js";

describe("config", () => {
  it("has default endpoint", () => {
    expect(DEFAULT_ENDPOINT).toBe("http://localhost:8080/v1");
  });
});
