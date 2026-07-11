import {
  personalAccessTokens,
  users,
  workspaceMembers,
  workspaces,
} from "@visboard/db";
import { PREFIX, createId, slugify } from "@visboard/shared";
import { count, eq } from "drizzle-orm";
import type { Database } from "@visboard/db";
import { getEnv } from "../env.js";
import { conflict, forbidden } from "../lib/errors.js";
import {
  generatePatToken,
  hashToken,
  tokenPrefix,
} from "../auth/tokens.js";

export interface BootstrapInput {
  name: string;
  slug?: string;
  bootstrapToken?: string;
}

export async function bootstrap(
  db: Database["db"],
  input: BootstrapInput,
) {
  const env = getEnv();
  const [countRow] = await db
    .select({ value: count() })
    .from(workspaces);
  const workspaceCount = countRow?.value ?? 0;

  const allowedByEmpty = workspaceCount === 0;
  const allowedByToken =
    env.VISBOARD_BOOTSTRAP_TOKEN &&
    input.bootstrapToken === env.VISBOARD_BOOTSTRAP_TOKEN;

  if (!allowedByEmpty && !allowedByToken) {
    throw forbidden("Bootstrap is only allowed when no workspaces exist");
  }

  const slug = input.slug ?? slugify(input.name);
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) {
    throw conflict("Slug must be 3-48 lowercase alphanumeric characters");
  }

  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (existing.length > 0) {
    throw conflict(`Workspace slug '${slug}' already exists`);
  }

  const workspaceId = createId(PREFIX.workspace);
  const userId = createId(PREFIX.user);
  const patId = createId(PREFIX.pat);
  const rawToken = generatePatToken();
  const now = new Date();

  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      slug,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const [user] = await db
    .insert(users)
    .values({
      id: userId,
      displayName: "Admin",
      createdAt: now,
    })
    .returning();

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: "owner",
    createdAt: now,
  });

  await db.insert(personalAccessTokens).values({
    id: patId,
    userId,
    name: "Bootstrap Admin",
    tokenHash: hashToken(rawToken, env.VISBOARD_TOKEN_PEPPER),
    tokenPrefix: tokenPrefix(rawToken),
    scopes: ["admin"],
    createdAt: now,
  });

  return {
    workspace: formatWorkspace(workspace!),
    user: formatUser(user!),
    token: rawToken,
  };
}

export async function listWorkspaces(
  db: Database["db"],
  workspaceIds: string[],
) {
  if (workspaceIds.length === 0) return [];
  const rows = await db.select().from(workspaces);
  return rows
    .filter((w) => workspaceIds.includes(w.id) && !w.deletedAt)
    .map(formatWorkspace);
}

export async function createWorkspace(
  db: Database["db"],
  userId: string,
  input: { name: string; slug?: string },
) {
  const slug = input.slug ?? slugify(input.name);
  if (!/^[a-z0-9-]{3,48}$/.test(slug)) {
    throw conflict("Slug must be 3-48 lowercase alphanumeric characters");
  }

  const workspaceId = createId(PREFIX.workspace);
  const now = new Date();

  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: workspaceId,
      slug,
      name: input.name,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await db.insert(workspaceMembers).values({
    workspaceId,
    userId,
    role: "owner",
    createdAt: now,
  });

  return formatWorkspace(workspace!);
}

export async function getWorkspaceBySlug(db: Database["db"], slug: string) {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);
  if (!row || row.deletedAt) return null;
  return row;
}

export async function updateWorkspace(
  db: Database["db"],
  workspaceId: string,
  input: { name?: string },
) {
  const now = new Date();
  const [row] = await db
    .update(workspaces)
    .set({ ...input, updatedAt: now })
    .where(eq(workspaces.id, workspaceId))
    .returning();
  return formatWorkspace(row!);
}

function formatWorkspace(w: typeof workspaces.$inferSelect) {
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    created_at: w.createdAt.toISOString(),
    updated_at: w.updatedAt.toISOString(),
  };
}

function formatUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.displayName,
    created_at: u.createdAt.toISOString(),
  };
}

export { formatUser, formatWorkspace };
