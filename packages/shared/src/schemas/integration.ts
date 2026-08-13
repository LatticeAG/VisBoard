import { z } from "zod";

/** Providers supported by the first V3 connector adapters. */
export const integrationProviderSchema = z.enum(["github", "notion", "linear"]);

export const syncDirectionSchema = z.enum([
  "inbound",
  "outbound",
  "bidirectional",
]);

/**
 * Ownership is deliberately per field. A connector must not infer ownership
 * from a link's direction, because a linked issue can have locally-owned
 * evidence alongside externally-owned status.
 */
export const fieldOwnershipSchema = z.enum([
  "visboard",
  "external",
  "shared",
  "mirrored",
]);

export const externalObjectKindSchema = z.enum([
  "issue",
  "pull_request",
  "page",
  "database_item",
  "project",
  "comment",
  "unknown",
]);

export const externalObjectSchema = z.object({
  provider: integrationProviderSchema,
  external_id: z.string().min(1),
  kind: externalObjectKindSchema.default("unknown"),
  title: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  url: z.string().url().nullable().optional(),
  labels: z.array(z.string()).default([]),
  assignee: z.string().nullable().optional(),
  version: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  /** Connector origin metadata used for loop prevention. */
  origin: z.string().nullable().optional(),
  properties: z.record(z.unknown()).default({}),
});

export const fieldMappingSchema = z
  .object({
    local_field: z.string().min(1),
    external_field: z.string().min(1),
    ownership: fieldOwnershipSchema,
    /** Required only for mirrored fields, whose source must be explicit. */
    preferred_source: z.enum(["visboard", "external"]).optional(),
  })
  .superRefine((value, context) => {
    if (value.ownership === "mirrored" && !value.preferred_source) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["preferred_source"],
        message: "Mirrored fields require a preferred_source",
      });
    }
  });

export const integrationConnectionSchema = z.object({
  id: z.string().min(1),
  provider: integrationProviderSchema,
  display_name: z.string().min(1),
  organization_id: z.string().nullable().optional(),
  workspace_id: z.string().nullable().optional(),
  capabilities: z.array(z.string()).default([]),
  status: z.enum(["active", "paused", "disabled", "invalid"]).default("active"),
  /** A vault reference, never a plaintext provider credential. */
  secret_reference: z.string().nullable().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createIntegrationConnectionSchema = integrationConnectionSchema
  .omit({ id: true, created_at: true, updated_at: true })
  .extend({
    id: z.string().min(1).optional(),
  });

export const syncLinkSchema = z.object({
  id: z.string().min(1),
  connection_id: z.string().min(1),
  board_id: z.string().min(1),
  /** Stable VisBoard block/resource identity; never a display title. */
  resource_id: z.string().min(1),
  external_id: z.string().min(1),
  external_kind: externalObjectKindSchema.default("unknown"),
  direction: syncDirectionSchema,
  field_mappings: z.array(fieldMappingSchema).default([]),
  /** Immutable record of the last mutually acknowledged values. */
  baseline: z.record(z.unknown()).default({}),
  remote_version: z.string().nullable().optional(),
  state: z.enum(["active", "paused", "conflicted", "disabled"]).default("active"),
  version: z.number().int().nonnegative().default(0),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
});

export const createSyncLinkSchema = syncLinkSchema
  .omit({ id: true, version: true, created_at: true, updated_at: true })
  .extend({ id: z.string().min(1).optional() });

export const syncConflictSchema = z.object({
  id: z.string().min(1),
  link_id: z.string().min(1),
  field: z.string().min(1),
  baseline: z.unknown(),
  local: z.unknown(),
  remote: z.unknown(),
  state: z.enum(["open", "resolved", "dismissed"]).default("open"),
  created_at: z.string(),
  resolved_at: z.string().nullable().optional(),
});

export const normalizedExternalChangeSchema = z.object({
  provider: integrationProviderSchema,
  delivery_id: z.string().min(1),
  event_type: z.string().min(1),
  action: z.string().nullable().optional(),
  object: externalObjectSchema,
  received_at: z.string(),
  raw_hash: z.string().min(1),
});

export type IntegrationProvider = z.infer<typeof integrationProviderSchema>;
export type SyncDirection = z.infer<typeof syncDirectionSchema>;
export type FieldOwnership = z.infer<typeof fieldOwnershipSchema>;
export type ExternalObjectKind = z.infer<typeof externalObjectKindSchema>;
export type ExternalObject = z.infer<typeof externalObjectSchema>;
export type FieldMapping = z.infer<typeof fieldMappingSchema>;
export type IntegrationConnection = z.infer<typeof integrationConnectionSchema>;
export type CreateIntegrationConnection = z.infer<
  typeof createIntegrationConnectionSchema
>;
export type SyncLink = z.infer<typeof syncLinkSchema>;
export type CreateSyncLink = z.infer<typeof createSyncLinkSchema>;
export type SyncConflict = z.infer<typeof syncConflictSchema>;
export type NormalizedExternalChange = z.infer<
  typeof normalizedExternalChangeSchema
>;
