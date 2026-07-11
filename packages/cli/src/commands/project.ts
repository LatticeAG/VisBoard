import type { Command } from "commander";
import { createClient, requireWorkspace } from "../client.js";
import { getGlobalOptions } from "../globals.js";
import { formatTable, outputData, outputText } from "../output.js";

export function registerProjectCommands(program: Command): void {
  const project = program.command("project").description("Project commands");

  project
    .command("list")
    .description("List projects in workspace")
    .action(async function (this: Command) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const projects = await client.projects.list(ws);

      if (globals.json) {
        outputData(projects, globals);
        return;
      }

      outputText(
        formatTable(
          projects.map((p) => ({
            slug: p.slug,
            name: p.name,
            status: p.status,
            id: p.id,
          })),
          ["slug", "name", "status", "id"],
        ),
        globals,
      );
    });

  project
    .command("create")
    .description("Create a project")
    .requiredOption("--name <name>", "project name")
    .requiredOption("--slug <slug>", "project slug")
    .option("--description <text>", "project description")
    .option("--status <status>", "project status", "active")
    .action(async function (
      this: Command,
      opts: { name: string; slug: string; description?: string; status?: string },
    ) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const created = await client.projects.create(ws, {
        name: opts.name,
        slug: opts.slug,
        description: opts.description,
        status: opts.status as "draft" | "active" | "archived",
      });
      outputData(created, globals);
    });

  project
    .command("show")
    .description("Show project details")
    .argument("<slug>", "project slug")
    .action(async function (this: Command, slug: string) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const detail = await client.projects.get(ws, slug);
      outputData(detail, globals);
    });

  project
    .command("archive")
    .description("Archive a project")
    .argument("<slug>", "project slug")
    .action(async function (this: Command, slug: string) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const archived = await client.projects.archive(ws, slug);
      outputData(archived, globals);
    });
}
