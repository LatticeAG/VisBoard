import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@visboard/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
      "@visboard/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
      "@visboard/agents-md": path.resolve(__dirname, "../../packages/agents-md/src/index.ts"),
      "@visboard/agent-sdk": path.resolve(__dirname, "../../packages/agent-sdk/src/index.ts"),
    },
    extensions: [".ts", ".tsx", ".js", ".mjs", ".json"],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
  },
  esbuild: {
    target: "node22",
  },
});
