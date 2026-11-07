import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../../../scripts/smoke.sh", import.meta.url));

describe("smoke script endpoint", () => {
  it.each([
    [{ VISBOARD_ENDPOINT: "http://localhost:18080/v1" }, "http://localhost:18080/v1"],
    [{ API_BASE_URL: "http://localhost:18080" }, "http://localhost:18080/v1"],
    [{}, "http://localhost:8080/v1"],
  ])("passes the selected endpoint to the CLI", (overrides, expected) => {
    const dir = mkdtempSync(path.join(tmpdir(), "visboard-smoke-test-"));
    try {
      const capture = path.join(dir, "args");
      writeFileSync(
        path.join(dir, "node"),
        '#!/bin/sh\nprintf "%s\\n" "$@" > "$CAPTURE"\nexit 1\n',
        {
          mode: 0o755,
        },
      );
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        CAPTURE: capture,
      };
      env.VISBOARD_ENDPOINT = undefined;
      env.API_BASE_URL = undefined;
      expect(() => execFileSync("bash", [script], { env: { ...env, ...overrides } })).toThrow();
      expect(readFileSync(capture, "utf8").split("\n").slice(1, 3)).toEqual([
        "--endpoint",
        expected,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
