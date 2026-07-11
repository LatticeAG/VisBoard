import { z } from "zod";
import { ID_PATTERNS } from "../ids.js";
import { actorTypeSchema, timestampSchema } from "./common.js";
import { projectIdSchema } from "./project.js";

export const fileIdSchema = z.string().regex(ID_PATTERNS.file);

export const fileSchema = z.object({
  id: fileIdSchema,
  project_id: projectIdSchema,
  name: z.string().min(1).max(512),
  mime_type: z.string().min(1),
  size_bytes: z.number().int().nonnegative(),
  storage_path: z.string().min(1),
  sha256: z.string().nullable().optional(),
  created_by_type: actorTypeSchema,
  created_by_id: z.string(),
  created_at: timestampSchema,
  deleted_at: timestampSchema.nullable().optional(),
});

export type FileRecord = z.infer<typeof fileSchema>;
