import { agents, events, projects } from "@visboard/db";
import { EventType, PREFIX, createId, slugify } from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "@visboard/db";
import type { AuthPrincipal } from "../auth/middleware.js";
import { actorFromAuth, assertAgentProjectAccess } from "../lib/helpers.js";
import { conflict, notFound } from "../lib/errors.js";
import { getWorkspaceBySlug } from "./workspace.js";
import { scheduleAgentsMdSync } from "./agents-md-sync.js";

export async function listProjects(
  db: Database["db"],
  workspaceSlug: string,
  auth: AuthPrincipal,
) {
  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) throw notFound(`Workspace '${workspaceSlug}' not found`);

  const rows = await db
    .select()
    .from(projects)
    .where(
      and(eq(projects.workspaceId, ws.id), isNull(projects.deletedAt)),
    );

  if (auth.type === "agent" && auth.scopes) {
    const agentProjects = await getAgentProjectFilter(db, auth.id);
    if (agentProjects.length > 0) {
      return rows
        .filter((p) => agentProjects.includes(p.id))
        .map(formatProject);
    }
  }

  return rows.map(formatProject);
}

export async function createProject(
  db: Database["db"],
  workspaceSlug: string,
  auth: AuthPrincipal,
  input: {
    name: string;
    slug?: string;
    description?: string;
    status?: string;
  },
) {
  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) throw notFound(`Workspace '${workspaceSlug}' not found`);

  const slug = input.slug ?? slugify(input.name);
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) {
    throw conflict("Slug must be 3-48 lowercase alphanumeric characters");
  }

  const existing = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, ws.id), eq(projects.slug, slug)))
    .limit(1);
  if (existing.length > 0) {
    throw conflict(`Project slug '${slug}' already exists`);
  }

  const projectId = createId(PREFIX.project);
  const now = new Date();
  const actor = actorFromAuth(auth);

  const [project] = await db
    .insert(projects)
    .values({
      id: projectId,
      workspaceId: ws.id,
      slug,
      name: input.name,
      description: input.description ?? "",
      status: input.status ?? "draft",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(events).values({
    id: createId(PREFIX.event),
    projectId,
    type: EventType.PROJECT_CREATED,
    actorType: actor.actorType,
    actorId: actor.actorId,
    resourceType: "project",
    resourceId: projectId,
    payload: {},
    createdAt: now,
  });

  scheduleAgentsMdSync(projectId);

  return formatProject(project!);
}

export async function getProjectBySlug(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth?: AuthPrincipal,
) {
  const ws = await getWorkspaceBySlug(db, workspaceSlug);
  if (!ws) throw notFound(`Workspace '${workspaceSlug}' not found`);

  const [project] = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, ws.id),
        eq(projects.slug, projectSlug),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);

  if (!project) {
    throw notFound(
      `Project '${projectSlug}' not found in workspace '${workspaceSlug}'`,
    );
  }

  if (auth) {
    assertAgentProjectAccess(auth, project.id);
  }

  return { workspace: ws, project };
}

export async function updateProject(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth: AuthPrincipal,
  input: Partial<{
    name: string;
    description: string;
    status: string;
  }>,
) {
  const { project } = await getProjectBySlug(db, workspaceSlug, projectSlug, auth);
  const now = new Date();
  const actor = actorFromAuth(auth);

  const [updated] = await db
    .update(projects)
    .set({ ...input, updatedAt: now })
    .where(eq(projects.id, project.id))
    .returning();

  await db.insert(events).values({
    id: createId(PREFIX.event),
    projectId: project.id,
    type: EventType.PROJECT_UPDATED,
    actorType: actor.actorType,
    actorId: actor.actorId,
    resourceType: "project",
    resourceId: project.id,
    payload: input,
    createdAt: now,
  });

  scheduleAgentsMdSync(project.id);

  return formatProject(updated!);
}

export async function archiveProject(
  db: Database["db"],
  workspaceSlug: string,
  projectSlug: string,
  auth: AuthPrincipal,
) {
  return updateProject(db, workspaceSlug, projectSlug, auth, {
    status: "archived",
  });
}

async function getAgentProjectFilter(db: Database["db"], agentId: string) {
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  return agent?.projectIds ?? [];
}

export function formatProject(p: typeof projects.$inferSelect) {
  return {
    id: p.id,
    workspace_id: p.workspaceId,
    slug: p.slug,
    name: p.name,
    description: p.description,
    status: p.status,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
  };
}
