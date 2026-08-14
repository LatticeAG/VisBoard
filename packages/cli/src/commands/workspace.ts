import type { Command } from "commander";
import { createClient } from "../client.js";
import { updateConfig } from "../config.js";
import { getGlobalOptions } from "../globals.js";
import { formatTable, outputData, outputText } from "../output.js";

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program.command("workspace").description("Workspace commands");

  workspace
    .command("list")
    .description("List workspaces")
    .action(async function (this: Command) {
      const globals = getGlobalOptions(this);
      const { client } = await createClient(globals);
      const workspaces = await client.workspaces.list();

      if (globals.json) {
        outputData(workspaces, globals);
        return;
      }

      outputText(
        formatTable(
          workspaces.map((ws) => ({
            slug: ws.slug,
            name: ws.name,
            id: ws.id,
          })),
          ["slug", "name", "id"],
        ),
        globals,
      );
    });

  workspace
    .command("create")
    .description("Create a workspace")
    .requiredOption("--name <name>", "workspace name")
    .option("--slug <slug>", "workspace slug")
    .action(async function (this: Command, opts: { name: string; slug?: string }) {
      const globals = getGlobalOptions(this);
      const { client } = await createClient(globals);
      const created = await client.workspaces.create({
        name: opts.name,
        slug: opts.slug,
      });
      outputData(created, globals);
    });

  workspace
    .command("switch")
    .description("Set default workspace")
    .argument("<slug>", "workspace slug")
    .action(async function (this: Command, slug: string) {
      const globals = getGlobalOptions(this);
      const { client } = await createClient(globals);
      await client.workspaces.get(slug);
      await updateConfig({ workspace: slug });
      outputText(`Switched to workspace: ${slug}`, globals);
    });
}
