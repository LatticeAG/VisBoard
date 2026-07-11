#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { VisBoardClient } from "@visboard/sdk";
import { loadConfig } from "./env.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const client = new VisBoardClient({
    baseUrl: config.baseUrl,
    token: config.token,
  });

  const server = new McpServer({
    name: "visboard",
    version: "0.1.0",
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
