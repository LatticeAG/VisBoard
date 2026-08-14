import type { Command } from "commander";
import { createClient, requireWorkspace } from "../client.js";
import { loadConfig } from "../config.js";
import { getGlobalOptions } from "../globals.js";
import { outputData, outputText } from "../output.js";

export function registerContextCommands(program: Command): void {
  program
    .command("context")
    .description("Fetch project context for agents")
    .requiredOption("--project <slug>", "project slug")
    .option("--include <mode>", "headings or bodies", "headings")
    .option("--tokens", "include token usage hints")
    .action(async function (
      this: Command,
      opts: { project: string; include: string; tokens?: boolean },
    ) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);

      const ctx = await client.context.get(ws, opts.project, {
        include: opts.include as "headings" | "bodies",
      });

      if (opts.tokens) {
        const config = await loadConfig();
        const enriched = {
          ...ctx,
          _tokens: {
            endpoint: globals.endpoint ?? config.endpoint,
            workspace: ws,
            project: opts.project,
            has_token: Boolean(config.token),
          },
        };
        outputData(enriched, globals);
        return;
      }

      outputData(ctx, globals);
    });

  program
    .command("agents-md")
    .description("Fetch or sync AGENTS.md")
    .requiredOption("--project <slug>", "project slug")
    .option("--sync", "trigger AGENTS.md sync")
    .action(async function (this: Command, opts: { project: string; sync?: boolean }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);

      if (opts.sync) {
        const markdown = await client.agentsMd.sync(ws, opts.project);
        if (globals.json) {
          outputData({ markdown }, globals);
        } else {
          outputText("AGENTS.md synced.", globals);
          outputText(markdown, globals);
        }
        return;
      }

      const markdown = await client.agentsMd.get(ws, opts.project);
      outputText(markdown, globals);
    });
}
