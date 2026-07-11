import type { Command } from "commander";
import { createClient, requireWorkspace } from "../client.js";
import { getGlobalOptions } from "../globals.js";
import { formatTable, outputData, outputText } from "../output.js";

export function registerAgentCommands(program: Command): void {
  const agent = program.command("agent").description("Agent commands");

  agent
    .command("list")
    .description("List agents in workspace")
    .option("--project <slug>", "filter by project slug")
    .action(async function (this: Command, opts: { project?: string }) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const agents = await client.agents.list(ws, { project: opts.project });

      if (globals.json) {
        outputData(agents, globals);
        return;
      }

      outputText(
        formatTable(
          agents.map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
            scopes: a.scopes.join(","),
          })),
          ["id", "name", "status", "scopes"],
        ),
        globals,
      );
    });

  agent
    .command("create")
    .description("Create an agent")
    .requiredOption("--name <name>", "agent name")
    .requiredOption("--scopes <scopes>", "comma-separated scopes")
    .option("--description <text>", "agent description")
    .option("--project <slug>", "limit agent to project")
    .action(async function (
      this: Command,
      opts: { name: string; scopes: string; description?: string; project?: string },
    ) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);

      const projectIds: string[] = [];
      if (opts.project) {
        const project = await client.projects.get(ws, opts.project);
        projectIds.push(project.id);
      }

      const created = await client.agents.create(ws, {
        name: opts.name,
        description: opts.description,
        scopes: opts.scopes.split(",").map((s) => s.trim()),
        project_ids: projectIds.length > 0 ? projectIds : undefined,
      });

      if (globals.json) {
        outputData(created, globals);
      } else {
        outputData(created, globals);
        if (created.token) {
          outputText(`Token (save now — shown once): ${created.token}`, globals);
        }
      }
    });

  agent
    .command("revoke")
    .description("Revoke an agent")
    .argument("<agent-id>", "agent id")
    .action(async function (this: Command, agentId: string) {
      const globals = getGlobalOptions(this);
      const { client, workspace } = await createClient(globals);
      const ws = requireWorkspace(workspace);
      const revoked = await client.agents.revoke(ws, agentId);
      outputData(revoked, globals);
    });
}
