import { createHash } from "node:crypto";
import {
  boardTemplates,
  boards,
  templateBlockMappings,
  templateInstallations,
  templateVersions,
  type Database,
} from "@visboard/db";
import {
  BUILT_IN_TEMPLATES,
  PREFIX,
  createId,
  slugify,
  templateManifestSchema,
  type CreateTemplateInput,
  type CreateTemplateVersionInput,
  type InstallTemplateInput,
} from "@visboard/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthPrincipal } from "../auth/middleware.js";
import { actorFromAuth } from "../lib/helpers.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import {
  captureBoardRevision,
  createBoardBlock,
  formatBoardBlock,
} from "./board.js";

type TemplateRecord = typeof boardTemplates.$inferSelect;
type TemplateVersionRecord = typeof templateVersions.$inferSelect;
type InstallationRecord = typeof templateInstallations.$inferSelect;

function checksum(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function formatTemplate(template: TemplateRecord) {
  return {
    id: template.id,
    workspace_id: template.workspaceId,
    slug: template.slug,
    name: template.name,
    description: template.description,
    scope: template.scope,
    created_by_id: template.createdById,
    created_at: template.createdAt.toISOString(),
    updated_at: template.updatedAt.toISOString(),
  };
}

function formatTemplateVersion(version: TemplateVersionRecord) {
  return {
    id: version.id,
    template_id: version.templateId,
    version: version.version,
    state: version.state,
    manifest: templateManifestSchema.parse(version.manifest),
    checksum: version.checksum,
    created_by_id: version.createdById,
    created_at: version.createdAt.toISOString(),
  };
}

function formatInstallation(installation: InstallationRecord) {
  return {
    id: installation.id,
    board_id: installation.boardId,
    template_version_id: installation.templateVersionId,
    variables: asRecord(installation.variables),
    state: installation.state,
    installed_by_id: installation.installedById,
    installed_at: installation.installedAt.toISOString(),
  };
}

/**
 * System templates are shipped with the product, but their versions still
 * need durable IDs so an installation can record exactly what was applied to
 * a board. Provision them once on first discovery instead of making every
 * deployment run a separate seed step.
 */
async function ensureBuiltInTemplates(db: Database["db"]) {
  const existing = await db.select().from(boardTemplates);
  const systemSlugs = new Set(
    existing
      .filter(
        (template) =>
          template.scope === "system" &&
          template.workspaceId === null,
      )
      .map((template) => template.slug),
  );

  for (const builtIn of BUILT_IN_TEMPLATES) {
    if (systemSlugs.has(builtIn.slug)) continue;

    const now = new Date();
    const templateId = createId(PREFIX.template);
    await db.insert(boardTemplates).values({
      id: templateId,
      workspaceId: null,
      slug: builtIn.slug,
      name: builtIn.name,
      description: builtIn.description,
      scope: "system",
      createdById: "system",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(templateVersions).values({
      id: createId(PREFIX.templateVersion),
      templateId,
      version: "1.0.0",
      state: "published",
      manifest: builtIn.manifest as unknown as Record<string, unknown>,
      checksum: checksum(builtIn.manifest),
      createdById: "system",
      createdAt: now,
    });
  }
}

async function getTemplateRecord(db: Database["db"], templateId: string) {
  const rows = await db
    .select()
    .from(boardTemplates)
    .where(eq(boardTemplates.id, templateId));
  const template = rows.find((row) => row.id === templateId);
  if (!template) throw notFound(`Template '${templateId}' not found`);
  return template;
}

async function getTemplateVersionRecord(
  db: Database["db"],
  templateVersionId: string,
) {
  const rows = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.id, templateVersionId));
  const version = rows.find((row) => row.id === templateVersionId);
  if (!version) throw notFound(`Template version '${templateVersionId}' not found`);
  const template = await getTemplateRecord(db, version.templateId);
  return { template, version };
}

export async function listTemplates(
  db: Database["db"],
  workspaceIds: readonly string[],
) {
  await ensureBuiltInTemplates(db);
  const rows = await db.select().from(boardTemplates);
  return rows
    .filter(
      (template) =>
        template.scope === "system" ||
        template.workspaceId === null ||
        workspaceIds.includes(template.workspaceId),
    )
    .map(formatTemplate);
}

export async function getTemplate(
  db: Database["db"],
  templateId: string,
) {
  const template = await getTemplateRecord(db, templateId);
  const versions = await db
    .select()
    .from(templateVersions)
    .where(eq(templateVersions.templateId, template.id));
  return {
    ...formatTemplate(template),
    versions: versions
      .filter((version) => version.templateId === template.id)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(formatTemplateVersion),
  };
}

export async function createTemplate(
  db: Database["db"],
  auth: AuthPrincipal,
  input: CreateTemplateInput,
) {
  const workspaceId = input.workspace_id ?? auth.workspaceIds[0] ?? null;
  if (workspaceId && !auth.workspaceIds.includes(workspaceId)) {
    throw conflict("You cannot create a template outside an accessible workspace");
  }
  const slug = input.slug ?? slugify(input.name);
  const existing = await db
    .select()
    .from(boardTemplates)
    .where(
      workspaceId === null
        ? and(isNull(boardTemplates.workspaceId), eq(boardTemplates.slug, slug))
        : and(
            eq(boardTemplates.workspaceId, workspaceId),
            eq(boardTemplates.slug, slug),
          ),
    );
  if (existing.some((template) => template.workspaceId === workspaceId && template.slug === slug)) {
    throw conflict(`Template slug '${slug}' already exists`);
  }

  const now = new Date();
  const templateId = createId(PREFIX.template);
  const manifest = templateManifestSchema.parse(input.manifest);
  const [template] = await db
    .insert(boardTemplates)
    .values({
      id: templateId,
      workspaceId,
      slug,
      name: input.name,
      description: input.description ?? "",
      scope: input.scope ?? "private",
      createdById: auth.id,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [version] = await db
    .insert(templateVersions)
    .values({
      id: createId(PREFIX.templateVersion),
      templateId,
      version: input.version,
      state: input.published ? "published" : "draft",
      manifest: manifest as unknown as Record<string, unknown>,
      checksum: checksum(manifest),
      createdById: auth.id,
      createdAt: now,
    })
    .returning();
  return {
    ...formatTemplate(template!),
    version: formatTemplateVersion(version!),
  };
}

export async function createTemplateVersion(
  db: Database["db"],
  auth: AuthPrincipal,
  templateId: string,
  input: CreateTemplateVersionInput,
) {
  const template = await getTemplateRecord(db, templateId);
  if (template.workspaceId && !auth.workspaceIds.includes(template.workspaceId)) {
    throw conflict("You cannot publish a version for this template");
  }
  const existing = await db
    .select()
    .from(templateVersions)
    .where(
      and(
        eq(templateVersions.templateId, template.id),
        eq(templateVersions.version, input.version),
      ),
    );
  if (
    existing.some(
      (version) =>
        version.templateId === template.id && version.version === input.version,
    )
  ) {
    throw conflict(`Template version '${input.version}' already exists`);
  }

  const manifest = templateManifestSchema.parse(input.manifest);
  const [version] = await db
    .insert(templateVersions)
    .values({
      id: createId(PREFIX.templateVersion),
      templateId: template.id,
      version: input.version,
      state: input.published ? "published" : "draft",
      manifest: manifest as unknown as Record<string, unknown>,
      checksum: checksum(manifest),
      createdById: auth.id,
      createdAt: new Date(),
    })
    .returning();
  return formatTemplateVersion(version!);
}

function substituteTemplateVariables(
  value: unknown,
  variables: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    return value.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_, key: string) => {
      const replacement = variables[key];
      return replacement === undefined ? `{{${key}}}` : String(replacement);
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteTemplateVariables(item, variables));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        substituteTemplateVariables(item, variables),
      ]),
    );
  }
  return value;
}

export async function installTemplate(
  db: Database["db"],
  workspaceId: string,
  boardId: string,
  auth: AuthPrincipal,
  input: InstallTemplateInput,
) {
  const { template, version } = await getTemplateVersionRecord(
    db,
    input.template_version_id,
  );
  if (template.workspaceId && template.workspaceId !== workspaceId) {
    throw conflict("Template belongs to a different workspace");
  }
  const boardRows = await db
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), eq(boards.workspaceId, workspaceId)));
  const board = boardRows.find(
    (row) => row.id === boardId && row.workspaceId === workspaceId && !row.deletedAt,
  );
  if (!board) throw notFound(`Board '${boardId}' not found`);
  if (version.state !== "published") {
    throw conflict("Only published template versions can be installed");
  }

  const manifest = templateManifestSchema.parse(version.manifest);
  const variables = asRecord(input.variables);
  for (const parameter of manifest.parameters) {
    if (parameter.required && variables[parameter.key] === undefined && parameter.default === undefined) {
      throw badRequest(`Template parameter '${parameter.key}' is required`);
    }
  }

  const now = new Date();
  const actor = actorFromAuth(auth);
  const [installation] = await db
    .insert(templateInstallations)
    .values({
      id: createId(PREFIX.templateInstallation),
      boardId: board.id,
      templateVersionId: version.id,
      variables,
      state: "installed",
      installedById: auth.id,
      installedAt: now,
    })
    .returning();

  const pending = [...manifest.blocks];
  const blockByNodeKey = new Map<string, string>();
  const createdBlocks = [];
  while (pending.length > 0) {
    let createdInPass = false;
    for (let index = 0; index < pending.length; ) {
      const node = pending[index]!;
      const parentBlockId = node.parent_key
        ? blockByNodeKey.get(node.parent_key)
        : null;
      if (node.parent_key && !parentBlockId) {
        index += 1;
        continue;
      }

      const block = await createBoardBlock(db, board.id, actor, {
        type: node.type,
        schema_version: node.schema_version,
        parent_block_id: parentBlockId,
        slot: node.slot ?? null,
        rank: node.rank,
        attributes: substituteTemplateVariables(node.attributes, variables),
        content: substituteTemplateVariables(node.content, variables),
        template_origin_key: node.key,
      });
      blockByNodeKey.set(node.key, block.id);
      createdBlocks.push(block);
      await db.insert(templateBlockMappings).values({
        id: createId(PREFIX.templateBlockMapping),
        installationId: installation!.id,
        templateNodeKey: node.key,
        blockId: block.id,
        createdAt: now,
      });
      pending.splice(index, 1);
      createdInPass = true;
    }
    if (!createdInPass) {
      throw badRequest("Template contains an unresolved parent_key");
    }
  }

  await db
    .update(boards)
    .set({ templateInstallationId: installation!.id, updatedAt: now })
    .where(eq(boards.id, board.id));
  const revision = await captureBoardRevision(db, board.id, {
    trigger: "template_installed",
    actor,
    summary: `Installed template ${template.slug}@${version.version}`,
    eventType: "template.installed",
    payload: {
      template_id: template.id,
      template_version_id: version.id,
      installation_id: installation!.id,
    },
  });

  return {
    installation: formatInstallation(installation!),
    blocks: createdBlocks.map(formatBoardBlock),
    revision,
  };
}
