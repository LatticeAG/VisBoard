import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type VisBoardClient, VisBoardError } from "@visboard/sdk";
import { z } from "zod";
import { errorResult, jsonResult, textResult } from "./format.js";

const workspaceSchema = z.string().min(1).describe("Workspace slug");
const projectSchema = z.string().min(1).describe("Project slug");

async function runTool<T>(fn: () => Promise<T>) {
  try {
    return jsonResult(await fn());
  } catch (error) {
    return errorResult(error);
  }
}

export function registerTools(server: McpServer, client: VisBoardClient): void {
  server.registerTool(
    "list_workspaces",
    {
      description: "List all VisBoard workspaces accessible to the current token",
      inputSchema: {},
    },
    async () => runTool(() => client.workspaces.list()),
  );

  server.registerTool(
    "list_projects",
    {
      description: "List projects in a workspace",
      inputSchema: {
        workspace: workspaceSchema,
      },
    },
    async ({ workspace }) => runTool(() => client.projects.list(workspace)),
  );

  server.registerTool(
    "get_context",
    {
      description:
        "Fetch project context optimized for agents (notes, checklists, files, participants, AGENTS.md)",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
        include: z
          .enum(["headings", "bodies"])
          .optional()
          .describe("Include note headings only (default) or full bodies"),
      },
    },
    async ({ workspace, project, include }) =>
      runTool(() => client.context.get(workspace, project, include ? { include } : {})),
  );

  server.registerTool(
    "get_agents_md",
    {
      description: "Fetch the generated AGENTS.md markdown for a project",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
      },
    },
    async ({ workspace, project }) => {
      try {
        const markdown = await client.agentsMd.get(workspace, project);
        return textResult(markdown);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_notes",
    {
      description: "List notes in a project",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
      },
    },
    async ({ workspace, project }) => runTool(() => client.notes.list(workspace, project)),
  );

  server.registerTool(
    "get_note",
    {
      description: "Get a note by slug or id",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
        slug: z.string().min(1).describe("Note slug or id"),
      },
    },
    async ({ workspace, project, slug }) =>
      runTool(() => client.notes.get(workspace, project, slug)),
  );

  server.registerTool(
    "upsert_note",
    {
      description: "Create or update a note by slug",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
        slug: z.string().min(1).describe("Note slug"),
        title: z.string().min(1).describe("Note title (required for create)"),
        body: z.string().optional().describe("Markdown body"),
        frontmatter: z.record(z.unknown()).optional().describe("YAML frontmatter as JSON object"),
      },
    },
    async ({ workspace, project, slug, title, body, frontmatter }) =>
      runTool(async () => {
        try {
          const existing = await client.notes.get(workspace, project, slug);
          return client.notes.update(
            workspace,
            project,
            existing.id,
            {
              title,
              body,
              frontmatter,
            },
            `W/"${existing.version}"`,
          );
        } catch (error) {
          if (error instanceof VisBoardError && error.status === 404) {
            return client.notes.create(workspace, project, {
              title,
              slug,
              body,
              frontmatter,
            });
          }
          throw error;
        }
      }),
  );

  server.registerTool(
    "list_checklists",
    {
      description: "List checklists and items in a project",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
      },
    },
    async ({ workspace, project }) => runTool(() => client.checklists.list(workspace, project)),
  );

  server.registerTool(
    "set_checklist_item",
    {
      description: "Toggle or set the done state of a checklist item",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
        checklist_id: z.string().min(1).describe("Checklist id"),
        item_id: z.string().min(1).describe("Checklist item id"),
        done: z.boolean().optional().describe("Set done state; omit to toggle current value"),
      },
    },
    async ({ workspace, project, checklist_id, item_id, done }) =>
      runTool(async () => {
        let nextDone = done;

        if (nextDone === undefined) {
          const checklist = await client.checklists.get(workspace, project, checklist_id);
          const item = checklist.items.find((entry) => entry.id === item_id);
          if (!item) {
            throw new Error(`Checklist item '${item_id}' not found`);
          }
          nextDone = !item.done;
        }

        return client.checklists.updateItem(workspace, project, checklist_id, item_id, {
          done: nextDone,
        });
      }),
  );

  server.registerTool(
    "append_event",
    {
      description: "Append an event to the project activity stream",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
        type: z.string().min(1).describe("Event type (e.g. agent.turn.completed)"),
        resource_type: z.string().optional().describe("Related resource type"),
        resource_id: z.string().optional().describe("Related resource id"),
        payload: z.record(z.unknown()).optional().describe("Additional event payload"),
      },
    },
    async ({ workspace, project, type, resource_type, resource_id, payload }) =>
      runTool(() =>
        client.events.append(workspace, project, {
          type: type as Parameters<VisBoardClient["events"]["append"]>[2]["type"],
          resource_type,
          resource_id,
          payload,
        }),
      ),
  );

  server.registerTool(
    "upload_file",
    {
      description: "Upload a file to a project (content as base64)",
      inputSchema: {
        workspace: workspaceSchema,
        project: projectSchema,
        filename: z.string().min(1).describe("Original filename"),
        content: z.string().min(1).describe("Base64-encoded file content"),
        mime_type: z
          .string()
          .optional()
          .describe("MIME type (defaults to application/octet-stream)"),
      },
    },
    async ({ workspace, project, filename, content, mime_type }) =>
      runTool(async () => {
        const bytes = Buffer.from(content, "base64");
        const blob = new Blob([bytes], {
          type: mime_type ?? "application/octet-stream",
        });
        return client.files.upload(workspace, project, {
          file: blob,
          filename,
        });
      }),
  );

  server.registerTool(
    "list_agents",
    {
      description: "List agents in a workspace, optionally filtered by project",
      inputSchema: {
        workspace: workspaceSchema,
        project: z.string().optional().describe("Filter agents scoped to this project slug"),
      },
    },
    async ({ workspace, project }) =>
      runTool(async () => {
        let agents = await client.agents.list(workspace);

        if (project) {
          const projectRecord = await client.projects.get(workspace, project);
          agents = agents.filter(
            (agent) =>
              agent.project_ids.length === 0 || agent.project_ids.includes(projectRecord.id),
          );
        }

        return agents;
      }),
  );

  server.registerTool(
    "create_agent",
    {
      description: "Create a new agent and return its API key (shown once)",
      inputSchema: {
        workspace: workspaceSchema,
        name: z.string().min(1).describe("Agent display name"),
        scopes: z
          .array(z.string())
          .min(1)
          .describe("Permission scopes (e.g. read, write:checklists)"),
        description: z.string().optional().describe("Agent description"),
        project: z.string().optional().describe("Limit agent to this project slug"),
      },
    },
    async ({ workspace, name, scopes, description, project }) =>
      runTool(async () => {
        const projectIds: string[] = [];

        if (project) {
          const projectRecord = await client.projects.get(workspace, project);
          projectIds.push(projectRecord.id);
        }

        return client.agents.create(workspace, {
          name,
          description,
          scopes,
          project_ids: projectIds.length > 0 ? projectIds : undefined,
        });
      }),
  );
}
