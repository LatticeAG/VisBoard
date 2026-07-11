import { agents, projects } from "@visboard/db";
import { EventType, PREFIX, createId } from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@visboard/db";
import type { AuthPrincipal } from "../auth/middleware.js";
import { forbidden, notFound } from "../lib/errors.js";
import { getEnv } from "../env.js";
import {
  generateAgentToken,
  hashToken,
  tokenPrefix,
} from "../auth/tokens.js";
import { getWorkspaceBySlug } from "./workspace.js";
import { scheduleAgentsMdSync } from "./agents-md-sync.js";
import { createEvent } from "./event.js";

export async function listAgents(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug?: string,
) {
  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) throw notFound(`Workspace '${workspaceSlug}' not found`);

  const rows = await db
    .select()
    .from(agents)
    .where(and(eq(agents.workspaceId, ws.id), isNull(agents.revokedAt)));

  let filtered = rows;
  if (projectSlug) {
    const { getProjectBySlug } = await import("./project.js");
    const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug);
    filtered = rows.filter(
      (a) =>
        a.projectIds.length === 0 || a.projectIds.includes(project.id),
    );
  }

  return filtered.map(formatAgent);
}

export async function createAgent(
  db: Database["db"],
  workspaceSlug: string,
  auth: AuthPrincipal,
  input: {
    name: string;
    description?: string;
    scopes: string[];
    project_ids?: string[];
  },
) {
  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) throw notFound(`Workspace '${workspaceSlug}' not found`);

  const env = getEnv();
  const agentId = createId(PREFIX.agent);
  const rawToken = generateAgentToken();
  const now = new Date();

  const [agent] = await db
    .insert(agents)
    .values({
      id: agentId,
      workspaceId: ws.id,
      name: input.name,
      description: input.description ?? "",
      scopes: input.scopes,
      projectIds: input.project_ids ?? [],
      tokenHash: hashToken(rawToken, env.VISBOARD_TOKEN_PEPPER),
      tokenPrefix: tokenPrefix(rawToken),
      status: "active",
      createdById: auth.type === "user" ? auth.id : "system",
      createdAt: now,
    })
    .returning();

  await createEventForAgentProjects(db, agent!, auth, EventType.AGENT_CREATED);

  for (const projectId of agent!.projectIds) {
    scheduleAgentsMdSync(projectId);
  }
  if (agent!.projectIds.length === 0) {
    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, ws.id));
    for (const p of projectRows) {
      scheduleAgentsMdSync(p.id);
    }
  }

  return { ...formatAgent(agent!), token: rawToken };
}

export async function updateAgent(
  db: Database["db"],
  workspaceSlug: string,
  agentId: string,
  input: Partial<{
    name: string;
    description: string;
    scopes: string[];
    project_ids: string[];
  }>,
) {
  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) throw notFound(`Workspace '${workspaceSlug}' not found`);

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, ws.id)))
    .limit(1);

  if (!agent || agent.revokedAt) {
    throw notFound(`Agent '${agentId}' not found`);
  }

  const [updated] = await db
    .update(agents)
    .set({
      name: input.name ?? agent.name,
      description: input.description ?? agent.description,
      scopes: input.scopes ?? agent.scopes,
      projectIds: input.project_ids ?? agent.projectIds,
    })
    .where(eq(agents.id, agentId))
    .returning();

  return formatAgent(updated!);
}

export async function revokeAgent(
  db: Database["db"],
  workspaceSlug: string,
  agentId: string,
  auth: AuthPrincipal,
) {
  if (auth.type === "agent" && auth.id === agentId) {
    throw forbidden("Agents cannot revoke themselves");
  }

  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) throw notFound(`Workspace '${workspaceSlug}' not found`);

  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.workspaceId, ws.id)))
    .limit(1);

  if (!agent || agent.revokedAt) {
    throw notFound(`Agent '${agentId}' not found`);
  }

  const now = new Date();
  const [updated] = await db
    .update(agents)
    .set({ status: "revoked", revokedAt: now })
    .where(eq(agents.id, agentId))
    .returning();

  await createEventForAgentProjects(db, updated!, auth, EventType.AGENT_REVOKED);

  for (const projectId of updated!.projectIds) {
    scheduleAgentsMdSync(projectId);
  }

  return formatAgent(updated!);
}

async function createEventForAgentProjects(
  db: Database["db"],
  agent: typeof agents.$inferSelect,
  auth: AuthPrincipal,
  type: string,
) {
  if (agent.projectIds.length > 0) {
    for (const projectId of agent.projectIds) {
      await createEvent(db, projectId, auth, {
        type,
        resource_type: "agent",
        resource_id: agent.id,
      });
    }
  } else {
    const projectRows = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, agent.workspaceId))
      .limit(1);
    if (projectRows[0]) {
      await createEvent(db, projectRows[0].id, auth, {
        type,
        resource_type: "agent",
        resource_id: agent.id,
      });
    }
  }
}

function formatAgent(a: typeof agents.$inferSelect) {
  return {
    id: a.id,
    workspace_id: a.workspaceId,
    name: a.name,
    description: a.description,
    capabilities: a.capabilities,
    scopes: a.scopes,
    project_ids: a.projectIds,
    token_prefix: a.tokenPrefix,
    status: a.status,
    last_seen_at: a.lastSeenAt?.toISOString() ?? null,
    created_by_id: a.createdById,
    created_at: a.createdAt.toISOString(),
    revoked_at: a.revokedAt?.toISOString() ?? null,
  };
}
