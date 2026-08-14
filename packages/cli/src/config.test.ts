import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ENDPOINT, writeConfigFile } from "./config.js";

describe("config", () => {
  it("has default endpoint", () => {
    expect(DEFAULT_ENDPOINT).toBe("http://localhost:8080/v1");
  });

  it("writes config files with mode 0600", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "visboard-config-"));
    const filePath = path.join(dir, "config.json");
    await writeConfigFile(filePath, `${JSON.stringify({ endpoint: DEFAULT_ENDPOINT }, null, 2)}\n`);
    const info = await stat(filePath);
    expect(info.mode & 0o777).toBe(0o600);
  });
});
